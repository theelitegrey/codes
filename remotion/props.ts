import { z } from "zod";
import { Scene, CaptionTrack } from "../src/core/scene.js";
import { ModePreset } from "../src/presets/schema.js";

/** Input props for the Short composition. All media paths are relative to Remotion's publicDir (the project folder). */
export const ShortProps = z.object({
  preset: ModePreset,
  scenes: z.array(Scene),
  narration: z.object({ src: z.string(), duration_sec: z.number() }),
  presenter: z
    .object({
      src: z.string(),
      width: z.number(),
      height: z.number(),
      fps: z.number(),
      duration_sec: z.number(),
      crop: z.enum(["center", "face_weighted"]).default("face_weighted"),
      feather_px: z.number().default(48),
      vignette: z.boolean().default(true),
      color_grade: z.boolean().default(true),
    })
    .optional(),
  /** scene_id -> relative asset path (video/image) resolved by the visual provider. */
  assets: z.record(z.string(), z.object({ src: z.string(), kind: z.enum(["video", "image"]) })).default({}),
  captions: CaptionTrack,
  music: z.object({ src: z.string(), volume_db: z.number() }).optional(),
  topic: z.string().default(""),
});
export type ShortProps = z.infer<typeof ShortProps>;
