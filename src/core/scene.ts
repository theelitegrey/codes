import { z } from "zod";

/**
 * Structured scene model. Every Short is a list of these. The Visual Director
 * decides per scene whether the presenter appears, where, and how large, and
 * what occupies the main (upper) visual area.
 */

export const PresenterPosition = z.enum(["bottom", "top", "left", "right", "center", "pip"]);
export type PresenterPosition = z.infer<typeof PresenterPosition>;

export const PresenterSize = z.enum(["small", "medium", "large", "full"]);
export type PresenterSize = z.infer<typeof PresenterSize>;

export const ScenePresenter = z.object({
  enabled: z.boolean().default(true),
  position: PresenterPosition.default("bottom"),
  size: PresenterSize.default("medium"),
  /** Optional explicit fraction of frame height the presenter occupies (0.35–0.5 by default). */
  height_fraction: z.number().min(0.15).max(1).optional(),
});
export type ScenePresenter = z.infer<typeof ScenePresenter>;

/** A self-contained chart description that the Remotion renderer can draw without external tools. */
export const ChartSpec = z.object({
  kind: z.enum(["line", "candlestick", "bar", "area"]),
  title: z.string().optional(),
  /** Series values. For candlestick, each point is [open, high, low, close]. */
  series: z.array(z.union([z.number(), z.tuple([z.number(), z.number(), z.number(), z.number()])])),
  labels: z.array(z.string()).optional(),
  annotations: z
    .array(
      z.object({
        index: z.number().int().min(0),
        label: z.string(),
        /** Optional price/value level for a horizontal marker */
        level: z.number().optional(),
        color: z.string().optional(),
      })
    )
    .default([]),
  /** Reveal the chart progressively over the scene duration */
  animate: z.boolean().default(true),
});
export type ChartSpec = z.infer<typeof ChartSpec>;

export const MainVisual = z.object({
  type: z.enum(["chart", "broll", "image", "screen_recording", "ai_visual", "headline", "graphic", "none"]),
  /** Path to a media asset (mp4/png/jpg). Resolved by the pipeline; may be absent for generated types. */
  asset: z.string().optional(),
  /** Text-to-image / video prompt kept for asset providers (ai_visual, broll). */
  prompt: z.string().optional(),
  /** Chart definition when type === "chart". */
  chart: ChartSpec.optional(),
  /** Headline text when type === "headline"/"graphic". */
  headline: z.string().optional(),
  subheadline: z.string().optional(),
  /** Ken-Burns style motion hint for still assets. */
  motion: z.enum(["none", "slow_zoom", "pan_left", "pan_right", "push_in"]).default("slow_zoom"),
});
export type MainVisual = z.infer<typeof MainVisual>;

export const Scene = z.object({
  scene_id: z.number().int().min(1),
  /** Planned duration in seconds. Replaced by measured narration timing after voice generation. */
  duration: z.number().positive(),
  narration: z.string(),
  presenter: ScenePresenter.default({ enabled: true, position: "bottom", size: "medium" }),
  main_visual: MainVisual,
  text_overlay: z.string().default(""),
  caption: z.string().default(""),
  music: z.string().default(""),
  sound_effect: z.string().default(""),
  /** Filled by the pipeline: narration start offset in the full audio track (seconds). */
  start_time: z.number().min(0).optional(),
});
export type Scene = z.infer<typeof Scene>;

export const SceneList = z.array(Scene).min(1);

/** Word-level caption timing. */
export const CaptionWord = z.object({ word: z.string(), start: z.number(), end: z.number() });
export type CaptionWord = z.infer<typeof CaptionWord>;

export const CaptionTrack = z.object({
  words: z.array(CaptionWord),
  /** Source of timings: "transcription" (VoiceStudio verbose_json) or "estimated". */
  source: z.enum(["transcription", "estimated"]),
});
export type CaptionTrack = z.infer<typeof CaptionTrack>;
