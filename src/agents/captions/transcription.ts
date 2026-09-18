import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { env } from "../../core/env.js";
import { log } from "../../core/log.js";
import { toWav16kMono, commandExists } from "../../media/ffmpeg.js";
import { VoiceStudioProvider } from "../../providers/voice/VoiceStudioProvider.js";
import type { AudioTimeline } from "../audio/schema.js";
import type { CaptionWord } from "./schema.js";

export interface TranscriptionResult {
  words: CaptionWord[];
  text: string;
  source: "whisper_cpp" | "voicestudio" | "line_timing";
}

export interface Transcriber {
  readonly name: TranscriptionResult["source"];
  available(): Promise<{ ok: boolean; detail: string }>;
  transcribe(audioPath: string, language: string): Promise<TranscriptionResult>;
}

/**
 * Remotion's whisper.cpp integration (@remotion/install-whisper-cpp):
 * installs whisper.cpp, downloads a ggml model, transcribes with token-level
 * timestamps, converts to word captions. Needs a 16 kHz mono WAV.
 */
export class WhisperCppTranscriber implements Transcriber {
  readonly name = "whisper_cpp" as const;
  private readonly dir = env("WHISPER_CPP_DIR", path.join(os.homedir(), ".cache", "shorts", "whisper.cpp"))!;
  private readonly version = env("WHISPER_CPP_VERSION", "1.7.4")!;
  private readonly model = (env("WHISPER_MODEL", "base.en") as "base.en");

  async available() {
    if (!(await commandExists("cmake")) && !fs.existsSync(this.dir)) return { ok: false, detail: "whisper.cpp not installed and cmake missing (set WHISPER_CPP_DIR to an existing install)" };
    return { ok: true, detail: `whisper.cpp ${this.version} model ${this.model} in ${this.dir}` };
  }

  async transcribe(audioPath: string, language: string): Promise<TranscriptionResult> {
    const { installWhisperCpp, downloadWhisperModel, transcribe, toCaptions } = await import("@remotion/install-whisper-cpp");
    await installWhisperCpp({ to: this.dir, version: this.version, printOutput: false });
    await downloadWhisperModel({ model: this.model, folder: this.dir, printOutput: false });
    const wav = path.join(path.dirname(audioPath), "narration_16k_whisper.wav");
    await toWav16kMono(audioPath, wav);
    const out = await transcribe({ inputPath: wav, whisperPath: this.dir, whisperCppVersion: this.version, model: this.model, modelFolder: this.dir, tokenLevelTimestamps: true, language: language as never, splitOnWord: true, printOutput: false });
    const { captions } = toCaptions({ whisperCppOutput: out });
    const words: CaptionWord[] = captions.map((c) => ({ text: c.text.trim(), start: c.startMs / 1000, end: c.endMs / 1000, emphasis: false })).filter((w) => w.text);
    return { words, text: words.map((w) => w.text).join(" "), source: "whisper_cpp" };
  }
}

/** VoiceStudio's OpenAI-compatible /v1/audio/transcriptions (verbose_json with word timestamps). */
export class VoiceStudioTranscriber implements Transcriber {
  readonly name = "voicestudio" as const;
  constructor(private readonly provider = new VoiceStudioProvider()) {}
  async available() {
    const h = await this.provider.health();
    return { ok: h.ok, detail: h.detail };
  }
  async transcribe(audioPath: string, language: string): Promise<TranscriptionResult> {
    const t = await this.provider.transcribe(audioPath, language);
    return { words: t.words.map((w) => ({ text: w.word, start: w.start, end: w.end, emphasis: false })), text: t.text, source: "voicestudio" };
  }
}

/**
 * Fallback: the Audio Agent knows each spoken line's exact window (it
 * synthesised them one by one), so words are spread inside their line,
 * weighted by length. Accurate to the line, approximate within it.
 */
export class LineTimingTranscriber implements Transcriber {
  readonly name = "line_timing" as const;
  constructor(private readonly timeline: AudioTimeline) {}
  async available() {
    return this.timeline.lines.length ? { ok: true, detail: `${this.timeline.lines.length} timed lines` } : { ok: false, detail: "audio timeline has no lines" };
  }
  async transcribe(): Promise<TranscriptionResult> {
    const words: CaptionWord[] = [];
    for (const l of this.timeline.lines) {
      const toks = l.text.split(/\s+/).filter(Boolean);
      const weights = toks.map((t) => Math.max(2, t.replace(/[^\p{L}\p{N}]/gu, "").length + 1));
      const total = weights.reduce((a, b) => a + b, 0);
      let cursor = l.start;
      toks.forEach((t, i) => {
        const dur = ((l.end - l.start) * weights[i]) / total;
        words.push({ text: t, start: cursor, end: cursor + dur, emphasis: false });
        cursor += dur;
      });
    }
    return { words, text: words.map((w) => w.text).join(" "), source: "line_timing" };
  }
}

/** First available transcriber wins: whisper.cpp → VoiceStudio → line timing. */
export async function transcribeWithFallback(audioPath: string, language: string, timeline: AudioTimeline, chain?: Transcriber[]): Promise<TranscriptionResult> {
  const list = chain ?? [new WhisperCppTranscriber(), new VoiceStudioTranscriber(), new LineTimingTranscriber(timeline)];
  for (const t of list) {
    const a = await t.available();
    if (!a.ok) {
      log.info(`transcriber ${t.name} unavailable: ${a.detail}`);
      continue;
    }
    try {
      const r = await t.transcribe(audioPath, language);
      if (r.words.length) return r;
      log.warn(`transcriber ${t.name} returned no words`);
    } catch (e) {
      log.warn(`transcriber ${t.name} failed: ${(e as Error).message}`);
    }
  }
  throw new Error("No transcriber produced word timings");
}
