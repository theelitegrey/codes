import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { HeyGenClient, heygenTestMode } from "../heygen/client.js";
import { env } from "../../core/env.js";
import { log } from "../../core/log.js";
import { CONFIG_DIR } from "../../core/paths.js";
import { probe, ensureDir } from "../../media/ffmpeg.js";
import type { ProviderHealth } from "../voice/VoiceProvider.js";
import type { AvatarCapabilities, AvatarGenerationRequest, AvatarGenerationResult, AvatarVideoProvider } from "./AvatarVideoProvider.js";

/**
 * HeyGen avatar video driven by the FINAL narration audio:
 *   upload narration (/v1/asset) → /v2/video/generate with voice.type "audio"
 *   and either a HeyGen avatar_id or a talking_photo_id → poll
 *   /v1/video_status.get → download the MP4.
 *
 * Identity: the presenter profile's `heygen.avatar_id` (a HeyGen studio
 * avatar / digital twin) or `heygen.talking_photo_id`. When neither is set,
 * the profile's reference image is uploaded once as a talking photo and the
 * resulting id is cached in config/presenter/heygen_cache.json keyed by the
 * image hash, so the same identity is reused across videos.
 *
 * The scene prompt is NOT used: HeyGen renders the avatar as-is on a flat
 * background colour, which the Composer keys out (keyable mode).
 */
export interface HeyGenAvatarOptions {
  client?: HeyGenClient;
  avatarId?: string;
  talkingPhotoId?: string;
  cacheFile?: string;
  /** Free watermarked renders for testing (HEYGEN_TEST_MODE). */
  testMode?: boolean;
}

export class HeyGenAvatarProvider implements AvatarVideoProvider {
  readonly name = "heygen";
  private readonly client: HeyGenClient;
  private readonly avatarId?: string;
  private readonly talkingPhotoId?: string;
  private readonly cacheFile: string;
  private readonly testMode: boolean;

  constructor(o: HeyGenAvatarOptions = {}) {
    this.client = o.client ?? new HeyGenClient();
    this.avatarId = o.avatarId ?? env("HEYGEN_AVATAR_ID");
    this.talkingPhotoId = o.talkingPhotoId ?? env("HEYGEN_TALKING_PHOTO_ID");
    this.cacheFile = o.cacheFile ?? path.join(CONFIG_DIR, "presenter", "heygen_cache.json");
    this.testMode = o.testMode ?? heygenTestMode();
  }

  capabilities(): AvatarCapabilities {
    return { audio_driven: true, resolutions: ["720p", "1080p"], native_aspect_ratios: ["9:16", "1:1", "16:9"], fps: [25, 30], max_duration_sec: 1800, supports_negative_prompt: false, supports_seed: false, runtime: "hosted_api" };
  }

  async health(): Promise<ProviderHealth> {
    if (!this.client.configured()) return { ok: false, detail: "HEYGEN_API_KEY not set" };
    try {
      const a = await this.client.listAvatars();
      return { ok: true, detail: `HeyGen reachable: ${a.avatars.length} avatars, ${a.talking_photos.length} talking photos${this.avatarId ? `, using avatar ${this.avatarId}` : this.talkingPhotoId ? `, using talking photo ${this.talkingPhotoId}` : ", will upload the profile reference as a talking photo"}${this.testMode ? " (TEST MODE: watermarked)" : ""}` };
    } catch (e) {
      return { ok: false, detail: `HeyGen avatars request failed: ${(e as Error).message}` };
    }
  }

  /** Resolve (and cache) the character to render. */
  async resolveCharacter(referenceImage: string, profileHints?: { avatar_id?: string; talking_photo_id?: string }): Promise<{ type: "avatar"; avatar_id: string } | { type: "talking_photo"; talking_photo_id: string }> {
    const avatarId = profileHints?.avatar_id ?? this.avatarId;
    if (avatarId) return { type: "avatar", avatar_id: avatarId };
    const tp = profileHints?.talking_photo_id ?? this.talkingPhotoId;
    if (tp) return { type: "talking_photo", talking_photo_id: tp };
    const hash = crypto.createHash("sha256").update(fs.readFileSync(referenceImage)).digest("hex").slice(0, 16);
    const cache: Record<string, string> = fs.existsSync(this.cacheFile) ? JSON.parse(fs.readFileSync(this.cacheFile, "utf8")) : {};
    if (cache[hash]) return { type: "talking_photo", talking_photo_id: cache[hash] };
    log.info(`uploading ${path.basename(referenceImage)} to HeyGen as a talking photo`);
    const up = await this.client.uploadTalkingPhoto(referenceImage);
    cache[hash] = up.talking_photo_id;
    ensureDir(path.dirname(this.cacheFile));
    fs.writeFileSync(this.cacheFile, JSON.stringify(cache, null, 2));
    return { type: "talking_photo", talking_photo_id: up.talking_photo_id };
  }

  static dimensionFor(aspect: AvatarGenerationRequest["aspectRatio"], resolution: AvatarGenerationRequest["resolution"]): { width: number; height: number } {
    const hd = resolution === "1080p";
    switch (aspect) {
      case "9:16": return hd ? { width: 1080, height: 1920 } : { width: 720, height: 1280 };
      case "1:1": return hd ? { width: 1080, height: 1080 } : { width: 720, height: 720 };
      case "4:3": return hd ? { width: 1440, height: 1080 } : { width: 960, height: 720 };
      default: return hd ? { width: 1920, height: 1080 } : { width: 1280, height: 720 };
    }
  }

  async generate(req: AvatarGenerationRequest & { profileHints?: { avatar_id?: string; talking_photo_id?: string }; backgroundColor?: string }): Promise<AvatarGenerationResult> {
    const jobDir = path.resolve(req.outDir, "heygen");
    ensureDir(jobDir);
    const character = await this.resolveCharacter(req.referenceImage, req.profileHints);
    log.info(`uploading narration (${path.basename(req.audioPath)}) to HeyGen`);
    const asset = await this.client.uploadAsset(req.audioPath);
    const dim = HeyGenAvatarProvider.dimensionFor(req.aspectRatio ?? "1:1", req.resolution ?? "1080p");
    const body = HeyGenClient.videoBody({ character, audioAssetId: asset.id, backgroundColor: req.backgroundColor ?? "#1DB954", width: dim.width, height: dim.height, title: `shorts-presenter-${Date.now()}`, test: this.testMode });
    fs.writeFileSync(path.join(jobDir, "request.json"), JSON.stringify(body, null, 2));
    const { video_id } = await this.client.generateVideo(body);
    log.info(`HeyGen video ${video_id} queued; polling`);
    const status = await this.client.waitForVideo(video_id, { onStatus: (s) => req.onLog?.(`[heygen] ${s}\n`) });
    if (!status.video_url) throw new Error(`HeyGen video ${video_id} completed without a video_url`);
    const out = path.join(jobDir, `${video_id}.mp4`);
    await this.client.download(status.video_url, out);
    const info = await probe(out);
    fs.writeFileSync(path.join(jobDir, "status.json"), JSON.stringify(status.raw, null, 2));
    return { path: out, width: info.width ?? dim.width, height: info.height ?? dim.height, fps: info.fps ?? 25, duration_sec: info.duration_sec, provider: this.name, aspect_ratio: req.aspectRatio ?? "1:1", meta: { video_id, character, audio_asset_id: asset.id, test_mode: this.testMode } };
  }
}
