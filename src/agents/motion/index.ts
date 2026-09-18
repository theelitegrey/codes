import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { LLM } from "../../providers/llm/llm.js";
import { log } from "../../core/log.js";
import { env } from "../../core/env.js";
import { MotionAgentInput, MotionPlan, BeatMotion } from "./schema.js";
import { MOTION_CATALOG } from "./catalog.js";
import { generateCandles } from "../../../remotion/motion/candles.js";
import type { ChartOverlay } from "../../../remotion/motion/schema.js";

export * from "./schema.js";
export { MOTION_CATALOG } from "./catalog.js";

const here = path.dirname(fileURLToPath(import.meta.url));
export const MOTION_AGENT_ROLE = fs.readFileSync(path.join(here, "role.md"), "utf8");

/** This agent runs on Claude Fable 5.1 unless SHORTS_MOTION_MODEL overrides it. */
export const MOTION_AGENT_MODEL = env("SHORTS_MOTION_MODEL", "claude-fable-5-1")!;

const BeatPlanOnly = BeatMotion;

/** Motion Graphics Agent: script beats → declarative motion plan built from the component catalog. */
export class MotionAgent {
  readonly llm: LLM;
  constructor(llm?: LLM) {
    this.llm = llm ?? new LLM({ model: MOTION_AGENT_MODEL, effort: "high" });
  }

  async run(raw: MotionAgentInput | ({ script: MotionAgentInput["script"] } & Partial<MotionAgentInput>)): Promise<MotionPlan> {
    const input = MotionAgentInput.parse(raw);
    const beats = input.script.beats.filter((b) => !input.beat_ids.length || input.beat_ids.includes(b.id));
    const timed = beats.map((b) => {
      const t = input.timing.find((x) => x.beat_id === b.id);
      return { ...b, start: t?.start ?? b.start, end: t?.end ?? b.end };
    });
    const planned: BeatMotion[] = [];
    for (const b of timed) {
      log.stage(`MOTION AGENT · ${b.id}`);
      let beat = await this.llm.structured(
        BeatPlanOnly,
        `${MOTION_AGENT_ROLE}\n\n${MOTION_CATALOG}\nStage: ${input.width}x${input.height} @ ${input.fps}fps. Style: ${input.style}.\nProduce the motion plan for ONE beat. Layer ids: ${b.id}_l1, ${b.id}_l2 … Times must be within ${b.start}–${b.end}s.`,
        `Beat ${b.id} (${b.start}–${b.end}s, purpose ${b.purpose})\nNarration: "${b.narration}"\nVisual intent: ${b.visual_intent}\n${input.notes ? `Notes: ${input.notes}\n` : ""}Previous beats' concepts: ${planned.map((p) => `${p.beat_id}: ${p.concept}`).join("; ") || "none"}`
      );
      let problems = lintBeat(beat, b);
      if (problems.length) {
        log.warn(`${b.id}: ${problems.length} issue(s); asking for a revision`);
        beat = await this.llm.structured(BeatPlanOnly, `${MOTION_AGENT_ROLE}\n\n${MOTION_CATALOG}\nRevise the beat plan so every problem is resolved; change nothing else.`, `Problems:\n- ${problems.join("\n- ")}\n\nPlan:\n${JSON.stringify(beat, null, 2)}\n\nBeat window: ${b.start}–${b.end}s`, { effort: "medium" });
        problems = lintBeat(beat, b);
        if (problems.length) throw new Error(`${b.id} motion plan still invalid:\n- ${problems.join("\n- ")}`);
      }
      planned.push(beat);
    }
    return MotionPlan.parse({ width: input.width, height: input.height, fps: input.fps, theme: {}, beats: planned });
  }
}

/** Deterministic checks: timing inside the beat, overlays inside the chart data, layer limits. */
export function lintBeat(beat: BeatMotion, window: { id: string; start: number; end: number }): string[] {
  const p: string[] = [];
  if (beat.beat_id !== window.id) p.push(`beat_id must be ${window.id}`);
  if (Math.abs(beat.start - window.start) > 0.05 || Math.abs(beat.end - window.end) > 0.05) p.push(`beat window must be ${window.start}–${window.end}s`);
  if (!beat.layers.length) p.push("beat has no layers");
  const ids = new Set<string>();
  for (const l of beat.layers) {
    if (ids.has(l.id)) p.push(`${l.id}: duplicate layer id`);
    ids.add(l.id);
    if (l.start < window.start - 0.05 || l.end > window.end + 0.05 || l.end <= l.start) p.push(`${l.id}: ${l.start}–${l.end}s is outside the beat ${window.start}–${window.end}s`);
    if (l.rect.x + l.rect.w > 1.001 || l.rect.y + l.rect.h > 1.001) p.push(`${l.id}: rect exceeds the stage`);
    if (l.kind === "CandlestickChart") {
      const data = "candles" in l.source ? { candles: l.source.candles, key_index: -1, key_level: NaN } : generateCandles(l.source.generate.pattern, l.source.generate.count, l.source.generate.seed, l.source.generate.key_index);
      const n = data.candles.length;
      const lo = Math.min(...data.candles.map((c) => c[2]));
      const hi = Math.max(...data.candles.map((c) => c[1]));
      const span = hi - lo;
      for (const o of l.overlays) p.push(...lintOverlay(o, l.id, n, lo - span * 0.5, hi + span * 0.5, l.start, l.end));
    }
    if (l.kind === "LiquiditySweep") {
      const s = l.stages;
      const seq = [s.approach, s.break, s.wick, s.label, s.reverse];
      if (!seq.every((v, i) => v > 0 && v < 1 && (i === 0 || v > seq[i - 1]))) p.push(`${l.id}: stages must be increasing fractions between 0 and 1`);
    }
    if (l.kind === "Timeline") for (const st of l.steps) if (st.at < l.start || st.at > l.end) p.push(`${l.id}: step "${st.label}" at ${st.at}s is outside the layer`);
  }
  return [...new Set(p)];
}

function lintOverlay(o: ChartOverlay, layerId: string, n: number, lo: number, hi: number, start: number, end: number): string[] {
  const p: string[] = [];
  const idx = (v: number | undefined, name: string) => {
    if (v !== undefined && (v < 0 || v >= n)) p.push(`${layerId}/${o.kind}: ${name}=${v} outside 0–${n - 1}`);
  };
  const price = (v: number | undefined, name: string) => {
    if (v !== undefined && (v < lo || v > hi)) p.push(`${layerId}/${o.kind}: ${name}=${v} far outside the plotted price range (${lo.toFixed(1)}–${hi.toFixed(1)})`);
  };
  if (o.start < start - 0.05 || o.end > end + 0.05 || o.end <= o.start) p.push(`${layerId}/${o.kind}: ${o.start}–${o.end}s is outside the chart layer ${start}–${end}s`);
  switch (o.kind) {
    case "FVGBox":
      idx(o.from_index, "from_index"); idx(o.to_index, "to_index"); price(o.top, "top"); price(o.bottom, "bottom");
      if (o.top <= o.bottom) p.push(`${layerId}/FVGBox: top must be above bottom`);
      break;
    case "PriceLabel":
      idx(o.from_index, "from_index"); idx(o.to_index, "to_index"); price(o.price, "price");
      break;
    case "Marker":
    case "SweepHighlight":
      idx(o.index, "index"); price("price" in o ? o.price : o.level, "price");
      break;
    case "TradeSetup":
      idx(o.from_index, "from_index"); price(o.entry, "entry"); price(o.stop, "stop"); price(o.target, "target");
      if (o.side === "long" ? !(o.stop < o.entry && o.entry < o.target) : !(o.stop > o.entry && o.entry > o.target)) p.push(`${layerId}/TradeSetup: stop/entry/target order is wrong for a ${o.side}`);
      break;
    case "SessionRange":
      idx(o.from_index, "from_index"); idx(o.to_index, "to_index");
      break;
  }
  return p;
}

export function motionSummary(plan: MotionPlan): string {
  return plan.beats.map((b) => `${b.beat_id} ${b.start}–${b.end}s [${b.transition_in}] ${b.concept}\n${b.layers.map((l) => `   ${l.id.padEnd(12)} ${l.kind.padEnd(17)} ${l.start.toFixed(1)}–${l.end.toFixed(1)}s${l.kind === "CandlestickChart" ? ` overlays: ${l.overlays.map((o) => o.kind).join(", ") || "none"}` : ""}`).join("\n")}`).join("\n");
}

export function writeMotionArtifacts(dir: string, plan: MotionPlan): void {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "motion.json"), JSON.stringify(plan, null, 2));
  fs.writeFileSync(path.join(dir, "summary.txt"), motionSummary(plan));
}
