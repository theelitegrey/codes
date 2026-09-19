import fs from "node:fs";
import path from "node:path";
import { env, envBool, envInt } from "../../core/env.js";
import { log } from "../../core/log.js";

/**
 * Minimal HeyGen REST client covering exactly the documented endpoints this
 * pipeline needs (see docs/integrations/heygen.md for the validation notes):
 *
 *   POST https://api.heygen.com/v3/voices/speech        text → WAV url (+ duration, word timestamps)
 *   GET  https://api.heygen.com/v2/voices                voice catalogue
 *   GET  https://api.heygen.com/v2/avatars               avatars + talking photos
 *   POST https://upload.heygen.com/v1/asset              raw file body → asset id / url
 *   POST https://upload.heygen.com/v1/talking_photo      raw image body → talking_photo_id
 *   POST https://api.heygen.com/v2/video/generate        avatar video (voice.type "audio" for lip-sync)
 *   GET  https://api.heygen.com/v1/video_status.get      poll → video_url
 *
 * Auth: `X-Api-Key` header on every request.
 */
export interface HeyGenClientOptions {
  apiKey?: string;
  apiBase?: string;
  uploadBase?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export interface HeyGenVoice {
  voice_id: string;
  name: string;
  language?: string;
  gender?: string;
  preview_audio?: string;
  support_pause?: boolean;
  emotion_support?: boolean;
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

const unwrap = <T>(j: unknown): T => {
  const o = j as { data?: T; error?: unknown };
  if (o && typeof o === "object" && "data" in o && o.data !== undefined && o.data !== null) return o.data as T;
  return j as T;
};

export class HeyGenClient {
  readonly apiBase: string;
  readonly uploadBase: string;
  private readonly apiKey?: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(o: HeyGenClientOptions = {}) {
    this.apiKey = o.apiKey ?? env("HEYGEN_API_KEY");
    this.apiBase = (o.apiBase ?? env("HEYGEN_API_BASE", "https://api.heygen.com")!).replace(/\/+$/, "");
    this.uploadBase = (o.uploadBase ?? env("HEYGEN_UPLOAD_BASE", "https://upload.heygen.com")!).replace(/\/+$/, "");
    this.fetchImpl = o.fetchImpl ?? fetch;
    this.timeoutMs = o.timeoutMs ?? envInt("HEYGEN_TIMEOUT_MS", 120_000);
  }

  configured(): boolean {
    return Boolean(this.apiKey);
  }

  private async req(url: string, init: RequestInit & { rawBody?: Buffer; contentType?: string } = {}): Promise<unknown> {
    if (!this.apiKey) throw new Error("HEYGEN_API_KEY is not set");
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    try {
      const headers: Record<string, string> = { "X-Api-Key": this.apiKey, Accept: "application/json", ...((init.headers as Record<string, string>) ?? {}) };
      let body: BodyInit | undefined = init.body as BodyInit | undefined;
      if (init.rawBody) {
        headers["Content-Type"] = init.contentType ?? "application/octet-stream";
        body = new Uint8Array(init.rawBody);
      } else if (init.body && typeof init.body === "string") headers["Content-Type"] = "application/json";
      const r = await this.fetchImpl(url, { method: init.method ?? "GET", headers, body, signal: ctrl.signal });
      const text = await r.text();
      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch {
        json = { raw: text };
      }
      if (!r.ok) throw new Error(`HeyGen ${init.method ?? "GET"} ${url} → HTTP ${r.status}: ${text.slice(0, 400)}`);
      const err = (json as { error?: unknown }).error;
      if (err) throw new Error(`HeyGen ${url} returned error: ${JSON.stringify(err).slice(0, 400)}`);
      return json;
    } finally {
      clearTimeout(timer);
    }
  }

  // ---- voices ----------------------------------------------------------------
  async listVoices(): Promise<HeyGenVoice[]> {
    const d = unwrap<{ voices?: unknown[] } | unknown[]>(await this.req(`${this.apiBase}/v2/voices`));
    const arr = Array.isArray(d) ? d : (d.voices ?? []);
    return arr.map((v) => {
      const o = v as Record<string, unknown>;
      return { voice_id: String(o.voice_id ?? o.id ?? ""), name: String(o.name ?? o.display_name ?? ""), language: o.language ? String(o.language) : undefined, gender: o.gender ? String(o.gender) : undefined, preview_audio: o.preview_audio ? String(o.preview_audio) : undefined, support_pause: Boolean(o.support_pause), emotion_support: Boolean(o.emotion_support), raw: v };
    }).filter((v) => v.voice_id);
  }

  /** Build the /v3/voices/speech body. Exposed for tests. */
  static speechBody(o: { text: string; voiceId: string; speed?: number; ssml?: boolean; language?: string; locale?: string }): Record<string, unknown> {
    const b: Record<string, unknown> = { text: o.text, voice_id: o.voiceId, input_type: o.ssml ? "ssml" : "text" };
    if (o.speed !== undefined) b.speed = Math.min(2, Math.max(0.5, o.speed));
    if (o.language) b.language = o.language;
    if (o.locale) b.locale = o.locale;
    return b;
  }

  async speech(o: { text: string; voiceId: string; speed?: number; ssml?: boolean; language?: string; locale?: string }): Promise<HeyGenSpeechResult> {
    const j = await this.req(`${this.apiBase}/v3/voices/speech`, { method: "POST", body: JSON.stringify(HeyGenClient.speechBody(o)) });
    const d = unwrap<Record<string, unknown>>(j);
    const url = String(d.audio_url ?? d.url ?? "");
    if (!url) throw new Error(`HeyGen speech returned no audio_url: ${JSON.stringify(j).slice(0, 300)}`);
    const wt = (d.word_timestamps ?? d.words) as Array<Record<string, unknown>> | undefined;
    const words = Array.isArray(wt) ? wt.map((w) => ({ word: String(w.word ?? w.text ?? ""), start: Number(w.start ?? w.start_time ?? 0), end: Number(w.end ?? w.end_time ?? 0) })).filter((w) => w.word) : undefined;
    return { audio_url: url, duration: d.duration !== undefined ? Number(d.duration) : undefined, words, raw: j };
  }

  // ---- assets ----------------------------------------------------------------
  async uploadAsset(file: string, contentType?: string): Promise<{ id: string; url?: string; raw: unknown }> {
    const j = await this.req(`${this.uploadBase}/v1/asset`, { method: "POST", rawBody: fs.readFileSync(file), contentType: contentType ?? mimeFor(file) });
    const d = unwrap<Record<string, unknown>>(j);
    const id = String(d.id ?? d.asset_id ?? "");
    if (!id) throw new Error(`HeyGen asset upload returned no id: ${JSON.stringify(j).slice(0, 300)}`);
    return { id, url: d.url ? String(d.url) : undefined, raw: j };
  }

  async uploadTalkingPhoto(imageFile: string): Promise<{ talking_photo_id: string; raw: unknown }> {
    const j = await this.req(`${this.uploadBase}/v1/talking_photo`, { method: "POST", rawBody: fs.readFileSync(imageFile), contentType: mimeFor(imageFile) });
    const d = unwrap<Record<string, unknown>>(j);
    const id = String(d.talking_photo_id ?? d.id ?? "");
    if (!id) throw new Error(`HeyGen talking photo upload returned no talking_photo_id: ${JSON.stringify(j).slice(0, 300)}`);
    return { talking_photo_id: id, raw: j };
  }

  async listAvatars(): Promise<{ avatars: Array<Record<string, unknown>>; talking_photos: Array<Record<string, unknown>> }> {
    const d = unwrap<{ avatars?: Array<Record<string, unknown>>; talking_photos?: Array<Record<string, unknown>> }>(await this.req(`${this.apiBase}/v2/avatars`));
    return { avatars: d.avatars ?? [], talking_photos: d.talking_photos ?? [] };
  }

  // ---- video -----------------------------------------------------------------
  /** Build the /v2/video/generate body for an audio-driven avatar or talking photo. Exposed for tests. */
  static videoBody(o: { character: { type: "avatar"; avatar_id: string; avatar_style?: string } | { type: "talking_photo"; talking_photo_id: string; talking_style?: string }; audioAssetId?: string; audioUrl?: string; backgroundColor: string; width: number; height: number; title?: string; test?: boolean; callbackId?: string }): Record<string, unknown> {
    if (Boolean(o.audioAssetId) === Boolean(o.audioUrl)) throw new Error("exactly one of audioAssetId or audioUrl is required");
    const voice: Record<string, unknown> = { type: "audio" };
    if (o.audioAssetId) voice.audio_asset_id = o.audioAssetId;
    if (o.audioUrl) voice.audio_url = o.audioUrl;
    const character: Record<string, unknown> = o.character.type === "avatar" ? { type: "avatar", avatar_id: o.character.avatar_id, avatar_style: o.character.avatar_style ?? "normal" } : { type: "talking_photo", talking_photo_id: o.character.talking_photo_id, ...(o.character.talking_style ? { talking_style: o.character.talking_style } : {}) };
    const body: Record<string, unknown> = {
      video_inputs: [{ character, voice, background: { type: "color", value: o.backgroundColor } }],
      dimension: { width: o.width, height: o.height },
    };
    if (o.title) body.title = o.title;
    if (o.test) body.test = true;
    if (o.callbackId) body.callback_id = o.callbackId;
    return body;
  }

  async generateVideo(body: Record<string, unknown>): Promise<{ video_id: string; raw: unknown }> {
    const j = await this.req(`${this.apiBase}/v2/video/generate`, { method: "POST", body: JSON.stringify(body) });
    const d = unwrap<Record<string, unknown>>(j);
    const id = String(d.video_id ?? "");
    if (!id) throw new Error(`HeyGen video generate returned no video_id: ${JSON.stringify(j).slice(0, 300)}`);
    return { video_id: id, raw: j };
  }

  async videoStatus(videoId: string): Promise<HeyGenVideoStatus> {
    const j = await this.req(`${this.apiBase}/v1/video_status.get?video_id=${encodeURIComponent(videoId)}`);
    const d = unwrap<Record<string, unknown>>(j);
    return { status: String(d.status ?? ""), video_url: d.video_url ? String(d.video_url) : undefined, duration: d.duration !== undefined ? Number(d.duration) : undefined, error: d.error, raw: j };
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

  /** Download a signed URL to disk (no API key needed for the CDN URL). */
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
