import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { LLM } from "../src/providers/llm/llm.js";
import { IllustrationAgent, IllustrationPlan, lintPlan, loadRegistry, selectModel, DiffusersLocalAdapter, HfInferenceAdapter, LongCatVideoAdapter, type RegistryModel } from "../src/agents/illustration/index.js";
import type { GenerationAdapter } from "../src/agents/illustration/providers.js";
import type { ScriptOutput } from "../src/agents/script/schema.js";

const script: ScriptOutput = {
  duration: 12, hook: "h", cta: "c", sources: [], review: { changes_made: [], remaining_risks: [] },
  beats: [
    { id: "beat_01", start: 0, end: 4, narration: "Price sweeps the high and reverses.", purpose: "hook", visual_intent: "show the sweep", claim_kinds: [] },
    { id: "beat_02", start: 4, end: 9, narration: "After three losses your judgement is not the same.", purpose: "explanation", visual_intent: "the feeling after losses", claim_kinds: [] },
    { id: "beat_03", start: 9, end: 12, narration: "Wait for the reclaim.", purpose: "cta", visual_intent: "cta", claim_kinds: [] },
  ],
};
const plan: IllustrationPlan = {
  decisions: [
    { beat_id: "beat_01", need: "chart", ladder: ["text? no", "animate? yes, chart"], rationale: "mechanism → chart animation", prompt: "", negative_prompt: "", style: "", aspect: "16:9", requirements: { quality_min: 3, consistency_min: 2, commercial: true }, duration_sec: 4 },
    { beat_id: "beat_02", need: "ai_image", ladder: ["text? no", "animate? no", "chart? no", "library? nothing", "still carries it"], rationale: "psychology → cinematic still", prompt: "a trader alone at a dim desk, head in hands, monitors glowing, shallow depth of field, moody", negative_prompt: "text, watermark, blur", style: "editorial", aspect: "16:9", requirements: { quality_min: 3, consistency_min: 2, commercial: true }, duration_sec: 4 },
    { beat_id: "beat_03", need: "text", ladder: ["text? yes"], rationale: "CTA is typographic", prompt: "", negative_prompt: "", style: "", aspect: "9:16", requirements: { quality_min: 3, consistency_min: 2, commercial: true }, duration_sec: 4 },
  ],
};
const input = { script, style: "", motion_beat_ids: ["beat_01"], text_beat_ids: ["beat_03"], commercial: true, generate: false, vram_gb: 0, notes: "" };

describe("model registry", () => {
  const models = loadRegistry();
  it("loads approved models and selects by constraints", () => {
    expect(models.length).toBeGreaterThan(3);
    const noGpu = selectModel(models, { kind: "image", commercial: true, quality_min: 3, consistency_min: 2, vram_gb: 0, available: { hf_inference: true, diffusers_local: true, longcat_video: false } });
    expect(noGpu.chosen?.model.adapter).toBe("hf_inference");
    const gpu = selectModel(models, { kind: "image", commercial: true, quality_min: 3, consistency_min: 2, vram_gb: 24, available: { hf_inference: false, diffusers_local: true, longcat_video: false } });
    expect(gpu.chosen?.model.id).toBe("black-forest-labs/FLUX.1-schnell");
    const nonCommercial = selectModel(models, { kind: "image", commercial: false, quality_min: 5, consistency_min: 2, vram_gb: 24, available: { diffusers_local: true } });
    expect(nonCommercial.chosen?.model.id).toBe("black-forest-labs/FLUX.1-dev");
    const commercialHighQ = selectModel(models, { kind: "image", commercial: true, quality_min: 5, consistency_min: 2, vram_gb: 24, available: { diffusers_local: true } });
    expect(commercialHighQ.chosen).toBeUndefined();
    expect(commercialHighQ.rejected.find((r) => r.model.id.includes("FLUX.1-dev"))?.reasons.join()).toMatch(/not commercial/);
    const video = selectModel(models, { kind: "video", commercial: true, quality_min: 4, consistency_min: 3, vram_gb: 48, available: { longcat_video: true, diffusers_local: true } });
    expect(video.chosen?.model.id).toBe("meituan-longcat/LongCat-Video");
  });
});

describe("illustration lint", () => {
  it("accepts a plan that respects the ladder", () => {
    expect(lintPlan(plan, input)).toEqual([]);
  });
  it("rejects AI visuals for motion-covered beats, chart prompts, and too much AI video", () => {
    const bad: IllustrationPlan = { decisions: [{ ...plan.decisions[0], need: "ai_video", prompt: "cinematic candlestick chart", ladder: ["x"] }, { ...plan.decisions[1], need: "ai_video" }, plan.decisions[2]] };
    const p = lintPlan(bad, input).join("\n");
    expect(p).toMatch(/Motion Graphics covers this beat/);
    expect(p).toMatch(/must not ask for charts/);
    expect(p).toMatch(/full ladder/);
    expect(p).toMatch(/too many/);
  });
});

describe("adapters build documented commands", () => {
  const flux = loadRegistry().find((m) => m.id.includes("schnell") && m.adapter === "diffusers_local")!;
  it("diffusers runner args", () => {
    const args = DiffusersLocalAdapter.buildArgs("/s/diffusers_generate.py", flux, { prompt: "p", negativePrompt: "n", width: 1024, height: 768, outPath: "/o/x.png", seed: 7 });
    expect(args).toEqual(["/s/diffusers_generate.py", "--model", flux.id, "--kind", "image", "--prompt", "p", "--out", "/o/x.png", "--width", "1024", "--height", "768", "--seed", "7", "--negative", "n", "--steps", "4", "--guidance", "0"]);
  });
  it("hf inference request", () => {
    const a = new HfInferenceAdapter();
    const r = a.buildRequest(flux, { prompt: "p", negativePrompt: "", width: 1024, height: 1024, outPath: "/o.png" });
    expect(r.url).toBe(`https://router.huggingface.co/hf-inference/models/${flux.id}`);
    expect(r.body).toMatchObject({ inputs: "p", parameters: { width: 1024, height: 1024 } });
  });
  it("longcat torchrun args", () => {
    const args = LongCatVideoAdapter.buildArgs(2, "/w/LongCat-Video", { prompt: "p", negativePrompt: "", width: 832, height: 480, outPath: "/o/c.mp4", referenceImage: "/r.png" });
    expect(args).toEqual(["--nproc_per_node=2", "longcat_generate.py", "--checkpoint_dir=/w/LongCat-Video", "--context_parallel_size=2", "--prompt", "p", "--out", "/o/c.mp4", "--num_frames", "93", "--seed", "42", "--image", "/r.png", "--distill"]);
  });
});

describe("Illustration Agent run", () => {
  class Stub extends LLM {
    constructor() { super({ model: "stub", client: {} as never }); }
    override async structured<S extends z.ZodType>(): Promise<z.infer<S>> { return plan as z.infer<S>; }
  }
  it("marks AI beats pending when no adapter is available", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "illu-"));
    const out = await new IllustrationAgent({ llm: new Stub(), adapters: {} }).run({ script, motion_beat_ids: ["beat_01"], text_beat_ids: ["beat_03"], generate: true }, dir);
    expect(out.assets.map((a) => a.status)).toEqual(["skipped", "pending", "skipped"]);
    expect(out.assets[1].detail).toMatch(/no available image model/);
    expect(fs.existsSync(path.join(dir, "illustration.json"))).toBe(true);
  });
  it("generates through the registry-selected adapter", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "illu-"));
    const fake: GenerationAdapter = { name: "hf_inference", health: async () => ({ ok: true, detail: "fake" }), generate: async (_m: RegistryModel, req) => { fs.writeFileSync(req.outPath, "png"); return req.outPath; } };
    const out = await new IllustrationAgent({ llm: new Stub(), adapters: { hf_inference: fake } }).run({ script, motion_beat_ids: ["beat_01"], text_beat_ids: ["beat_03"], generate: true, vram_gb: 0 }, dir);
    expect(out.assets[1]).toMatchObject({ status: "generated", kind: "image", adapter: "hf_inference", model: "black-forest-labs/FLUX.1-schnell" });
    expect(fs.existsSync(out.assets[1].path!)).toBe(true);
  });
});
