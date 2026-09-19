import fs from "node:fs";
import path from "node:path";
import { env, envBool, envInt } from "../../core/env.js";
import { log } from "../../core/log.js";

/**
 * HeyGen v3 REST client.
 *
 * Shapes here were taken from HeyGen's own MCP tool schemas (the official
 * HeyGen connector), which are the authoritative description of the v3 API:
 *
 *   GET  /v3/voices?engine=starfish&type=public&language=&gender=&limit=&token=
 *          → {items:[{voice_id,name,language,gender,preview_audio_url,
 *                     support_pause,support_locale,type}], has_more, next_token}
 *   POST /v3/voices/speech   {text, voice_id, input_type, language?, locale?, speed}
 *          → {audio_url, duration, word_timestamps:[{word,start,end}]}
 *   GET  /v3/avatars/looks?ownership=&avatar_type=&group_id=&limit=&token=
 *          → {items:[{id, name, avatar_type, group_id, preview_image_url, gender,
 *                     default_voice_id, supported_api_engines[], image_width,
 *                     image_height, preferred_orientation, status}]}
 *   POST /v3/videos          avatar or image source + script|audio, engine,
 *                            aspect_ratio, output_format, resolution, background…
 *          → {video_id, status, output_format}
 *   GET  /v3/videos/{id}     → status, video_url, duration…
 *   POST /v3/assets          raw upload → {asset_id|id, url}
 *
 * HeyGen's published skills state that v1/v2 endpoints are deprecated
 * ("v3 only — never call v1 or v2 endpoints"), so nothing here uses them.
 * Auth is the `X-Api-Key` header. Paths are overridable by env because this
 * build cannot reach developers.heygen.com to re-verify them.
 */
export interface HeyGenClientOptions {
  apiKey?: string;
  apiBase?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export const PATHS = {
  voices: env("HEYGEN_PATH_VOICES", "/v3/voices")!,
  speech: env("HEYGEN_PATH_SPEECH", "/v3/voices/speech")!,
  looks: env("HEYGEN_PATH_LOOKS", "/v3/avatars/looks")!,
  groups: env("HEYGEN_PATH_GROUPS", "/v3/avatars/groups")!,
  videos: env("HEYGEN_PATH_VIDEOS", "/v3/videos")!,
  assets: env("HEYGEN_PATH_ASSETS", "/v3/assets")!,
  me: env("HEYGEN_PATH_ME", "/v3/user/me")!,
} as const;

export type AvatarEngine = "avatar_iii" | "avatar_iv" | "avatar_v";

export interface HeyGenVoice {
  voice_id: string;
  name: string;
  language?: string;
  gender?: string;
  support_pause?: boolean;
  type?: string;
  raw: unknown;
}

export interface HeyGenLook {
  id: string;
  name: string;
  avatar_type: string;
  group_id?: string;
  gender?: string;
  default_voice_id?: string;
  supported_api_engines: AvatarEngine[];
  image_width?: number;
  image_height?: number;
  preferred_orientation?: string;
  status?: string;
  preview_image_url?: string;
  raw: unknown;
}

export interface HeyGenSpeechResult {
  audio_url: string;
  duration?: number;
  words?: Array<{ word: string; start: number; end: number }>;
  raw: unknown;
}

export interface HeyGenVideoStatus {
  status: string;
  video_url?: string;
  duration?: number;
  error?: unknown;
  raw: unknown;
}

/** HeyGen wraps some payloads in `data`; v3 mostly returns them flat. */
const unwrap = <T>(j: unknown): T => {
  const o = j as { data?: T };
  return o && typeof o === "object" && "data" in o && o.data != null ? (o.data as T) : (j as T);
};

/** `<start>` / `<end>` sentinels come back in word_timestamps; drop them. */
export function cleanWordTimestamps(raw: unknown): Array<{ word: string; start: number; end: number }> | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out = raw
    .map((w) => {
      const o = w as Record<string, unknown>;
      return { word: String(o.word ?? o.text ?? "").trim(), start: Number(o.start ?? o.start_time ?? 0), end: Number(o.end ?? o.end_time ?? 0) };
    })
    .filter((w) => w.word && w.word !== "<start>" && w.word !== "<end>");
  return out.length ? out : undefined;
}

export class HeyGenClient {
  readonly apiBase: string;
  private readonly apiKey?: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(o: HeyGenClientOptions = {}) {
    this.apiKey = o.apiKey ?? env("HEYGEN_API_KEY");
    this.apiBase = (o.apiBase ?? env("HEYGEN_API_BASE", "https://api.heygen.com")!).replace(/\/+$/, "");
    this.fetchImpl = o.fetchImpl ?? fetch;
    this.timeoutMs = o.timeoutMs ?? envInt("HEYGEN_TIMEOUT_MS", 120_000);
  }

  configured(): boolean {
    return Boolean(this.apiKey);
  }

  private async req(pathOrUrl: string, init: RequestInit & { rawBody?: Buffer; contentType?: string } = {}): Promise<unknown> {
    if (!this.apiKey) throw new Error("HEYGEN_API_KEY is not set");
    const url = pathOrUrl.startsWith("http") ? pathOrUrl : `${this.apiBase}${pathOrUrl}`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    try {
      const headers: Record<string, string> = { "X-Api-Key": this.apiKey, Accept: "application/json", ...((init.headers as Record<string, string>) ?? {}) };
      let body: BodyInit | undefined = init.body as BodyInit | undefined;
      if (init.rawBody) {
        headers["Content-Type"] = init.contentType ?? "application/octet-stream";
        body = new Uint8Array(init.rawBody);
      } else if (typeof init.body === "string") headers["Content-Type"] = "application/json";
      const r = await this.fetchImpl(url, { method: init.method ?? "GET", headers, body, signal: ctrl.signal });
      const text = await r.text();
      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch {
        json = { raw: text };
      }
      const err = (json as { error?: unknown; message?: string; error_code?: string }).error;
      if (!r.ok || err) {
        const detail = (json as { message?: string }).message ?? (typeof err === "string" ? err : JSON.stringify(err ?? text).slice(0, 400));
        throw new Error(`HeyGen ${init.method ?? "GET"} ${url} → HTTP ${r.status}: ${detail}`);
      }
      return json;
    } finally {
      clearTimeout(timer);
    }
  }

  // ---- voices ----------------------------------------------------------------
  /** Only starfish-engine voices can drive /v3/voices/speech. */
  async listVoices(o: { engine?: string; language?: string; gender?: string; type?: "public" | "private"; limit?: number } = {}): Promise<HeyGenVoice[]> {
    const q = new URLSearchParams();
    q.set("engine", o.engine ?? "starfish");
    q.set("type", o.type ?? "public");
    q.set("limit", String(o.limit ?? 50));
    if (o.language) q.set("language", o.language);
    if (o.gender) q.set("gender", o.gender);
    const d = unwrap<{ items?: Array<Record<string, unknown>>; voices?: Array<Record<string, unknown>> }>(await this.req(`${PATHS.voices}?${q}`));
    const items = d.items ?? d.voices ?? [];
    return items.map((o2) => ({ voice_id: String(o2.voice_id ?? o2.id ?? ""), name: String(o2.name ?? ""), language: o2.language ? String(o2.language) : undefined, gender: o2.gender ? String(o2.gender) : undefined, support_pause: Boolean(o2.support_pause), type: o2.type ? String(o2.type) : undefined, raw: o2 })).filter((v) => v.voice_id);
  }

  /** Build the /v3/voices/speech body. Break tags must use seconds ("0.35s"). */
  static speechBody(o: { text: string; voiceId: string; speed?: number; ssml?: boolean; language?: string; locale?: string }): Record<string, unknown> {
    if (o.text.length > 5000) throw new Error(`HeyGen speech accepts at most 5000 characters (got ${o.text.length})`);
    const b: Record<string, unknown> = { text: o.text, voice_id: o.voiceId, input_type: o.ssml ? "ssml" : "text" };
    if (o.speed !== undefined) b.speed = Math.min(2, Math.max(0.5, o.speed));
    if (o.locale) b.locale = o.locale;
    else if (o.language) b.language = o.language;
    return b;
  }

  async speech(o: { text: string; voiceId: string; speed?: number; ssml?: boolean; language?: string; locale?: string }): Promise<HeyGenSpeechResult> {
    const j = await this.req(PATHS.speech, { method: "POST", body: JSON.stringify(HeyGenClient.speechBody(o)) });
    const d = unwrap<Record<string, unknown>>(j);
    const url = String(d.audio_url ?? d.url ?? "");
    if (!url) throw new Error(`HeyGen speech returned no audio_url: ${JSON.stringify(j).slice(0, 300)}`);
    return { audio_url: url, duration: d.duration !== undefined ? Number(d.duration) : undefined, words: cleanWordTimestamps(d.word_timestamps ?? d.words), raw: j };
  }

  // ---- avatars ---------------------------------------------------------------
  async listLooks(o: { ownership?: "public" | "private"; avatarType?: "studio_avatar" | "digital_twin" | "photo_avatar"; groupId?: string; limit?: number } = {}): Promise<HeyGenLook[]> {
    const q = new URLSearchParams();
    q.set("limit", String(o.limit ?? 50));
    if (o.ownership) q.set("ownership", o.ownership);
    if (o.avatarType) q.set("avatar_type", o.avatarType);
    if (o.groupId) q.set("group_id", o.groupId);
    const d = unwrap<{ items?: Array<Record<string, unknown>> }>(await this.req(`${PATHS.looks}?${q}`));
    return (d.items ?? []).map((o2) => ({
      id: String(o2.id ?? o2.look_id ?? o2.avatar_id ?? ""),
      name: String(o2.name ?? ""),
      avatar_type: String(o2.avatar_type ?? ""),
      group_id: o2.group_id ? String(o2.group_id) : undefined,
      gender: o2.gender ? String(o2.gender) : undefined,
      default_voice_id: o2.default_voice_id ? String(o2.default_voice_id) : undefined,
      supported_api_engines: Array.isArray(o2.supported_api_engines) ? (o2.supported_api_engines as AvatarEngine[]) : [],
      image_width: o2.image_width ? Number(o2.image_width) : undefined,
      image_height: o2.image_height ? Number(o2.image_height) : undefined,
      preferred_orientation: o2.preferred_orientation ? String(o2.preferred_orientation) : undefined,
      status: o2.status ? String(o2.status) : undefined,
      preview_image_url: o2.preview_image_url ? String(o2.preview_image_url) : undefined,
      raw: o2,
    })).filter((l) => l.id);
  }

  async getLook(lookId: string): Promise<HeyGenLook | undefined> {
    const looks = await this.listLooks({ limit: 50 });
    return looks.find((l) => l.id === lookId);
  }

  // ---- video -----------------------------------------------------------------
  /**
   * Body for POST /v3/videos. `engine.type` must be one of the look's
   * `supported_api_engines` — a studio avatar that only lists `avatar_iii`
   * rejects the default Avatar IV with "does not support Avatar IV video
   * generation". `output_format: "webm"` yields a transparent alpha channel
   * (requires a matting-capable avatar) and forbids `background`.
   */
  static videoBody(o: {
    source: { type: "avatar"; avatar_id: string } | { type: "image"; url?: string; asset_id?: string };
    audioUrl?: string;
    audioAssetId?: string;
    script?: string;
    voiceId?: string;
    engine?: AvatarEngine;
    aspectRatio?: "auto" | "16:9" | "9:16" | "1:1" | "4:5" | "5:4";
    outputFormat?: "mp4" | "webm";
    resolution?: "4k" | "1080p" | "720p";
    backgroundColor?: string;
    fit?: "contain" | "cover";
    title?: string;
    callbackUrl?: string;
    callbackId?: string;
  }): Record<string, unknown> {
    const audioSources = [o.audioUrl, o.audioAssetId, o.script].filter(Boolean).length;
    if (audioSources !== 1) throw new Error("exactly one of audioUrl, audioAssetId or script is required");
    if (o.script && !o.voiceId && o.source.type === "image") throw new Error("voice_id is required with a script when animating an image");
    if (o.outputFormat === "webm" && o.backgroundColor) throw new Error("webm output removes the background; a background colour is rejected");
    const body: Record<string, unknown> = {};
    if (o.source.type === "avatar") body.avatar_id = o.source.avatar_id;
    else body.image = o.source.asset_id ? { type: "asset_id", asset_id: o.source.asset_id } : { type: "url", url: o.source.url };
    if (o.audioUrl) body.audio_url = o.audioUrl;
    if (o.audioAssetId) body.audio_asset_id = o.audioAssetId;
    if (o.script) {
      body.script = o.script;
      if (o.voiceId) body.voice_id = o.voiceId;
    }
    if (o.engine) body.engine = { type: o.engine };
    body.aspect_ratio = o.aspectRatio ?? "auto";
    body.output_format = o.outputFormat ?? "mp4";
    if (o.resolution) body.resolution = o.resolution;
    if (o.backgroundColor) body.background = { type: "color", value: o.backgroundColor };
    if (o.fit) body.fit = o.fit;
    if (o.title) body.title = o.title;
    if (o.callbackUrl) body.callback_url = o.callbackUrl;
    if (o.callbackId) body.callback_id = o.callbackId;
    return body;
  }

  async createVideo(body: Record<string, unknown>): Promise<{ video_id: string; status?: string; output_format?: string; raw: unknown }> {
    const j = await this.req(PATHS.videos, { method: "POST", body: JSON.stringify(body) });
    const d = unwrap<Record<string, unknown>>(j);
    const id = String(d.video_id ?? d.id ?? "");
    if (!id) throw new Error(`HeyGen video create returned no video_id: ${JSON.stringify(j).slice(0, 300)}`);
    return { video_id: id, status: d.status ? String(d.status) : undefined, output_format: d.output_format ? String(d.output_format) : undefined, raw: j };
  }

  async videoStatus(videoId: string): Promise<HeyGenVideoStatus> {
    const d = unwrap<Record<string, unknown>>(await this.req(`${PATHS.videos}/${encodeURIComponent(videoId)}`));
    return { status: String(d.status ?? ""), video_url: d.video_url ? String(d.video_url) : undefined, duration: d.duration !== undefined ? Number(d.duration) : undefined, error: d.error, raw: d };
  }

  async waitForVideo(videoId: string, o: { intervalMs?: number; timeoutMs?: number; onStatus?: (s: string) => void } = {}): Promise<HeyGenVideoStatus> {
    const interval = o.intervalMs ?? envInt("HEYGEN_POLL_INTERVAL_MS", 10_000);
    const deadline = Date.now() + (o.timeoutMs ?? envInt("HEYGEN_VIDEO_TIMEOUT_MS", 30 * 60_000));
    let last = "";
    while (Date.now() < deadline) {
      const s = await this.videoStatus(videoId);
      if (s.status !== last) {
        last = s.status;
        o.onStatus?.(s.status);
      }
      if (s.status === "completed") return s;
      if (s.status === "failed") throw new Error(`HeyGen video ${videoId} failed: ${JSON.stringify(s.error ?? s.raw).slice(0, 400)}`);
      await new Promise((r) => setTimeout(r, interval));
    }
    throw new Error(`HeyGen video ${videoId} did not complete within the timeout`);
  }

  // ---- assets ----------------------------------------------------------------
  async uploadAsset(file: string, contentType?: string): Promise<{ id: string; url?: string; raw: unknown }> {
    const size = fs.statSync(file).size;
    if (size > 32 * 1024 * 1024) throw new Error(`${path.basename(file)} is ${(size / 1e6).toFixed(1)} MB; HeyGen assets are capped at 32 MB`);
    const j = await this.req(PATHS.assets, { method: "POST", rawBody: fs.readFileSync(file), contentType: contentType ?? mimeFor(file) });
    const d = unwrap<Record<string, unknown>>(j);
    const id = String(d.asset_id ?? d.id ?? "");
    if (!id) throw new Error(`HeyGen asset upload returned no id: ${JSON.stringify(j).slice(0, 300)}`);
    return { id, url: d.url ? String(d.url) : undefined, raw: j };
  }

  async me(): Promise<Record<string, unknown>> {
    return unwrap<Record<string, unknown>>(await this.req(PATHS.me));
  }

  /** Download a signed URL to disk. */
  async download(url: string, outFile: string): Promise<string> {
    const r = await this.fetchImpl(url);
    if (!r.ok) throw new Error(`download ${url} → HTTP ${r.status}`);
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    fs.writeFileSync(outFile, Buffer.from(await r.arrayBuffer()));
    return outFile;
  }
}

export function mimeFor(file: string): string {
  const ext = path.extname(file).toLowerCase();
  return { ".wav": "audio/wav", ".mp3": "audio/mpeg", ".m4a": "audio/mp4", ".aac": "audio/aac", ".flac": "audio/flac", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".mp4": "video/mp4", ".mov": "video/quicktime" }[ext] ?? "application/octet-stream";
}

export function heygenTestMode(): boolean {
  return envBool("HEYGEN_TEST_MODE", false);
}

export { log as heygenLog };
