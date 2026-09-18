import { z } from "zod";
import { SceneList, CaptionTrack } from "./scene.js";

export const ShortMode = z.enum(["PODCAST_SHORT", "FULLSCREEN", "NEWS", "TRADING", "EDUCATIONAL", "CINEMATIC"]);
export type ShortMode = z.infer<typeof ShortMode>;

/** Parsed user intent ("Create a 45-second Short explaining X. Use my default presenter."). */
export const ShortRequest = z.object({
  topic: z.string(),
  target_duration_sec: z.number().min(10).max(180).default(45),
  mode: ShortMode.default("PODCAST_SHORT"),
  presenter_id: z.string().default("default_host"),
  voice_id: z.string().default("default"),
  audience: z.string().default("general social-media audience"),
  language: z.string().default("en"),
  extra_instructions: z.string().default(""),
});
export type ShortRequest = z.infer<typeof ShortRequest>;

export const ResearchResult = z.object({
  summary: z.string(),
  key_facts: z.array(z.object({ fact: z.string(), source: z.string().optional(), confidence: z.enum(["high", "medium", "low"]) })),
  terminology: z.array(z.object({ term: z.string(), definition: z.string() })),
  angles: z.array(z.string()),
});
export type ResearchResult = z.infer<typeof ResearchResult>;

export const HookSet = z.object({
  hooks: z.array(z.object({ text: z.string(), style: z.string(), rationale: z.string() })).min(3),
  selected_index: z.number().int().min(0),
});
export type HookSet = z.infer<typeof HookSet>;

export const Script = z.object({
  title_working: z.string(),
  hook: z.string(),
  /** Ordered beats; each becomes one scene. */
  beats: z
    .array(
      z.object({
        narration: z.string(),
        purpose: z.enum(["hook", "context", "explanation", "example", "payoff", "cta"]),
        visual_idea: z.string(),
        est_seconds: z.number().positive(),
      })
    )
    .min(3),
  cta: z.string(),
  estimated_total_seconds: z.number(),
});
export type Script = z.infer<typeof Script>;

export const FactCheckResult = z.object({
  verdict: z.enum(["pass", "revise"]),
  issues: z.array(z.object({ claim: z.string(), problem: z.string(), fix: z.string(), severity: z.enum(["low", "medium", "high"]) })),
  revised_script: Script.optional(),
});
export type FactCheckResult = z.infer<typeof FactCheckResult>;

export const RetentionReview = z.object({
  score: z.number().min(0).max(100),
  predicted_drop_points: z.array(z.object({ scene_id: z.number(), reason: z.string(), fix: z.string() })),
  pacing_notes: z.string(),
  approved: z.boolean(),
  /** Non-narration tweaks the pipeline may apply (audio is already locked at this point). */
  scene_adjustments: z
    .array(
      z.object({
        scene_id: z.number(),
        text_overlay: z.string().optional(),
        presenter_enabled: z.boolean().optional(),
        main_visual_type: z.enum(["chart", "broll", "image", "screen_recording", "ai_visual", "headline", "graphic", "none"]).optional(),
        headline: z.string().optional(),
      })
    )
    .default([]),
});
export type RetentionReview = z.infer<typeof RetentionReview>;

export const Metadata = z.object({
  title: z.string().max(100),
  description: z.string(),
  caption: z.string(),
  hashtags: z.array(z.string()).min(3).max(20),
});
export type Metadata = z.infer<typeof Metadata>;

export const QAReport = z.object({
  passed: z.boolean(),
  checks: z.array(z.object({ name: z.string(), passed: z.boolean(), detail: z.string() })),
});
export type QAReport = z.infer<typeof QAReport>;

/** Everything the pipeline produces, persisted as project.json in the output folder. */
export const ProjectState = z.object({
  id: z.string(),
  created_at: z.string(),
  request: ShortRequest,
  research: ResearchResult.optional(),
  hooks: HookSet.optional(),
  script: Script.optional(),
  fact_check: FactCheckResult.optional(),
  scenes: SceneList.optional(),
  narration: z
    .object({
      audio_path: z.string(),
      duration_sec: z.number(),
      provider: z.string(),
      voice_id: z.string(),
      /** Per-scene narration segments (paths + durations) when the provider generated scene-by-scene. */
      segments: z.array(z.object({ scene_id: z.number(), path: z.string(), duration_sec: z.number() })).default([]),
    })
    .optional(),
  presenter_video: z
    .object({ path: z.string(), width: z.number(), height: z.number(), fps: z.number(), duration_sec: z.number(), provider: z.string() })
    .optional(),
  captions: CaptionTrack.optional(),
  retention: RetentionReview.optional(),
  metadata: Metadata.optional(),
  qa: QAReport.optional(),
  final_mp4: z.string().optional(),
  stage_log: z.array(z.object({ stage: z.string(), status: z.enum(["ok", "skipped", "failed"]), detail: z.string().optional(), at: z.string() })).default([]),
});
export type ProjectState = z.infer<typeof ProjectState>;
