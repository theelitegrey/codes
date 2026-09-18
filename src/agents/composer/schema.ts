import { z } from "zod";
import { ScriptOutput } from "../script/schema.js";
import { TextOutput } from "../text/schema.js";
import { AudioTimeline } from "../audio/schema.js";
import { MotionPlan } from "../../../remotion/motion/schema.js";
import { IllustrationOutput } from "../illustration/schema.js";
import { PresenterOutput } from "../presenter/schema.js";
import { CaptionsOutput } from "../captions/schema.js";
import { BrandSettings } from "../../project/manifest.js";

export const ComposerInputs = z.object({
  script: ScriptOutput,
  text: TextOutput.nullable(),
  audio_timeline: AudioTimeline,
  /** Relative to the project dir. */
  master_audio: z.string(),
  motion: MotionPlan.nullable(),
  illustration: IllustrationOutput.nullable(),
  presenter: PresenterOutput.nullable(),
  captions: CaptionsOutput.nullable(),
  brand: BrandSettings,
});
export type ComposerInputs = z.infer<typeof ComposerInputs>;

/** What the LLM may change on top of the engine's default layout. */
export const SceneOverride = z.object({
  beat_id: z.string(),
  transition_in: z.enum(["cut", "fade", "slide_left", "slide_up", "zoom"]).optional(),
  /** Force the presenter panel height share for this scene (within the presenter plan's range ±0.08), or hide it if the Presenter Agent allowed. */
  presenter_scale: z.number().min(0.25).max(1).optional(),
  presenter_hidden: z.boolean().optional(),
  /** Caption slot preference for this scene. */
  caption_slot: z.enum(["above_presenter", "center", "lower_third", "top_third", "auto"]).optional(),
  /** Drop these text element ids in this scene (low value / collision). */
  drop_text_ids: z.array(z.string()).default([]),
  /** Add a temporary effect at the scene start. */
  effect: z.enum(["none", "flash", "vignette_pulse"]).default("none"),
  reason: z.string().default(""),
});
export const ComposerOverrides = z.object({ scenes: z.array(SceneOverride) });
export type ComposerOverrides = z.infer<typeof ComposerOverrides>;

export const RenderSpec = z.object({
  platform: z.enum(["youtube_shorts", "tiktok", "instagram_reels"]),
  width: z.literal(1080).default(1080),
  height: z.literal(1920).default(1920),
  fps: z.union([z.literal(30), z.literal(60)]).default(30),
  crf: z.number().default(18),
  /** Preview: half resolution, faster preset. */
  preview: z.boolean().default(false),
});
export type RenderSpec = z.infer<typeof RenderSpec>;
