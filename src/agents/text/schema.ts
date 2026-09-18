import { z } from "zod";
import { ScriptOutput } from "../script/schema.js";

export const TextAgentInput = z.object({
  script: ScriptOutput,
  platform: z.enum(["youtube_shorts", "tiktok", "instagram_reels", "youtube", "x"]).default("youtube_shorts"),
  brand: z.string().default("direct, modern, minimal"),
  tone: z.string().default("confident and clear"),
  /** Extra instructions, e.g. "no lower-thirds", "chips only". */
  notes: z.string().default(""),
});
export type TextAgentInput = z.infer<typeof TextAgentInput>;

export const TextType = z.enum(["headline", "keyword", "label", "lower_third", "statistic", "chart_label", "section_title", "cta", "explainer", "highlight_word", "chip"]);
export type TextType = z.infer<typeof TextType>;

/** Mobile-safe positions. "center" is reserved for hero moments; avoid top-* on beats with a headline main visual. */
export const TextPosition = z.enum(["top-left", "top-center", "top-right", "middle-left", "center", "middle-right", "bottom-left", "bottom-center", "bottom-right", "above-presenter", "lower-third"]);
export type TextPosition = z.infer<typeof TextPosition>;

export const TextAnimation = z.enum(["none", "fade", "slide-up", "slide-down", "slide-left", "slide-right", "pop", "typewriter", "wipe", "count-up"]);

export const TextElement = z.object({
  id: z.string(),
  beat_id: z.string(),
  text: z.string().min(1),
  type: TextType,
  /** 1 = main headline … 4 = small label. Drives size. */
  level: z.number().int().min(1).max(4),
  start: z.number().min(0),
  end: z.number().positive(),
  position: TextPosition,
  animation: TextAnimation.default("fade"),
  emphasis: z.boolean().default(false),
  /** Chain membership for stacked sequences (PREVIOUS HIGH ↓ LIQUIDITY ↓ SWEEP). */
  group: z.string().nullable().default(null),
  order: z.number().int().min(0).default(0),
  /** Why this text exists (kept for review; not rendered). */
  rationale: z.string().default(""),
});
export type TextElement = z.infer<typeof TextElement>;

export const TextOutput = z.object({
  elements: z.array(TextElement),
  /** Beats the agent deliberately left without text and why. */
  silent_beats: z.array(z.object({ beat_id: z.string(), reason: z.string() })).default([]),
});
export type TextOutput = z.infer<typeof TextOutput>;

export const MAX_WORDS_BY_LEVEL: Record<number, number> = { 1: 4, 2: 5, 3: 8, 4: 3 };
export const MAX_VISIBLE_AT_ONCE = 3;
