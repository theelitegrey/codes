import fs from "node:fs";
import path from "node:path";
import { HeyGenClient } from "../heygen/client.js";
import { probe, ensureDir, run, ffmpegBin } from "../../media/ffmpeg.js";
import { log } from "../../core/log.js";
import type { ProviderHealth, SynthesisRequest, SynthesisResult, VoiceInfo, VoiceProvider } from "./VoiceProvider.js";

/**
 * HeyGen text-to-speech (POST /v3/voices/speech). Returns a mono 44.1 kHz
 * WAV URL plus duration and word-level timestamps; we download it, convert
 * to 48 kHz for the mix, and pass the word timings back to the Audio Agent
 * so captions can use them without transcription.
 *
 * voice_id "default" → first English voice matching the config's gender trait.
 */
export class HeyGenVoiceProvider implements VoiceProvider {
  readonly name = "heygen";
  private readonly client: HeyGenClient;
  private voicesCache?: VoiceInfo[];

  constructor(client?: HeyGenClient) {
    this.client = client ?? new HeyGenClient();
  }

  async health(): Promise<ProviderHealth> {
    if (!this.client.configured()) return { ok: false, detail: "HEYGEN_API_KEY not set" };
    try {
      const v = await this.listVoices();
      return { ok: true, detail: `HeyGen reachable, ${v.length} voices` };
    } catch (e) {
      return { ok: false, detail: `HeyGen voices request failed: ${(e as Error).message}` };
    }
  }

  async listVoices(): Promise<VoiceInfo[]> {
    if (this.voicesCache) return this.voicesCache;
    const voices = await this.client.listVoices();
    this.voicesCache = voices.map((v) => ({ id: v.voice_id, name: `${v.name}${v.gender ? ` (${v.gender})` : ""}${v.support_pause ? " [pause]" : ""}`, language: v.language, engine: "heygen", raw: v.raw }));
    return this.voicesCache;
  }

  private async resolveVoiceId(req: SynthesisRequest): Promise<string> {
    if (req.voice.voice_id && req.voice.voice_id !== "default") return req.voice.voice_id;
    const voices = await this.client.listVoices();
    const lang = (req.voice.language || "en").toLowerCase();
    const gender = req.voice.traits.gender.toLowerCase();
    const pick = voices.find((v) => (v.language ?? "").toLowerCase().startsWith(lang) && (gender === "unspecified" || (v.gender ?? "").toLowerCase() === gender) && v.support_pause) ?? voices.find((v) => (v.language ?? "").toLowerCase().startsWith(lang)) ?? voices[0];
    if (!pick) throw new Error("HeyGen returned no voices");
    log.info(`HeyGen voice "default" → ${pick.name} (${pick.voice_id}); set voice_id in config/voice/${req.voice.id}.json to pin it`);
    return pick.voice_id;
  }

  async synthesize(req: SynthesisRequest): Promise<SynthesisResult> {
    ensureDir(path.dirname(req.outPath));
    const voiceId = await this.resolveVoiceId(req);
    const r = await this.client.speech({ text: req.text, voiceId, speed: req.voice.speaking_speed, ssml: /<break\b/.test(req.text), language: req.voice.language || undefined });
    const raw = req.outPath.replace(/\.[a-z0-9]+$/i, ".heygen.wav");
    await this.client.download(r.audio_url, raw);
    const conv = await run(ffmpegBin(), ["-y", "-i", raw, "-ar", "48000", "-ac", "1", req.outPath]);
    if (conv.code !== 0) throw new Error(`ffmpeg convert failed: ${conv.stderr.slice(-500)}`);
    fs.unlinkSync(raw);
    const info = await probe(req.outPath);
    if (r.words?.length) fs.writeFileSync(req.outPath + ".words.json", JSON.stringify(r.words));
    return { path: req.outPath, duration_sec: info.duration_sec, format: req.voice.output_format, provider: this.name, voice_id: voiceId, words: r.words };
  }
}
