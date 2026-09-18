import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { VOICE_CONFIG_DIR } from "../core/paths.js";

/**
 * Voice configuration lives in config/voice/<id>.json, separate from agent
 * logic. Nothing in the application hard-codes a voice.
 */
export const VoiceConfig = z.object({
  id: z.string().regex(/^[a-z0-9_]+$/),
  label: z.string(),
  /** Natural-language aliases: "default male voice", "energetic male voice". */
  aliases: z.array(z.string()).default([]),
  /** Which VoiceProvider implementation should render this voice. */
  provider: z.enum(["voicestudio", "local"]).default("voicestudio"),
  /**
   * Provider-specific voice identifier. For VoiceStudio this is a voice/profile
   * id from GET /v1/audio/voices, the literal "default", or a KittenTTS preset
   * name. Discover ids with `shorts voices list`.
   */
  voice_id: z.string().default("default"),
  /** VoiceStudio engine id ("omnivoice", "voxcpm2", "cosyvoice", "mlx-audio", "kittentts", "moss-tts-nano") or alias "tts-1". */
  model: z.string().default("tts-1"),
  style: z.string().default("neutral narration"),
  /** 0.25–4.0, passed as OpenAI-compatible `speed`. Engines that ignore it still accept it. */
  speaking_speed: z.number().min(0.25).max(4).default(1),
  /** Semitone offset applied in post (ffmpeg) because the OpenAI speech schema has no pitch field. */
  pitch_semitones: z.number().min(-12).max(12).default(0),
  /** Emotion / delivery instruction. Passed as `instructions` where the engine supports it; otherwise informational. */
  emotion: z.string().default(""),
  language: z.string().default("en"),
  output_format: z.enum(["wav", "mp3", "flac", "opus", "aac", "pcm"]).default("wav"),
  /** Gain adjustment applied in post (dB). */
  gain_db: z.number().default(0),
});
export type VoiceConfig = z.infer<typeof VoiceConfig>;

export class VoiceConfigStore {
  constructor(private readonly dir: string = VOICE_CONFIG_DIR) {}

  list(): VoiceConfig[] {
    if (!fs.existsSync(this.dir)) return [];
    return fs
      .readdirSync(this.dir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => this.load(path.join(this.dir, f)));
  }

  get(id: string): VoiceConfig {
    const file = path.join(this.dir, `${id}.json`);
    if (!fs.existsSync(file)) {
      throw new Error(`Unknown voice "${id}". Available: ${this.list().map((v) => v.id).join(", ")}`);
    }
    return this.load(file);
  }

  private load(file: string): VoiceConfig {
    return VoiceConfig.parse(JSON.parse(fs.readFileSync(file, "utf8")));
  }

  /**
   * Resolve a voice from natural language: "Use the default male voice",
   * "use the energetic male voice", "voice: calm_female".
   */
  resolveFromText(text: string): VoiceConfig | undefined {
    const t = text.toLowerCase();
    const voices = this.list();
    // Most specific first: longest alias wins.
    const candidates: Array<{ v: VoiceConfig; key: string }> = [];
    for (const v of voices) {
      candidates.push({ v, key: v.id }, { v, key: v.id.replace(/_/g, " ") }, { v, key: v.label.toLowerCase() });
      for (const a of v.aliases) candidates.push({ v, key: a.toLowerCase() });
    }
    candidates.sort((a, b) => b.key.length - a.key.length);
    for (const c of candidates) {
      if (c.key.length >= 4 && t.includes(c.key)) return c.v;
    }
    if (/\bdefault voice\b/.test(t)) return voices.find((v) => v.id === "default");
    return undefined;
  }
}
