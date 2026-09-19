import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { HeyGenClient, type AvatarEngine, type HeyGenLook } from "../heygen/client.js";
import { HeyGenCli, HeyGenCliException } from "../heygen/cli.js";
import { env } from "../../core/env.js";
import { log } from "../../core/log.js";
import { CONFIG_DIR } from "../../core/paths.js";
import { probe, ensureDir } from "../../media/ffmpeg.js";
import type { ProviderHealth } from "../voice/VoiceProvider.js";
import type { AvatarCapabilities, AvatarGenerationRequest, AvatarGenerationResult, AvatarVideoProvider } from "./AvatarVideoProvider.js";

/**
 * HeyGen presenter, driven by the FINAL narration audio.
 *
 * REST transport (default) uses the v3 API: POST /v3/videos with an
 * `avatar_id` (a look) or an animated `image`, `audio_url` / `audio_asset_id`
 * for lip-sync, and an `engine` that must appear in the look's
 * `supported_api_engines` — a studio avatar listing only `avatar_iii`
 * rejects the default Avatar IV. `output_format: "webm"` returns a real
 * alpha channel, so the Composer can skip chroma keying entirely; when the
 * avatar has no matting support we fall back to mp4 on a flat key colour.
 *
 * CLI transport (HEYGEN_TRANSPORT=cli) shells out to HeyGen's `heygen`
 * binary instead, which is what their published skills recommend for agents.
 */
export interface HeyGenAvatarOptions {
  client?: HeyGenClient;
  cli?: HeyGenCli;
  transport?: "rest" | "cli";
  /** A look id (the avatar_id passed to video creation). */
  lookId?: string;
  /** Resolve a ready look from this group when no look id is given. */
  groupId?: string;
  /** Force an engine; otherwise picked from the look's supported_api_engines. */
  engine?: AvatarEngine;
  /** Prefer transparent webm output (requires a matting-capable avatar). */
  preferAlpha?: boolean;
  cacheFile?: string;
}

export interface HeyGenProfileHints {
  look_id?: string;
  group_id?: string;
  avatar_id?: string;
  engine?: AvatarEngine;
}

const ENGINE_PREFERENCE: AvatarEngine[] = ["avatar_v", "avatar_iv", "avatar_iii"];

export class HeyGenAvatarProvider implements AvatarVideoProvider {
  readonly name = "heygen";
  private readonly client: HeyGenClient;
  private readonly cli: HeyGenCli;
  private readonly transport: "rest" | "cli";
  private readonly lookId?: string;
  private readonly groupId?: string;
  private readonly engine?: AvatarEngine;
  private readonly preferAlpha: boolean;
  private readonly cacheFile: string;

  constructor(o: HeyGenAvatarOptions = {}) {
    this.client = o.client ?? new HeyGenClient();
    this.cli = o.cli ?? new HeyGenCli();
    this.transport = o.transport ?? ((env("HEYGEN_TRANSPORT", "rest") as "rest" | "cli") ?? "rest");
    this.lookId = o.lookId ?? env("HEYGEN_LOOK_ID") ?? env("HEYGEN_AVATAR_ID");
    this.groupId = o.groupId ?? env("HEYGEN_GROUP_ID");
    this.engine = o.engine ?? (env("HEYGEN_ENGINE") as AvatarEngine | undefined);
    this.preferAlpha = o.preferAlpha ?? true;
    this.cacheFile = o.cacheFile ?? path.join(CONFIG_DIR, "presenter", "heygen_cache.json");
  }

  capabilities(): AvatarCapabilities {
    return { audio_driven: true, resolutions: ["720p", "1080p"], native_aspect_ratios: ["1:1", "9:16", "16:9"], fps: [25, 30], max_duration_sec: 1800, supports_negative_prompt: false, supports_seed: false, runtime: "hosted_api" };
  }

  async health(): Promise<ProviderHealth> {
    if (this.transport === "cli") {
      if (!(await this.cli.installed())) return { ok: false, detail: `HeyGen CLI "${this.cli.bin}" not found. Install: curl -fsSL https://static.heygen.ai/cli/install.sh | bash (or set HEYGEN_TRANSPORT=rest)` };
      if (!env("HEYGEN_API_KEY")) return { ok: false, detail: "HEYGEN_API_KEY not set (or run `heygen auth login`)" };
      return { ok: Boolean(this.lookId || this.groupId), detail: `HeyGen CLI ${await this.cli.version()}; ${this.lookId ? `look ${this.lookId}` : this.groupId ? `group ${this.groupId}` : "no avatar configured"}` };
    }
    if (!this.client.configured()) return { ok: false, detail: "HEYGEN_API_KEY not set" };
    try {
      const looks = await this.client.listLooks({ limit: 50 });
      const chosen = this.lookId ? looks.find((l) => l.id === this.lookId) : undefined;
      const detail = this.lookId ? (chosen ? `look ${chosen.name} (${chosen.id}, engines ${chosen.supported_api_engines.join("/") || "unknown"})` : `look ${this.lookId} not in the first ${looks.length} looks`) : this.groupId ? `group ${this.groupId}` : `${looks.length} looks available — set heygen.look_id on the presenter profile or HEYGEN_LOOK_ID`;
      return { ok: Boolean(this.lookId || this.groupId), detail: `HeyGen v3 reachable; ${detail}` };
    } catch (e) {
      return { ok: false, detail: `HeyGen looks request failed: ${(e as Error).message}` };
    }
  }

  /** Engine that both the caller and the look agree on. */
  static pickEngine(look: HeyGenLook | undefined, forced?: AvatarEngine): AvatarEngine | undefined {
    if (forced) {
      if (look && look.supported_api_engines.length && !look.supported_api_engines.includes(forced)) throw new Error(`avatar ${look.id} supports ${look.supported_api_engines.join(", ")} but ${forced} was requested`);
      return forced;
    }
    if (!look?.supported_api_engines.length) return undefined;
    return ENGINE_PREFERENCE.find((e) => look.supported_api_engines.includes(e)) ?? look.supported_api_engines[0];
  }

  /** Aspect closest to what the caller asked for, given what HeyGen accepts. */
  static aspectFor(req: AvatarGenerationRequest): "auto" | "16:9" | "9:16" | "1:1" {
    switch (req.aspectRatio) {
      case "9:16": return "9:16";
      case "16:9": return "16:9";
      case "1:1": return "1:1";
      default: return "auto";
    }
  }

  async generate(req: AvatarGenerationRequest & { profileHints?: HeyGenProfileHints; backgroundColor?: string }): Promise<AvatarGenerationResult> {
    const jobDir = path.resolve(req.outDir, "heygen");
    ensureDir(jobDir);
    if (this.transport === "cli") return this.generateViaCli(req, jobDir);

    const lookId = req.profileHints?.look_id ?? req.profileHints?.avatar_id ?? this.lookId;
    const groupId = req.profileHints?.group_id ?? this.groupId;
    let look: HeyGenLook | undefined;
    let source: { type: "avatar"; avatar_id: string } | { type: "image"; asset_id: string };

    if (lookId || groupId) {
      const looks = await this.client.listLooks({ limit: 50, groupId: lookId ? undefined : groupId });
      look = lookId ? looks.find((l) => l.id === lookId) : looks.find((l) => l.status === "completed" && l.preview_image_url);
      const id = look?.id ?? lookId;
      if (!id) throw new Error(`no ready avatar look found${groupId ? ` in group ${groupId}` : ""}`);
      source = { type: "avatar", avatar_id: id };
    } else {
      // No HeyGen avatar configured: animate the presenter profile's reference image.
      const assetId = await this.uploadReference(req.referenceImage);
      source = { type: "image", asset_id: assetId };
      log.info(`no HeyGen avatar configured; animating ${path.basename(req.referenceImage)} as a photo presenter`);
    }

    const engine = HeyGenAvatarProvider.pickEngine(look, req.profileHints?.engine ?? this.engine);
    const aspect = HeyGenAvatarProvider.aspectFor(req);
    const resolution = req.resolution === "1080p" ? "1080p" : "720p";
    const asset = await this.client.uploadAsset(req.audioPath);

    // Prefer a real alpha channel; fall back to a flat key colour the Composer chromakeys.
    const attempts: Array<{ outputFormat: "webm" | "mp4"; backgroundColor?: string }> = this.preferAlpha ? [{ outputFormat: "webm" }, { outputFormat: "mp4", backgroundColor: req.backgroundColor }] : [{ outputFormat: "mp4", backgroundColor: req.backgroundColor }];
    let created: { video_id: string; output_format?: string } | undefined;
    let alpha = false;
    let lastError: Error | undefined;
    for (const a of attempts) {
      const body = HeyGenClient.videoBody({ source, audioAssetId: asset.id, engine, aspectRatio: aspect, outputFormat: a.outputFormat, resolution, backgroundColor: a.backgroundColor, title: `shorts-presenter-${Date.now()}` });
      fs.writeFileSync(path.join(jobDir, `request-${a.outputFormat}.json`), JSON.stringify(body, null, 2));
      try {
        created = await this.client.createVideo(body);
        alpha = (created.output_format ?? a.outputFormat) === "webm";
        break;
      } catch (e) {
        lastError = e as Error;
        log.warn(`HeyGen rejected ${a.outputFormat}: ${lastError.message}`);
      }
    }
    if (!created) throw lastError ?? new Error("HeyGen video creation failed");

    log.info(`HeyGen video ${created.video_id} queued (${alpha ? "webm/alpha" : "mp4"}); polling`);
    const status = await this.client.waitForVideo(created.video_id, { onStatus: (s) => req.onLog?.(`[heygen] ${s}\n`) });
    if (!status.video_url) throw new Error(`HeyGen video ${created.video_id} completed without a video_url`);
    const out = path.join(jobDir, `${created.video_id}.${alpha ? "webm" : "mp4"}`);
    await this.client.download(status.video_url, out);
    fs.writeFileSync(path.join(jobDir, "status.json"), JSON.stringify(status.raw, null, 2));
    const info = await probe(out);
    return {
      path: out,
      width: info.width ?? 1080,
      height: info.height ?? 1080,
      fps: info.fps ?? 25,
      duration_sec: info.duration_sec,
      provider: this.name,
      aspect_ratio: req.aspectRatio ?? "1:1",
      meta: { transport: "rest", video_id: created.video_id, audio_asset_id: asset.id, engine, alpha, source },
    };
  }

  /** Upload the profile reference image once and cache the asset id by content hash. */
  private async uploadReference(image: string): Promise<string> {
    const hash = crypto.createHash("sha256").update(fs.readFileSync(image)).digest("hex").slice(0, 16);
    const cache: Record<string, string> = fs.existsSync(this.cacheFile) ? JSON.parse(fs.readFileSync(this.cacheFile, "utf8")) : {};
    if (cache[hash]) return cache[hash];
    const up = await this.client.uploadAsset(image);
    cache[hash] = up.id;
    ensureDir(path.dirname(this.cacheFile));
    fs.writeFileSync(this.cacheFile, JSON.stringify(cache, null, 2));
    return up.id;
  }

  /** `heygen asset create` → `heygen lipsync create --wait` → `heygen video download`. */
  private async generateViaCli(req: AvatarGenerationRequest & { profileHints?: HeyGenProfileHints }, jobDir: string): Promise<AvatarGenerationResult> {
    const lookId = req.profileHints?.look_id ?? this.lookId ?? (await this.resolveLookViaCli(req.profileHints?.group_id ?? this.groupId));
    const asset = await this.cli.assetCreate(req.audioPath);
    const assetId = String(asset.asset_id ?? asset.id ?? "");
    if (!assetId) throw new Error(`heygen asset create returned no asset id: ${JSON.stringify(asset).slice(0, 300)}`);
    let job: Record<string, unknown>;
    try {
      job = await this.cli.lipsyncCreate({ avatarId: lookId, audioAssetId: assetId, wait: true, onLine: (l) => req.onLog?.(l) });
    } catch (e) {
      const x = e as HeyGenCliException;
      if (x.detail?.help) throw new Error(`heygen lipsync create rejected the flags this build sends. The CLI's own help follows; set the HEYGEN_FLAG_* env vars to match, or send me this text.\n\n${x.detail.help}`);
      throw e;
    }
    const videoId = String(job.video_id ?? job.id ?? "");
    const url = job.video_url ? String(job.video_url) : undefined;
    const out = path.join(jobDir, `${videoId || "lipsync"}.mp4`);
    if (url) await this.client.download(url, out);
    else if (videoId) await this.cli.videoDownload(videoId, out);
    else throw new Error(`heygen lipsync create returned neither video_url nor video_id: ${JSON.stringify(job).slice(0, 300)}`);
    fs.writeFileSync(path.join(jobDir, "lipsync.json"), JSON.stringify(job, null, 2));
    const info = await probe(out);
    return { path: out, width: info.width ?? 1080, height: info.height ?? 1080, fps: info.fps ?? 25, duration_sec: info.duration_sec, provider: this.name, aspect_ratio: req.aspectRatio ?? "1:1", meta: { transport: "cli", look_id: lookId, video_id: videoId, audio_asset_id: assetId, alpha: false } };
  }

  private async resolveLookViaCli(groupId?: string): Promise<string> {
    if (!groupId) throw new Error("No HeyGen avatar configured. Set heygen.look_id or heygen.group_id on the presenter profile (or HEYGEN_LOOK_ID / HEYGEN_GROUP_ID).");
    const look = await this.cli.waitForLookReady(groupId);
    const id = String(look.look_id ?? look.id ?? look.avatar_id ?? "");
    if (!id) throw new Error(`no look id on the ready look: ${JSON.stringify(look).slice(0, 300)}`);
    return id;
  }
}
