import fs from "node:fs";
import path from "node:path";
import { env, envInt } from "../../core/env.js";
import { probe, ensureDir } from "../../media/ffmpeg.js";
import type { ProviderHealth, SynthesisRequest, SynthesisResult, Transcription, VoiceInfo, VoiceProvider } from "./VoiceProvider.js";

/**
 * VoiceStudio (https://voicestudio.sh, github.com/debpalash/VoiceStudio).
 *
 * VoiceStudio is a local desktop app (Electron) / Docker image whose Python
 * backend exposes an OpenAI-compatible HTTP API on http://localhost:3900 while
 * it runs. Documented endpoints used here (docs/skills/voicestudio/SKILL.md,
 * docs/api-auth.md, docs/mcp.md in that repository):
 *
 *   GET  /health                    – backend liveness
 *   GET  /openapi.json              – runtime contract discovery
 *   GET  /v1/audio/voices           – voices / engines available
 *   POST /v1/audio/speech           – OpenAI CreateSpeechRequest shape
 *                                     {model, input, voice, response_format, speed}
 *   POST /v1/audio/transcriptions   – multipart {file, model, response_format}
 *
 * Auth: loopback is unauthenticated. For non-loopback deployments the backend
 * is started with OMNIVOICE_API_KEY and expects `Authorization: Bearer <key>`;
 * LAN "share" mode uses an `X-OmniVoice-Pin` header instead.
 *
 * There is no hosted VoiceStudio cloud TTS API required for this integration;
 * everything runs on the user's machine.
 */
export interface VoiceStudioOptions {
  baseUrl?: string;
  apiKey?: string;
  pin?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export class VoiceStudioProvider implements VoiceProvider {
  readonly name = "voicestudio";
  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly pin?: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: VoiceStudioOptions = {}) {
    this.baseUrl = (opts.baseUrl ?? env("VOICESTUDIO_BASE_URL", "http://localhost:3900")!).replace(/\/+$/, "");
    this.apiKey = opts.apiKey ?? env("VOICESTUDIO_API_KEY");
    this.pin = opts.pin ?? env("VOICESTUDIO_PIN");
    this.timeoutMs = opts.timeoutMs ?? envInt("VOICESTUDIO_TIMEOUT_MS", 600_000);
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  /** Headers per docs/api-auth.md: Bearer key (preferred) and/or share PIN. Loopback needs neither. */
  headers(extra: Record<string, string> = {}): Record<string, string> {
    const h: Record<string, string> = { ...extra };
    if (this.apiKey) h["Authorization"] = `Bearer ${this.apiKey}`;
    if (this.pin) h["X-OmniVoice-Pin"] = this.pin;
    return h;
  }

  private async request(pathname: string, init: RequestInit = {}): Promise<Response> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    try {
      return await this.fetchImpl(`${this.baseUrl}${pathname}`, { ...init, headers: this.headers((init.headers as Record<string, string>) ?? {}), signal: ctrl.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  async health(): Promise<ProviderHealth> {
    try {
      const r = await this.request("/health");
      if (!r.ok) return { ok: false, detail: `GET /health -> HTTP ${r.status}` };
      let info: Record<string, unknown> = {};
      try {
        info = (await r.json()) as Record<string, unknown>;
      } catch {
        /* health may be plain text */
      }
      return { ok: true, detail: `VoiceStudio backend reachable at ${this.baseUrl}`, info };
    } catch (e) {
      return { ok: false, detail: `VoiceStudio not reachable at ${this.baseUrl}: ${(e as Error).message}. Start the VoiceStudio desktop app or the Docker image (see docs/integrations/voicestudio.md).` };
    }
  }

  async listVoices(): Promise<VoiceInfo[]> {
    const r = await this.request("/v1/audio/voices");
    if (!r.ok) throw new Error(`GET /v1/audio/voices -> HTTP ${r.status}: ${await r.text()}`);
    const j = (await r.json()) as unknown;
    return normaliseVoices(j);
  }

  /** Build the OpenAI-compatible CreateSpeechRequest body. Exposed for tests. */
  static buildSpeechBody(req: SynthesisRequest): Record<string, unknown> {
    const v = req.voice;
    const body: Record<string, unknown> = {
      model: v.model || "tts-1",
      input: req.text,
      voice: v.voice_id || "default",
      response_format: v.output_format,
      speed: v.speaking_speed,
    };
    // `instructions` is part of the OpenAI speech schema; VoiceStudio engines
    // that support delivery/emotion prompts read it, others ignore it.
    if (v.emotion || v.style) body.instructions = [v.emotion, v.style].filter(Boolean).join("; ");
    return body;
  }

  async synthesize(req: SynthesisRequest): Promise<SynthesisResult> {
    ensureDir(path.dirname(req.outPath));
    const body = VoiceStudioProvider.buildSpeechBody(req);
    const r = await this.request("/v1/audio/speech", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: `audio/${req.voice.output_format}, */*` },
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      throw new Error(`POST /v1/audio/speech -> HTTP ${r.status}: ${(await r.text()).slice(0, 500)}`);
    }
    const ct = r.headers.get("content-type") ?? "";
    const buf = Buffer.from(await r.arrayBuffer());
    // Per the VoiceStudio skill: an error body can be written to the output
    // path if unchecked, so verify we actually got audio before saving.
    if (ct.includes("application/json") || buf.length < 64) {
      throw new Error(`VoiceStudio returned a non-audio response (${ct}, ${buf.length} bytes): ${buf.toString("utf8").slice(0, 300)}`);
    }
    fs.writeFileSync(req.outPath, buf);
    const info = await probe(req.outPath);
    if (!info.has_audio || info.duration_sec <= 0) throw new Error(`VoiceStudio output at ${req.outPath} is not decodable audio`);
    return { path: req.outPath, duration_sec: info.duration_sec, format: req.voice.output_format, provider: this.name, voice_id: req.voice.voice_id };
  }

  async transcribe(audioPath: string, language?: string): Promise<Transcription> {
    const form = new FormData();
    const bytes = fs.readFileSync(audioPath);
    form.append("file", new Blob([bytes]), path.basename(audioPath));
    form.append("model", "whisper-1");
    form.append("response_format", "verbose_json");
    // Word-level timestamps follow the OpenAI transcription schema.
    form.append("timestamp_granularities[]", "word");
    if (language) form.append("language", language);
    const r = await this.request("/v1/audio/transcriptions", { method: "POST", body: form });
    if (!r.ok) throw new Error(`POST /v1/audio/transcriptions -> HTTP ${r.status}: ${(await r.text()).slice(0, 500)}`);
    const j = (await r.json()) as { text?: string; language?: string; words?: Array<{ word: string; start: number; end: number }>; segments?: Array<{ text: string; start: number; end: number; words?: Array<{ word: string; start: number; end: number }> }> };
    let words = j.words ?? [];
    if (!words.length && j.segments) {
      for (const s of j.segments) {
        if (s.words?.length) words.push(...s.words);
        else {
          // Distribute segment words evenly when the engine only returns segment timing.
          const toks = s.text.trim().split(/\s+/).filter(Boolean);
          const step = (s.end - s.start) / Math.max(1, toks.length);
          toks.forEach((w, i) => words.push({ word: w, start: s.start + i * step, end: s.start + (i + 1) * step }));
        }
      }
    }
    words = words.map((w) => ({ word: w.word.trim(), start: Number(w.start), end: Number(w.end) })).filter((w) => w.word);
    return { text: j.text ?? words.map((w) => w.word).join(" "), words, language: j.language };
  }
}

/** Voices endpoint shape differs by engine; accept {voices:[...]}, {data:[...]}, or a bare array. */
export function normaliseVoices(payload: unknown): VoiceInfo[] {
  const arr: unknown[] = Array.isArray(payload)
    ? payload
    : payload && typeof payload === "object"
      ? ((payload as Record<string, unknown>).voices as unknown[]) ?? ((payload as Record<string, unknown>).data as unknown[]) ?? []
      : [];
  return arr
    .map((v) => {
      if (typeof v === "string") return { id: v, name: v, raw: v };
      const o = v as Record<string, unknown>;
      const id = String(o.id ?? o.voice_id ?? o.profile_id ?? o.name ?? "");
      return { id, name: String(o.name ?? o.label ?? id), language: o.language ? String(o.language) : undefined, engine: o.engine ? String(o.engine) : undefined, raw: v };
    })
    .filter((v) => v.id);
}
