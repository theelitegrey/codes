import { z } from "zod";
import { ScriptOutput } from "../script/schema.js";

export const IllustrationNeed = z.enum(["text", "motion", "chart", "library", "ai_image", "ai_video", "none"]);
export type IllustrationNeed = z.infer<typeof IllustrationNeed>;

export const AssetAspect = z.enum(["16:9", "9:16", "1:1", "4:5"]);

export const BeatDecision = z.object({
  beat_id: z.string(),
  need: IllustrationNeed,
  /** One sentence per ladder step you passed through. */
  ladder: z.array(z.string()).min(1),
  rationale: z.string(),
  /** For library: search keywords. For ai_*: the generation prompt. */
  prompt: z.string().default(""),
  negative_prompt: z.string().default(""),
  style: z.string().default(""),
  aspect: AssetAspect.default("16:9"),
  /** Requirements passed to the registry when need is ai_image / ai_video. */
  requirements: z.object({ quality_min: z.number().min(1).max(5).default(3), consistency_min: z.number().min(1).max(5).default(2), commercial: z.boolean().default(true) }).default({ quality_min: 3, consistency_min: 2, commercial: true }),
  /** Seconds of footage needed for ai_video (Composer loops/holds otherwise). */
  duration_sec: z.number().min(1).max(10).default(4),
});
export type BeatDecision = z.infer<typeof BeatDecision>;

export const IllustrationPlan = z.object({ decisions: z.array(BeatDecision) });
export type IllustrationPlan = z.infer<typeof IllustrationPlan>;

export const IllustrationAgentInput = z.object({
  script: ScriptOutput,
  style: z.string().default("clean, modern, dark, high-contrast editorial photography; no text"),
  /** Beats the Motion Graphics Agent already covers (its plan's beat ids) — the ladder must stop at `motion`/`chart` for these. */
  motion_beat_ids: z.array(z.string()).default([]),
  /** Beats the Text Agent covers with a strong headline — the ladder may stop at `text`. */
  text_beat_ids: z.array(z.string()).default([]),
  commercial: z.boolean().default(true),
  /** Generate assets after planning (needs an available adapter). */
  generate: z.boolean().default(false),
  /** VRAM available on this host (GB) for local models; 0 = no local GPU. */
  vram_gb: z.number().min(0).default(0),
  notes: z.string().default(""),
});
export type IllustrationAgentInput = z.infer<typeof IllustrationAgentInput>;

export const RegistryModel = z.object({
  id: z.string(),
  kind: z.enum(["image", "video"]),
  source: z.enum(["huggingface", "github", "other"]),
  adapter: z.enum(["diffusers_local", "hf_inference", "longcat_video"]),
  quality: z.number().min(1).max(5),
  speed: z.number().min(1).max(5),
  vram_gb: z.number().min(0),
  max_resolution: z.string(),
  consistency: z.number().min(1).max(5),
  license: z.string(),
  commercial_ok: z.boolean(),
  license_verified: z.boolean().default(false),
  notes: z.string().default(""),
});
export type RegistryModel = z.infer<typeof RegistryModel>;
export const ModelRegistry = z.object({ models: z.array(RegistryModel) });

export const GeneratedAsset = z.object({
  beat_id: z.string(),
  need: IllustrationNeed,
  status: z.enum(["generated", "library", "pending", "skipped", "failed"]),
  path: z.string().nullable(),
  kind: z.enum(["image", "video", "none"]),
  model: z.string().nullable(),
  adapter: z.string().nullable(),
  detail: z.string().default(""),
});
export type GeneratedAsset = z.infer<typeof GeneratedAsset>;

export const IllustrationOutput = z.object({ plan: IllustrationPlan, assets: z.array(GeneratedAsset) });
export type IllustrationOutput = z.infer<typeof IllustrationOutput>;
