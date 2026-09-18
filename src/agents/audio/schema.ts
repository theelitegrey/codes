import { z } from "zod";
import { ScriptOutput } from "../script/schema.js";

export const AudioAgentInput = z.object({
  script: ScriptOutput,
  platform: z.enum(["youtube_shorts", "tiktok", "instagram_reels", "youtube", "x"]).default("youtube_shorts"),
  audience: z.string().default("general audience"),
  brand: z.string().default("direct, modern podcast host"),
  tone: z.string().default("clear, confident, conversational"),
  category: z.enum(["educational", "entertainment", "news", "trading", "story", "other"]).default("educational"),
  /** Force a configured voice (config/voice/<id>.json) instead of letting the agent choose. */
  voice_id: z.string().optional(),
  /** Explicit music file; otherwise the library is searched by tags, and silence is used if nothing matches. */
  music_file: z.string().optional(),
  music_enabled: z.boolean().default(true),
  sfx_enabled: z.boolean().default(true),
  notes: z.string().default(""),
});
export type AudioAgentInput = z.infer<typeof AudioAgentInput>;

/** A voice the agent may choose: a config file plus its descriptive traits. */
export const VoiceCandidate = z.object({
  id: z.string(),
  label: z.string(),
  provider: z.string(),
  gender: z.string().default("unspecified"),
  age: z.string().default("unspecified"),
  accent: z.string().default("unspecified"),
  energy: z.number().min(1).max(5).default(3),
  authority: z.number().min(1).max(5).default(3),
  best_for: z.string().default("both"),
  style: z.string().default(""),
  available: z.boolean().default(true),
});
export type VoiceCandidate = z.infer<typeof VoiceCandidate>;

export const VoicePlan = z.object({
  voice_config_id: z.string(),
  /** Base speaking speed multiplier for the whole piece. */
  speed: z.number().min(0.7).max(1.4).default(1),
  /** Delivery instruction passed to the TTS engine (emotion, tone). */
  delivery: z.string(),
  rationale: z.string(),
});
export type VoicePlan = z.infer<typeof VoicePlan>;

export const SpokenLine = z.object({
  text: z.string().min(1),
  pause_after_ms: z.number().int().min(0).max(2500).default(0),
  emphasis: z.array(z.string()).default([]),
  /** Optional per-line delivery note ("slower", "almost whispered", "punchy"). */
  delivery: z.string().default(""),
});
export type SpokenLine = z.infer<typeof SpokenLine>;

export const SfxType = z.enum(["whoosh", "hit", "click", "rise", "impact", "notification", "chart_movement", "transition"]);
export type SfxType = z.infer<typeof SfxType>;

export const SfxCue = z.object({
  type: SfxType,
  /** Absolute seconds on the script timeline. */
  at: z.number().min(0),
  beat_id: z.string(),
  gain_db: z.number().min(-24).max(6).default(-8),
  reason: z.string(),
});
export type SfxCue = z.infer<typeof SfxCue>;

export const PerformancePlan = z.object({
  voice: VoicePlan,
  beats: z
    .array(
      z.object({
        beat_id: z.string(),
        lines: z.array(SpokenLine).min(1),
        speed: z.number().min(0.85).max(1.15).default(1),
        energy: z.number().min(1).max(5).default(3),
      })
    )
    .min(1),
  music: z.object({
    enabled: z.boolean().default(true),
    genre: z.string().default(""),
    mood: z.string().default(""),
    tags: z.array(z.string()).default([]),
    /** Music loudness relative to narration while nobody speaks (LU). -10 = ten LU under speech. */
    base_gain_db: z.number().min(-30).max(-6).default(-10),
    /** Extra reduction under speech (dB). Under speech the bed sits base_gain_db - duck_db below narration. */
    duck_db: z.number().min(0).max(20).default(6),
    intensity: z.array(z.object({ beat_id: z.string(), level: z.number().min(0).max(1) })).default([]),
  }),
  sfx: z.array(SfxCue).default([]),
  transitions: z.array(z.object({ beat_id: z.string(), kind: z.enum(["riser", "swell", "drop"]), reason: z.string() })).default([]),
});
export type PerformancePlan = z.infer<typeof PerformancePlan>;

/** Measured, post-synthesis timing. Replaces the script's planned timing downstream. */
export const AudioTimeline = z.object({
  duration_sec: z.number(),
  beats: z.array(z.object({ beat_id: z.string(), planned_start: z.number(), planned_end: z.number(), start: z.number(), end: z.number(), tempo_applied: z.number().default(1) })),
  lines: z.array(z.object({ beat_id: z.string(), index: z.number(), text: z.string(), start: z.number(), end: z.number(), pause_after_ms: z.number() })),
  sfx: z.array(SfxCue.extend({ file: z.string(), procedural: z.boolean() })),
  music: z.object({ file: z.string().nullable(), base_gain_db: z.number(), duck_db: z.number() }),
});
export type AudioTimeline = z.infer<typeof AudioTimeline>;

export const LoudnessReport = z.object({
  integrated_lufs: z.number(),
  true_peak_dbtp: z.number(),
  loudness_range_lu: z.number(),
  speech_lufs: z.number().nullable(),
  music_lufs: z.number().nullable(),
  /** speech minus music, in dB (higher = clearer speech). */
  speech_music_ratio_db: z.number().nullable(),
  peak_level_db: z.number(),
  clipped_samples: z.number(),
  silences: z.array(z.object({ start: z.number(), end: z.number() })),
  target_lufs: z.number(),
  target_tp: z.number(),
  passed: z.boolean(),
  notes: z.array(z.string()),
});
export type LoudnessReport = z.infer<typeof LoudnessReport>;

export interface AudioAgentArtifacts {
  input: AudioAgentInput;
  candidates: VoiceCandidate[];
  plan: PerformancePlan;
  timeline: AudioTimeline;
  narration_path: string;
  master_path: string;
  report: LoudnessReport;
}

export const PLATFORM_LOUDNESS: Record<AudioAgentInput["platform"], { lufs: number; tp: number }> = {
  youtube_shorts: { lufs: -14, tp: -1 },
  youtube: { lufs: -14, tp: -1 },
  tiktok: { lufs: -14, tp: -1 },
  instagram_reels: { lufs: -14, tp: -1 },
  x: { lufs: -14, tp: -1 },
};
