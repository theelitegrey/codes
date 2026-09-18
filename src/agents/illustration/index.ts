import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { LLM } from "../../providers/llm/llm.js";
import { log } from "../../core/log.js";
import { env } from "../../core/env.js";
import { LocalLibraryVisualProvider } from "../../providers/visuals/LocalLibraryVisualProvider.js";
import { IllustrationAgentInput, IllustrationPlan, IllustrationOutput, type BeatDecision, type GeneratedAsset, type RegistryModel } from "./schema.js";
import { loadRegistry, selectModel, hostVramGb } from "./registry.js";
import { defaultAdapters, type GenerationAdapter } from "./providers.js";
import type { ScriptOutput } from "../script/schema.js";

export * from "./schema.js";
export { loadRegistry, selectModel } from "./registry.js";
export { DiffusersLocalAdapter, HfInferenceAdapter, LongCatVideoAdapter } from "./providers.js";

const here = path.dirname(fileURLToPath(import.meta.url));
export const ILLUSTRATION_AGENT_ROLE = fs.readFileSync(path.join(here, "role.md"), "utf8");
export const ILLUSTRATION_AGENT_MODEL = env("SHORTS_ILLUSTRATION_MODEL", "claude-fable-5-1")!;

export interface IllustrationDeps {
  llm?: LLM;
  registry?: RegistryModel[];
  adapters?: Partial<Record<RegistryModel["adapter"], GenerationAdapter>>;
  library?: LocalLibraryVisualProvider;
}

/** Illustration Agent: decision ladder per beat → prompts → registry-selected generation (optional). */
export class IllustrationAgent {
  private readonly llm: LLM;
  private readonly registry: RegistryModel[];
  private readonly adapters: Partial<Record<RegistryModel["adapter"], GenerationAdapter>>;
  private readonly library: LocalLibraryVisualProvider;

  constructor(deps: IllustrationDeps = {}) {
    this.llm = deps.llm ?? new LLM({ model: ILLUSTRATION_AGENT_MODEL, effort: "high" });
    this.registry = deps.registry ?? loadRegistry();
    this.adapters = deps.adapters ?? defaultAdapters();
    this.library = deps.library ?? new LocalLibraryVisualProvider();
  }

  async plan(input: IllustrationAgentInput): Promise<IllustrationPlan> {
    const plan = await this.llm.structured(
      IllustrationPlan,
      `${ILLUSTRATION_AGENT_ROLE}\n\nWalk the decision ladder for every beat and return one decision per beat, in order. Beats already covered by Motion Graphics must stop at "motion" or "chart"; beats covered by a strong headline may stop at "text". Style brief: ${input.style}. Commercial use: ${input.commercial}.`,
      `Motion-covered beats: ${input.motion_beat_ids.join(", ") || "none"}\nText-covered beats: ${input.text_beat_ids.join(", ") || "none"}\n${input.notes ? `Notes: ${input.notes}\n` : ""}\nScript:\n${JSON.stringify(input.script.beats.map((b) => ({ id: b.id, start: b.start, end: b.end, purpose: b.purpose, narration: b.narration, visual_intent: b.visual_intent })), null, 2)}`
    );
    const problems = lintPlan(plan, input);
    if (!problems.length) return plan;
    log.warn(`illustration plan has ${problems.length} issue(s); asking for a revision`);
    const fixed = await this.llm.structured(IllustrationPlan, `${ILLUSTRATION_AGENT_ROLE}\n\nRevise the plan so every problem is resolved; change nothing else.`, `Problems:\n- ${problems.join("\n- ")}\n\nPlan:\n${JSON.stringify(plan, null, 2)}`, { effort: "medium" });
    const remaining = lintPlan(fixed, input);
    if (remaining.length) throw new Error(`Illustration plan still invalid:\n- ${remaining.join("\n- ")}`);
    return fixed;
  }

  async run(raw: { script: ScriptOutput } & Partial<IllustrationAgentInput>, outDir: string): Promise<IllustrationOutput> {
    const input = IllustrationAgentInput.parse({ ...raw, vram_gb: raw.vram_gb ?? hostVramGb() });
    fs.mkdirSync(outDir, { recursive: true });
    log.stage("ILLUSTRATION AGENT · decisions");
    const plan = await this.plan(input);
    fs.writeFileSync(path.join(outDir, "plan.json"), JSON.stringify(plan, null, 2));

    log.stage("ILLUSTRATION AGENT · assets");
    const available: Record<string, boolean> = {};
    for (const [name, a] of Object.entries(this.adapters)) {
      const h = await a!.health();
      available[name] = h.ok;
      log.info(`adapter ${name}: ${h.ok ? "available" : "unavailable"} — ${h.detail}`);
    }
    const assets: GeneratedAsset[] = [];
    for (const d of plan.decisions) {
      assets.push(await this.resolve(d, input, available, outDir));
    }
    const out = { plan, assets };
    fs.writeFileSync(path.join(outDir, "illustration.json"), JSON.stringify(out, null, 2));
    return out;
  }

  private async resolve(d: BeatDecision, input: IllustrationAgentInput, available: Record<string, boolean>, outDir: string): Promise<GeneratedAsset> {
    const base = { beat_id: d.beat_id, need: d.need, model: null, adapter: null } as const;
    if (d.need === "text" || d.need === "motion" || d.need === "chart" || d.need === "none") return { ...base, status: "skipped", path: null, kind: "none", detail: `handled by ${d.need === "none" ? "background" : d.need}` };
    if (d.need === "library") {
      const r = await this.library.resolve({ sceneId: 0, visual: { type: "broll", prompt: d.prompt, motion: "slow_zoom" }, durationSec: d.duration_sec, outDir, width: 1080, height: 1000 });
      return r.path ? { ...base, status: "library", path: r.path, kind: r.kind === "video" ? "video" : "image", detail: "matched from asset library" } : { ...base, status: "pending", path: null, kind: "none", detail: `no library match for "${d.prompt}" (add files to SHORTS_ASSET_DIR)` };
    }
    const kind = d.need === "ai_video" ? "video" : "image";
    const sel = selectModel(this.registry, { kind, commercial: input.commercial && d.requirements.commercial, quality_min: d.requirements.quality_min, consistency_min: d.requirements.consistency_min, vram_gb: input.vram_gb, available });
    if (!sel.chosen) {
      const why = sel.rejected.map((r) => `${r.model.id}/${r.model.adapter}: ${r.reasons.join("; ")}`).join(" | ");
      return { ...base, status: "pending", path: null, kind, detail: `no available ${kind} model in the registry (${why}). Prompt kept in plan.json for external generation.` };
    }
    const m = sel.chosen.model;
    if (!input.generate) return { ...base, status: "pending", path: null, kind, model: m.id, adapter: m.adapter, detail: "planned; run with --generate to create" };
    const { width, height } = dims(d.aspect, kind);
    const outPath = path.join(outDir, `${d.beat_id}.${kind === "video" ? "mp4" : "png"}`);
    try {
      log.info(`${d.beat_id}: generating ${kind} with ${m.id} via ${m.adapter}`);
      await this.adapters[m.adapter]!.generate(m, { prompt: [d.style, d.prompt].filter(Boolean).join(", "), negativePrompt: d.negative_prompt, width, height, outPath, durationSec: d.duration_sec, onLog: (l) => process.stdout.write(l) });
      return { ...base, status: "generated", path: outPath, kind, model: m.id, adapter: m.adapter, detail: `${width}x${height}` };
    } catch (e) {
      return { ...base, status: "failed", path: null, kind, model: m.id, adapter: m.adapter, detail: (e as Error).message.slice(0, 400) };
    }
  }
}

function dims(aspect: BeatDecision["aspect"], kind: "image" | "video"): { width: number; height: number } {
  if (kind === "video") return aspect === "9:16" ? { width: 480, height: 832 } : { width: 832, height: 480 };
  switch (aspect) {
    case "9:16": return { width: 768, height: 1344 };
    case "1:1": return { width: 1024, height: 1024 };
    case "4:5": return { width: 896, height: 1120 };
    default: return { width: 1344, height: 768 };
  }
}

export function lintPlan(plan: IllustrationPlan, input: IllustrationAgentInput): string[] {
  const p: string[] = [];
  const ids = input.script.beats.map((b) => b.id);
  for (const id of ids) if (!plan.decisions.some((d) => d.beat_id === id)) p.push(`${id}: missing decision`);
  for (const d of plan.decisions) {
    if (!ids.includes(d.beat_id)) p.push(`${d.beat_id}: unknown beat`);
    if (input.motion_beat_ids.includes(d.beat_id) && !["motion", "chart", "text"].includes(d.need)) p.push(`${d.beat_id}: Motion Graphics covers this beat; need must be motion/chart, not ${d.need}`);
    if ((d.need === "ai_image" || d.need === "ai_video" || d.need === "library") && d.prompt.trim().length < 12) p.push(`${d.beat_id}: ${d.need} needs a real prompt/keywords`);
    if ((d.need === "ai_image" || d.need === "ai_video") && /\b(chart|candlestick|graph|text|logo|caption)\b/i.test(d.prompt)) p.push(`${d.beat_id}: AI prompt must not ask for charts, text or logos`);
    if (d.need === "ai_video" && d.ladder.length < 4) p.push(`${d.beat_id}: ai_video requires walking the full ladder (list each step)`);
  }
  const aiVideo = plan.decisions.filter((d) => d.need === "ai_video").length;
  if (aiVideo > Math.max(1, Math.floor(plan.decisions.length / 3))) p.push(`${aiVideo} ai_video beats is too many; reserve AI video for beats a still cannot carry`);
  return [...new Set(p)];
}

export function illustrationSummary(o: IllustrationOutput): string {
  return o.plan.decisions.map((d) => {
    const a = o.assets.find((x) => x.beat_id === d.beat_id);
    return `${d.beat_id.padEnd(8)} ${d.need.padEnd(9)} ${a ? `[${a.status}${a.model ? ` ${a.model}` : ""}${a.path ? ` ${a.path}` : ""}]` : ""} ${d.rationale}${d.prompt && d.need !== "motion" && d.need !== "chart" && d.need !== "text" ? `\n         prompt: ${d.prompt}` : ""}`;
  }).join("\n");
}
