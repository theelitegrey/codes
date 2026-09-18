import { z } from "zod";
import { ScriptOutput } from "../script/schema.js";
import { AudioTimeline } from "../audio/schema.js";

export const CaptionStyleName = z.enum(["Clean", "Bold", "Podcast", "Karaoke", "Minimal", "Trading", "Cinematic", "News"]);
export type CaptionStyleName = z.infer<typeof CaptionStyleName>;

export const CaptionMode = z.enum(["verbatim", "condensed"]);

export const CaptionStyle = z.object({
  name: CaptionStyleName,
  mode: CaptionMode,
  font_family: z.string(),
  font_size: z.number(),
  font_weight: z.number(),
  color: z.string(),
  highlight_color: z.string(),
  /** How the active word is shown. */
  active_word: z.enum(["highlight_box", "color", "scale", "underline", "none"]),
  background: z.enum(["none", "pill", "bar", "shadow"]),
  uppercase: z.boolean(),
  letter_spacing: z.number().default(0),
  line_height: z.number().default(1.15),
  animation: z.enum(["none", "pop", "fade", "slide_up", "word_pop", "typewriter"]),
  preferred_position: z.enum(["above_presenter", "center", "lower_third", "top_third"]),
  max_chars_per_line: z.number().int().min(8).max(40),
  max_lines: z.number().int().min(1).max(3),
  /** Vertical safe area fractions (top, bottom). */
  safe_top: z.number().default(0.08),
  safe_bottom: z.number().default(0.14),
});
export type CaptionStyle = z.infer<typeof CaptionStyle>;

export const CaptionWordZ = z.object({ text: z.string(), start: z.number(), end: z.number(), emphasis: z.boolean().default(false) });
export type CaptionWord = z.infer<typeof CaptionWordZ>;

export const CaptionCue = z.object({
  id: z.string(),
  start: z.number(),
  end: z.number(),
  /** Display text (uppercased if the style says so), lines joined by \n. */
  text: z.string(),
  lines: z.array(z.string()).min(1),
  /** Spoken words the cue covers (timing source). In verbatim mode these are the displayed words. */
  words: z.array(CaptionWordZ).min(1),
  emphasis_word: z.string().nullable().default(null),
});
export type CaptionCue = z.infer<typeof CaptionCue>;

export const CaptionsOutput = z.object({
  style: CaptionStyle,
  mode: CaptionMode,
  /** Where word timings came from. */
  timing_source: z.enum(["whisper_cpp", "voicestudio", "line_timing"]),
  transcript: z.string(),
  words: z.array(CaptionWordZ),
  cues: z.array(CaptionCue),
});
export type CaptionsOutput = z.infer<typeof CaptionsOutput>;

export const CaptionsAgentInput = z.object({
  narration_path: z.string(),
  audio_timeline: AudioTimeline,
  script: ScriptOutput.optional(),
  style: CaptionStyleName.default("Podcast"),
  /** Override the preset's mode. */
  mode: CaptionMode.optional(),
  language: z.string().default("en"),
  notes: z.string().default(""),
});
export type CaptionsAgentInput = z.infer<typeof CaptionsAgentInput>;

/** LLM output for condensed mode: pages mapped onto spoken-word index spans. */
export const CondensedPages = z.object({
  pages: z
    .array(z.object({ from_word: z.number().int().min(0), to_word: z.number().int().min(0), lines: z.array(z.string()).min(1).max(3), emphasis_word: z.string().nullable() }))
    .min(1),
});

const base = { letter_spacing: 0, line_height: 1.15, safe_top: 0.08, safe_bottom: 0.14 };
export const CAPTION_PRESETS: Record<CaptionStyleName, CaptionStyle> = {
  Clean: { ...base, name: "Clean", mode: "verbatim", font_family: "Inter, Arial, sans-serif", font_size: 56, font_weight: 700, color: "#FFFFFF", highlight_color: "#FFFFFF", active_word: "color", background: "shadow", uppercase: false, animation: "fade", preferred_position: "above_presenter", max_chars_per_line: 22, max_lines: 2 },
  Bold: { ...base, name: "Bold", mode: "condensed", font_family: "Inter, Arial, sans-serif", font_size: 76, font_weight: 900, color: "#FFFFFF", highlight_color: "#FFD84D", active_word: "highlight_box", background: "shadow", uppercase: true, letter_spacing: 1, animation: "pop", preferred_position: "center", max_chars_per_line: 16, max_lines: 2 },
  Podcast: { ...base, name: "Podcast", mode: "condensed", font_family: "Inter, Arial, sans-serif", font_size: 64, font_weight: 800, color: "#FFFFFF", highlight_color: "#FFD84D", active_word: "highlight_box", background: "shadow", uppercase: true, letter_spacing: 0.5, animation: "word_pop", preferred_position: "above_presenter", max_chars_per_line: 18, max_lines: 2 },
  Karaoke: { ...base, name: "Karaoke", mode: "verbatim", font_family: "Inter, Arial, sans-serif", font_size: 60, font_weight: 800, color: "#D8DCE6", highlight_color: "#22D3A5", active_word: "color", background: "shadow", uppercase: true, animation: "none", preferred_position: "above_presenter", max_chars_per_line: 20, max_lines: 2 },
  Minimal: { ...base, name: "Minimal", mode: "verbatim", font_family: "Inter, Arial, sans-serif", font_size: 44, font_weight: 500, color: "#FFFFFF", highlight_color: "#FFFFFF", active_word: "none", background: "none", uppercase: false, animation: "fade", preferred_position: "lower_third", max_chars_per_line: 30, max_lines: 2 },
  Trading: { ...base, name: "Trading", mode: "condensed", font_family: "JetBrains Mono, Menlo, monospace", font_size: 58, font_weight: 700, color: "#E8FFF7", highlight_color: "#22D3A5", active_word: "underline", background: "bar", uppercase: true, letter_spacing: 1.5, animation: "typewriter", preferred_position: "above_presenter", max_chars_per_line: 18, max_lines: 2 },
  Cinematic: { ...base, name: "Cinematic", mode: "condensed", font_family: "Georgia, 'Times New Roman', serif", font_size: 52, font_weight: 600, color: "#F5E6C8", highlight_color: "#F5E6C8", active_word: "scale", background: "none", uppercase: false, letter_spacing: 2, animation: "fade", preferred_position: "center", max_chars_per_line: 26, max_lines: 2 },
  News: { ...base, name: "News", mode: "verbatim", font_family: "Inter, Arial, sans-serif", font_size: 50, font_weight: 700, color: "#FFFFFF", highlight_color: "#FF3B3B", active_word: "color", background: "bar", uppercase: false, animation: "slide_up", preferred_position: "lower_third", max_chars_per_line: 28, max_lines: 2 },
};
