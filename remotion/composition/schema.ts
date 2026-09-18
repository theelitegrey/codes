import { z } from "zod";
import { BeatMotion, MotionTheme } from "../motion/schema.js";
import { CaptionStyle, CaptionCue } from "../../src/agents/captions/schema.js";
import { TextElement } from "../../src/agents/text/schema.js";

/**
 * Master timeline the Composer writes to composition/timeline.json and the
 * ComposedShort composition renders. All times are absolute seconds on the
 * single master timeline (the Audio Agent's measured narration).
 */

export const Rect = z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() });
export type Rect = z.infer<typeof Rect>;

/** Standard z hierarchy; the Composer may override per layer. */
export const Z = { background: 0, illustration: 10, chart: 20, motion: 30, presenter: 40, text: 50, caption: 60, effect: 70 } as const;

const LayerBase = z.object({ id: z.string(), z: z.number().int(), start: z.number(), end: z.number(), rect: Rect });

export const BackgroundLayer = LayerBase.extend({ type: z.literal("background"), style: z.enum(["clean_dark", "clean_light", "gradient", "studio", "cinematic_grain", "newsroom", "terminal"]), accent: z.string(), motion: z.enum(["none", "subtle", "dynamic"]) });
export const IllustrationLayer = LayerBase.extend({ type: z.literal("illustration"), src: z.string(), kind: z.enum(["image", "video"]), fit: z.enum(["cover", "contain"]).default("cover"), motion: z.enum(["none", "slow_zoom", "pan_left", "pan_right", "push_in"]).default("slow_zoom"), mask: z.enum(["none", "rounded", "fade_bottom"]).default("fade_bottom") });
export const MotionLayerRef = LayerBase.extend({ type: z.literal("motion"), beat: BeatMotion });
export const PresenterLayer = LayerBase.extend({
  type: z.literal("presenter"),
  src: z.string(),
  /** src has an alpha channel (keyed ProRes 4444). */
  alpha: z.boolean(),
  src_width: z.number(),
  src_height: z.number(),
  /** Object-position focal point for cropping the landscape source into the panel. */
  focal: z.string().default("50% 22%"),
  scale_boost: z.number().default(1),
  feather_px: z.number().default(0),
  vignette: z.boolean().default(false),
  transition: z.enum(["slide_up", "fade", "none"]).default("slide_up"),
});
export const TextLayer = LayerBase.extend({ type: z.literal("text"), element: TextElement, font_scale: z.number().default(1) });
export const CaptionLayer = LayerBase.extend({ type: z.literal("caption"), cues: z.array(CaptionCue), style: CaptionStyle });
export const EffectLayer = LayerBase.extend({ type: z.literal("effect"), effect: z.enum(["flash", "shake", "vignette_pulse", "grain"]), intensity: z.number().default(0.5) });

export const Layer = z.discriminatedUnion("type", [BackgroundLayer, IllustrationLayer, MotionLayerRef, PresenterLayer, TextLayer, CaptionLayer, EffectLayer]);
export type Layer = z.infer<typeof Layer>;

export const SceneLayout = z.object({
  scene: z.number().int(),
  beat_id: z.string(),
  start: z.number(),
  end: z.number(),
  duration: z.number(),
  transition_in: z.enum(["cut", "fade", "slide_left", "slide_up", "zoom"]).default("cut"),
  /** Rects other layers must not cover; captions are placed away from these. */
  reserved: z.array(z.object({ owner: z.string(), rect: Rect })).default([]),
  caption_rect: Rect.nullable().default(null),
  layers: z.array(Layer),
});
export type SceneLayout = z.infer<typeof SceneLayout>;

export const MasterTimeline = z.object({
  width: z.number().int(),
  height: z.number().int(),
  fps: z.number().int(),
  duration: z.number(),
  /** Relative to the project dir (Remotion publicDir). */
  audio_src: z.string(),
  theme: MotionTheme,
  scenes: z.array(SceneLayout),
  /** Flat event list for humans and QA: what happens when. */
  events: z.array(z.object({ t: z.number(), kind: z.string(), detail: z.string() })).default([]),
});
export type MasterTimeline = z.infer<typeof MasterTimeline>;
