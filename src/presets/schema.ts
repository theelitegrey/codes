import { z } from "zod";
import { ShortMode } from "../core/project.js";
import { PresenterPosition, PresenterSize } from "../core/scene.js";

/**
 * A mode preset drives composition defaults. The Visual Director may override
 * per scene, but the preset sets the baseline aesthetic and pacing.
 */
export const ModePreset = z.object({
  id: ShortMode,
  label: z.string(),
  description: z.string(),
  aspect_ratio: z.literal("9:16").default("9:16"),
  width: z.number().int().default(1080),
  height: z.number().int().default(1920),
  fps: z.number().int().default(30),
  presenter: z.object({
    enabled_by_default: z.boolean(),
    position: PresenterPosition,
    size: PresenterSize,
    /** Fraction of the frame height the presenter panel occupies by default. */
    height_fraction: z.number().min(0.15).max(1),
    /** Range the Visual Director may pick from. */
    height_fraction_range: z.tuple([z.number(), z.number()]),
    /** Extra descriptors appended to the avatar prompt. */
    prompt_hints: z.array(z.string()).default([]),
  }),
  captions: z.object({
    style: z.enum(["dynamic_word", "line", "karaoke", "minimal"]),
    position: z.enum(["center", "lower_third", "above_presenter", "top"]),
    font_family: z.string().default("Inter, Arial, sans-serif"),
    font_weight: z.number().default(800),
    highlight_color: z.string().default("#FFD84D"),
  }),
  visual: z.object({
    background: z.enum(["clean_dark", "clean_light", "gradient", "studio", "cinematic_grain", "newsroom", "terminal"]),
    accent_color: z.string(),
    camera_motion: z.enum(["none", "subtle", "dynamic"]),
    /** Target seconds per scene; drives how many visual changes happen. */
    target_scene_seconds: z.number(),
    transitions: z.enum(["cut", "slide", "fade", "zoom"]),
  }),
  audio: z.object({ music: z.string().default(""), music_volume_db: z.number().default(-22), sfx_on_scene_change: z.boolean().default(false) }),
});
export type ModePreset = z.infer<typeof ModePreset>;

export const BUILTIN_PRESETS: Record<ShortMode, ModePreset> = {
  PODCAST_SHORT: {
    id: "PODCAST_SHORT",
    label: "Podcast Short",
    description: "Presenter in the lower half, main content on top, dynamic captions, subtle camera motion, fast visual changes, clean background.",
    aspect_ratio: "9:16",
    width: 1080,
    height: 1920,
    fps: 30,
    presenter: {
      enabled_by_default: true,
      position: "bottom",
      size: "medium",
      height_fraction: 0.45,
      height_fraction_range: [0.35, 0.5],
      prompt_hints: ["podcast studio", "medium shot, chest-up", "looking toward camera", "natural hand gestures", "soft key light", "clean modern background"],
    },
    captions: { style: "dynamic_word", position: "above_presenter", font_family: "Inter, Arial, sans-serif", font_weight: 800, highlight_color: "#FFD84D" },
    visual: { background: "clean_dark", accent_color: "#4F8CFF", camera_motion: "subtle", target_scene_seconds: 5, transitions: "slide" },
    audio: { music: "", music_volume_db: -22, sfx_on_scene_change: true },
  },
  FULLSCREEN: {
    id: "FULLSCREEN",
    label: "Fullscreen",
    description: "Presenter fills the frame; visuals appear as overlays or cut-ins.",
    aspect_ratio: "9:16",
    width: 1080,
    height: 1920,
    fps: 30,
    presenter: {
      enabled_by_default: true,
      position: "center",
      size: "full",
      height_fraction: 1,
      height_fraction_range: [0.6, 1],
      prompt_hints: ["waist-up", "looking at camera", "expressive", "studio lighting"],
    },
    captions: { style: "dynamic_word", position: "center", font_family: "Inter, Arial, sans-serif", font_weight: 800, highlight_color: "#FFFFFF" },
    visual: { background: "clean_dark", accent_color: "#FFFFFF", camera_motion: "subtle", target_scene_seconds: 6, transitions: "cut" },
    audio: { music: "", music_volume_db: -24, sfx_on_scene_change: false },
  },
  NEWS: {
    id: "NEWS",
    label: "News",
    description: "Newsroom look: headline bar, lower-third, presenter bottom-left, fast cuts.",
    aspect_ratio: "9:16",
    width: 1080,
    height: 1920,
    fps: 30,
    presenter: {
      enabled_by_default: true,
      position: "bottom",
      size: "medium",
      height_fraction: 0.4,
      height_fraction_range: [0.35, 0.45],
      prompt_hints: ["news anchor framing", "chest-up", "direct eye contact", "even lighting", "newsroom backdrop"],
    },
    captions: { style: "line", position: "lower_third", font_family: "Inter, Arial, sans-serif", font_weight: 700, highlight_color: "#FF3B3B" },
    visual: { background: "newsroom", accent_color: "#E0242C", camera_motion: "none", target_scene_seconds: 4, transitions: "cut" },
    audio: { music: "", music_volume_db: -26, sfx_on_scene_change: true },
  },
  TRADING: {
    id: "TRADING",
    label: "Trading",
    description: "Charts dominate the upper frame; presenter bottom; terminal-style palette.",
    aspect_ratio: "9:16",
    width: 1080,
    height: 1920,
    fps: 30,
    presenter: {
      enabled_by_default: true,
      position: "bottom",
      size: "medium",
      height_fraction: 0.4,
      height_fraction_range: [0.35, 0.45],
      prompt_hints: ["trading desk", "multiple monitors softly glowing in background", "chest-up", "confident", "cool key light"],
    },
    captions: { style: "karaoke", position: "above_presenter", font_family: "JetBrains Mono, Menlo, monospace", font_weight: 700, highlight_color: "#22D3A5" },
    visual: { background: "terminal", accent_color: "#22D3A5", camera_motion: "subtle", target_scene_seconds: 5, transitions: "slide" },
    audio: { music: "", music_volume_db: -24, sfx_on_scene_change: true },
  },
  EDUCATIONAL: {
    id: "EDUCATIONAL",
    label: "Educational",
    description: "Whiteboard-like clarity: diagrams and text on top, presenter below, slower pacing.",
    aspect_ratio: "9:16",
    width: 1080,
    height: 1920,
    fps: 30,
    presenter: {
      enabled_by_default: true,
      position: "bottom",
      size: "medium",
      height_fraction: 0.42,
      height_fraction_range: [0.35, 0.5],
      prompt_hints: ["friendly teacher", "chest-up", "warm lighting", "simple light background"],
    },
    captions: { style: "line", position: "above_presenter", font_family: "Inter, Arial, sans-serif", font_weight: 700, highlight_color: "#2563EB" },
    visual: { background: "clean_light", accent_color: "#2563EB", camera_motion: "none", target_scene_seconds: 7, transitions: "fade" },
    audio: { music: "", music_volume_db: -26, sfx_on_scene_change: false },
  },
  CINEMATIC: {
    id: "CINEMATIC",
    label: "Cinematic",
    description: "Film-look visuals with grain and slow motion; presenter appears sparingly.",
    aspect_ratio: "9:16",
    width: 1080,
    height: 1920,
    fps: 30,
    presenter: {
      enabled_by_default: false,
      position: "bottom",
      size: "small",
      height_fraction: 0.35,
      height_fraction_range: [0.3, 0.4],
      prompt_hints: ["cinematic lighting", "shallow depth of field", "moody", "chest-up"],
    },
    captions: { style: "minimal", position: "center", font_family: "Georgia, serif", font_weight: 600, highlight_color: "#F5E6C8" },
    visual: { background: "cinematic_grain", accent_color: "#F5E6C8", camera_motion: "dynamic", target_scene_seconds: 6, transitions: "fade" },
    audio: { music: "", music_volume_db: -18, sfx_on_scene_change: false },
  },
};

