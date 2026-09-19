import fs from "node:fs";
import path from "node:path";
import { HeyGenClient } from "../heygen/client.js";
import { HeyGenCli, HeyGenCliException } from "../heygen/cli.js";
import { env } from "../../core/env.js";
import { probe, ensureDir, run, ffmpegBin } from "../../media/ffmpeg.js";
import { log } from "../../core/log.js";
import type { ProviderHealth, SynthesisRequest, SynthesisResult, VoiceInfo, VoiceProvider } from "./VoiceProvider.js";

/**
 * HeyGen text-to-speech.
 *
 * Transport (HEYGEN_TRANSPORT):
 *  - "cli" (default): `heygen voice speech create …` — the surface HeyGen's
 *    own skills tell agents to use. Auth from HEYGEN_API_KEY.
 *  - "rest": the direct v3 speech endpoint, for hosts without the CLI.
 *
 * Either way it returns a mono 44.1 kHz
 * WAV URL plus duration and word-level timestamps; we download it, convert
 * to 48 kHz for the mix, and pass the word timings back to the Audio Agent
 * so captions can use them without transcription.
 *
 * voice_id "default" → first English voice matching the config's gender trait.
 */
export type HeyGenTransport = "cli" | "rest";

interface RawVoice {
  voice_id: string;
  name: string;
  language?: string;
  gender?: string;
  support_pause?: boolean;
  raw: unknown;
}

export class HeyGenVoiceProvider implements VoiceProvider {
  readonly name = "heygen";
  private readonly client: HeyGenClient;
  private readonly cli: HeyGenCli;
  private readonly transport: HeyGenTransport;
  private voicesCache?: VoiceInfo[];

  constructor(client?: HeyGenClient, opts: { cli?: HeyGenCli; transport?: HeyGenTransport } = {}) {
    this.client = client ?? new HeyGenClient();
    this.cli = opts.cli ?? new HeyGenCli();
    this.transport = opts.transport ?? ((env("HEYGEN_TRANSPORT", "cli") as HeyGenTransport) ?? "cli");
  }

  async health(): Promise<ProviderHealth> {
    if (this.transport === "cli") {
      if (!(await this.cli.installed())) return { ok: false, detail: `HeyGen CLI "${this.cli.bin}" not found. Install: curl -fsSL https://static.heygen.ai/cli/install.sh | bash (or set HEYGEN_TRANSPORT=rest)` };
      if (!env("HEYGEN_API_KEY")) return { ok: false, detail: "HEYGEN_API_KEY not set (or run `heygen auth login`)" };
      try {
        const v = await this.listVoices();
        return { ok: true, detail: `HeyGen CLI ${await this.cli.version()}, ${v.length} voices` };
      } catch (e) {
        return { ok: false, detail: `heygen voice list failed: ${(e as Error).message}` };
      }
    }
    if (!this.client.configured()) return { ok: false, detail: "HEYGEN_API_KEY not set" };
    try {
      const v = await this.listVoices();
      return { ok: true, detail: `HeyGen REST reachable, ${v.length} voices` };
    } catch (e) {
      return { ok: false, detail: `HeyGen voices request failed: ${(e as Error).message}` };
    }
  }

  private async rawVoices(): Promise<RawVoice[]> {
    if (this.transport === "rest") return this.client.listVoices();
    const rows = await this.cli.voiceList();
    return rows.map((o) => ({ voice_id: String(o.voice_id ?? o.id ?? ""), name: String(o.name ?? o.display_name ?? ""), language: o.language ? String(o.language) : undefined, gender: o.gender ? String(o.gender) : undefined, support_pause: Boolean(o.support_pause), raw: o })).filter((v) => v.voice_id);
  }

  async listVoices(): Promise<VoiceInfo[]> {
    if (this.voicesCache) return this.voicesCache;
    const voices = await this.rawVoices();
    this.voicesCache = voices.map((v) => ({ id: v.voice_id, name: `${v.name}${v.gender ? ` (${v.gender})` : ""}${v.support_pause ? " [pause]" : ""}`, language: v.language, engine: "heygen", raw: v.raw }));
    return this.voicesCache;
  }

  private async resolveVoiceId(req: SynthesisRequest): Promise<string> {
    if (req.voice.voice_id && req.voice.voice_id !== "default") return req.voice.voice_id;
    const voices = await this.rawVoices();
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
    const ssml = /<break\b/.test(req.text);
    const r = this.transport === "cli" ? await this.speechViaCli(req, voiceId, ssml) : await this.client.speech({ text: req.text, voiceId, speed: req.voice.speaking_speed, ssml, language: req.voice.language || undefined });
    const raw = req.outPath.replace(/\.[a-z0-9]+$/i, ".heygen.wav");
    await this.client.download(r.audio_url, raw);
    const conv = await run(ffmpegBin(), ["-y", "-i", raw, "-ar", "48000", "-ac", "1", req.outPath]);
    if (conv.code !== 0) throw new Error(`ffmpeg convert failed: ${conv.stderr.slice(-500)}`);
    fs.unlinkSync(raw);
    const info = await probe(req.outPath);
    if (r.words?.length) fs.writeFileSync(req.outPath + ".words.json", JSON.stringify(r.words));
    return { path: req.outPath, duration_sec: info.duration_sec, format: req.voice.output_format, provider: this.name, voice_id: voiceId, words: r.words };
  }

  /** `heygen voice speech create …` → {audio_url, duration, word_timestamps}. */
  private async speechViaCli(req: SynthesisRequest, voiceId: string, ssml: boolean): Promise<{ audio_url: string; duration?: number; words?: Array<{ word: string; start: number; end: number }> }> {
    const lang = req.voice.language || "en";
    let d: Record<string, unknown>;
    try {
      d = await this.cli.voiceSpeechCreate({ text: req.text, voiceId, inputType: ssml ? "ssml" : "text", language: lang, locale: lang.includes("-") ? lang : `${lang}-${lang.toUpperCase()}`, speed: req.voice.speaking_speed });
    } catch (e) {
      const x = e as HeyGenCliException;
      if (x.detail?.help) throw new Error(`heygen voice speech create rejected the flags this build sends. The CLI's own help follows; set the HEYGEN_FLAG_* env vars to match, or send me this text.\n\n${x.detail.help}`);
      throw e;
    }
    const url = String(d.audio_url ?? d.url ?? "");
    if (!url) throw new Error(`heygen voice speech create returned no audio_url: ${JSON.stringify(d).slice(0, 300)}`);
    const wt = (d.word_timestamps ?? d.words) as Array<Record<string, unknown>> | undefined;
    const words = Array.isArray(wt) ? wt.map((w) => ({ word: String(w.word ?? w.text ?? ""), start: Number(w.start ?? w.start_time ?? 0), end: Number(w.end ?? w.end_time ?? 0) })).filter((w) => w.word) : undefined;
    return { audio_url: url, duration: d.duration !== undefined ? Number(d.duration) : undefined, words };
  }
}
