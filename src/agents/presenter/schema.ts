import { z } from "zod";
import { ScriptOutput } from "../script/schema.js";
import { AudioTimeline } from "../audio/schema.js";

export const PresenterPositionZ = z.enum(["bottom", "top", "pip", "center"]);
export const CameraSize = z.enum(["medium", "medium_close", "close"]);
export const Expression = z.enum(["neutral", "confident", "curious", "serious", "warm", "surprised", "amused"]);
export const Gesture = z.enum(["still", "subtle_hand_gesture", "natural_hand_gesture", "expressive_hand_gesture", "pointing", "counting"]);

export const BeatPresenter = z.object({
  beat_id: z.string(),
  presenter_enabled: z.boolean(),
  position: PresenterPositionZ.default("bottom"),
  /** Share of frame height the presenter panel occupies. */
  scale: z.number().min(0.25).max(1).default(0.42),
  camera: CameraSize.default("medium"),
  expression: Expression.default("confident"),
  gesture: Gesture.default("natural_hand_gesture"),
  eye_contact: z.enum(["direct", "mostly_direct", "glancing"]).default("direct"),
  background: z.enum(["transparent_or_keyable", "styled"]).default("transparent_or_keyable"),
  reason: z.string().default(""),
});
export type BeatPresenter = z.infer<typeof BeatPresenter>;

export const PresenterShot = z.object({
  camera_angle: z.string(),
  shot_size: CameraSize,
  body_position: z.string(),
  gesture_style: z.string(),
  eye_contact: z.string(),
  clothing: z.string(),
  background: z.string(),
  lighting: z.string(),
  personality: z.string(),
  background_mode: z.enum(["keyable", "styled"]),
  /** Full generation prompt sent to the avatar model. */
  prompt: z.string(),
});
export type PresenterShot = z.infer<typeof PresenterShot>;

export const PresenterPlan = z.object({
  profile_id: z.string(),
  shot: PresenterShot,
  beats: z.array(BeatPresenter).min(1),
});
export type PresenterPlan = z.infer<typeof PresenterPlan>;

export const PresenterAgentInput = z.object({
  script: ScriptOutput,
  /** From the Audio Agent: measured timeline + final narration path. Required. */
  audio_timeline: AudioTimeline,
  narration_path: z.string(),
  profile_id: z.string().default("default"),
  mode: z.string().default("PODCAST_SHORT"),
  /** Beats whose visuals want the full frame (from the Motion/Illustration plans). */
  fullframe_beat_ids: z.array(z.string()).default([]),
  background_mode: z.enum(["keyable", "styled", "auto"]).default("auto"),
  /** Plan only; skip LongCat generation. */
  generate: z.boolean().default(true),
  notes: z.string().default(""),
});
export type PresenterAgentInput = z.infer<typeof PresenterAgentInput>;

export const PresenterOutput = z.object({
  plan: PresenterPlan,
  video: z.object({ raw: z.string(), keyed: z.string().nullable(), width: z.number(), height: z.number(), fps: z.number(), duration_sec: z.number(), provider: z.string() }).nullable(),
  status: z.enum(["generated", "planned_only", "provider_unavailable"]),
  detail: z.string().default(""),
});
export type PresenterOutput = z.infer<typeof PresenterOutput>;

/** Chroma-key backdrop colour the prompt asks for and the keyer removes. */
export const KEY_COLOR = { hex: "0x1DB954", name: "flat uniform bright green" };
