import { describe, it, expect } from "vitest";
import { z } from "zod";
import { LLM } from "../src/providers/llm/llm.js";
import { MotionAgent, BeatMotion, lintBeat } from "../src/agents/motion/index.js";
import { generateCandles } from "../remotion/motion/candles.js";
import { MotionPlan } from "../remotion/motion/schema.js";
import type { ScriptOutput } from "../src/agents/script/schema.js";

const script: ScriptOutput = {
  duration: 10, hook: "h", cta: "c", sources: [], review: { changes_made: [], remaining_risks: [] },
  beats: [
    { id: "beat_01", start: 0, end: 4, narration: "Price runs above the previous high and immediately reverses.", purpose: "hook", visual_intent: "Show the sweep happening.", claim_kinds: [] },
    { id: "beat_02", start: 4, end: 10, narration: "On the chart it leaves a wick and a gap.", purpose: "explanation", visual_intent: "Show it on candles with the gap.", claim_kinds: [] },
    { id: "beat_03", start: 10, end: 12, narration: "Follow for more.", purpose: "cta", visual_intent: "cta", claim_kinds: [] },
  ],
};

const sweep: BeatMotion = { beat_id: "beat_01", start: 0, end: 4, concept: "sweep mechanism", transition_in: "fade", layers: [{ id: "beat_01_l1", kind: "LiquiditySweep", start: 0, end: 4, rect: { x: 0, y: 0, w: 1, h: 1 }, z: 0, level_label: "PREVIOUS HIGH", sweep_label: "SWEEP", direction: "high", reversal_label: "REVERSAL", stages: { approach: 0.25, break: 0.4, wick: 0.5, label: 0.6, reverse: 0.85 } }] };
const gen = generateCandles("rally_sweep_reverse", 40, 7);
const chart: BeatMotion = { beat_id: "beat_02", start: 4, end: 10, concept: "sweep on candles", transition_in: "slide_left", layers: [{ id: "beat_02_l1", kind: "CandlestickChart", start: 4, end: 10, rect: { x: 0, y: 0, w: 1, h: 1 }, z: 0, source: { generate: { pattern: "rally_sweep_reverse", count: 40, seed: 7 } }, title: "NQ 5m (illustrative)", reveal_fraction: 0.5, show_grid: true, overlays: [{ kind: "PriceLabel", start: 4.5, end: 10, price: gen.key_level, label: "PDH", from_index: 5, style: "dashed", emphasis: true }, { kind: "SweepHighlight", start: 7, end: 10, index: gen.key_index, level: gen.key_level, label: "SWEEP", direction: "above" }] }] };

describe("candle generator", () => {
  it("is deterministic and marks the sweep candle above the key level", () => {
    const a = generateCandles("rally_sweep_reverse", 40, 3);
    const b = generateCandles("rally_sweep_reverse", 40, 3);
    expect(a).toEqual(b);
    expect(a.candles.length).toBe(40);
    expect(a.candles[a.key_index][1]).toBeGreaterThan(a.key_level);
    expect(a.candles[a.key_index][3]).toBeLessThan(a.key_level);
    for (const p of ["drop_sweep_reverse", "breakout_continuation", "fvg_gap_up", "fvg_gap_down", "range_chop", "trend_up", "trend_down"] as const) expect(generateCandles(p, 20, 1).candles.length).toBe(20);
  });
});

describe("motion lint", () => {
  it("accepts valid beats", () => {
    expect(lintBeat(sweep, script.beats[0])).toEqual([]);
    expect(lintBeat(chart, script.beats[1])).toEqual([]);
    expect(MotionPlan.safeParse({ beats: [sweep, chart] }).success).toBe(true);
  });
  it("rejects timing outside the beat, bad overlays and bad stages", () => {
    const bad = JSON.parse(JSON.stringify(chart)) as BeatMotion;
    const l = bad.layers[0] as Extract<BeatMotion["layers"][number], { kind: "CandlestickChart" }>;
    l.end = 12;
    l.overlays.push({ kind: "Marker", start: 5, end: 6, index: 99, price: 500, label: "x", shape: "dot", pulse: true } as never);
    l.overlays.push({ kind: "TradeSetup", start: 5, end: 6, from_index: 3, entry: 100, stop: 102, target: 104, side: "long" } as never);
    const p = lintBeat(bad, script.beats[1]).join("\n");
    expect(p).toMatch(/outside the beat/);
    expect(p).toMatch(/index=99 outside/);
    expect(p).toMatch(/price=500 far outside/);
    expect(p).toMatch(/stop\/entry\/target order/);
    const badSweep = JSON.parse(JSON.stringify(sweep)) as BeatMotion;
    (badSweep.layers[0] as Extract<BeatMotion["layers"][number], { kind: "LiquiditySweep" }>).stages.break = 0.1;
    expect(lintBeat(badSweep, script.beats[0]).join("\n")).toMatch(/increasing fractions/);
  });
});

describe("Motion Agent run", () => {
  it("plans beat by beat, using measured timing and one revision when needed", async () => {
    let calls = 0;
    class Stub extends LLM {
      constructor() { super({ model: "stub", client: {} as never }); }
      override async structured<S extends z.ZodType>(_s: S, _sys: string, user: string): Promise<z.infer<S>> {
        calls++;
        if (user.startsWith("Beat beat_01")) return sweep as z.infer<S>;
        if (user.startsWith("Beat beat_02")) return { ...chart, layers: [{ ...chart.layers[0], end: 99 }] } as z.infer<S>; // invalid first
        return chart as z.infer<S>; // revision
      }
    }
    const plan = await new MotionAgent(new Stub()).run({ script, beat_ids: ["beat_01", "beat_02"], timing: [{ beat_id: "beat_01", start: 0, end: 4 }, { beat_id: "beat_02", start: 4, end: 10 }] });
    expect(calls).toBe(3);
    expect(plan.beats.map((b) => b.beat_id)).toEqual(["beat_01", "beat_02"]);
    expect(plan.theme.accent).toBe("#4F8CFF");
  });
});
