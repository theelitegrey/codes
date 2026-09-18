import { z } from "zod";
import { ScriptOutput } from "../script/schema.js";
export { MotionPlan, BeatMotion, MotionLayer, MotionTheme, MotionPreviewProps, ChartOverlay } from "../../../remotion/motion/schema.js";
export type { MotionPlan as MotionPlanT, BeatMotion as BeatMotionT } from "../../../remotion/motion/schema.js";

export const MotionAgentInput = z.object({
  script: ScriptOutput,
  /** Stage size the motion graphics are designed for (the Composer places this panel in the 9:16 frame). */
  width: z.number().int().default(1080),
  height: z.number().int().default(1080),
  fps: z.number().int().default(30),
  style: z.string().default("clean, dark, terminal-inspired trading graphics"),
  /** Only plan these beats (ids); default all. */
  beat_ids: z.array(z.string()).default([]),
  /** Optional measured timeline from the Audio Agent (beat start/end) to replace the script's planned times. */
  timing: z.array(z.object({ beat_id: z.string(), start: z.number(), end: z.number() })).default([]),
  notes: z.string().default(""),
});
export type MotionAgentInput = z.infer<typeof MotionAgentInput>;
