import path from "node:path";
import { loadDotEnv } from "../src/core/env.js";
import { MotionPlan } from "../remotion/motion/schema.js";
import { generateCandles } from "../remotion/motion/candles.js";
import { renderMotionPreview } from "../src/agents/motion/run.js";
import { writeMotionArtifacts } from "../src/agents/motion/index.js";

loadDotEnv();
const gen = generateCandles("rally_sweep_reverse", 42, 11);
const plan = MotionPlan.parse({
  width: 1080, height: 1080, fps: 30,
  beats: [
    { beat_id: "beat_01", start: 0, end: 5, concept: "Price sweeps the previous high and reverses", transition_in: "fade", layers: [
      { id: "b1_l1", kind: "LiquiditySweep", start: 0, end: 5, level_label: "PREVIOUS HIGH", sweep_label: "SWEEP", direction: "high", reversal_label: "REVERSAL" },
    ] },
    { beat_id: "beat_02", start: 5, end: 12, concept: "The same sweep on candles: PDH, wick, FVG left behind, then a short setup", transition_in: "slide_left", layers: [
      { id: "b2_l1", kind: "CandlestickChart", start: 5, end: 12, source: { generate: { pattern: "rally_sweep_reverse", count: 42, seed: 11 } }, title: "NQ 5m (illustrative)", reveal_fraction: 0.45, overlays: [
        { kind: "PriceLabel", start: 5.4, end: 12, price: gen.key_level, label: "PDH", from_index: 6, emphasis: true },
        { kind: "SweepHighlight", start: 8.2, end: 12, index: gen.key_index, level: gen.key_level, label: "SWEEP", direction: "above" },
        { kind: "FVGBox", start: 9.2, end: 12, from_index: gen.key_index + 2, top: gen.candles[gen.key_index + 1][2], bottom: gen.candles[gen.key_index + 3][1], label: "FVG" },
        { kind: "TradeSetup", start: 10.2, end: 12, from_index: gen.key_index + 5, entry: gen.candles[gen.key_index + 4][3], stop: gen.candles[gen.key_index][1] + 0.3, target: gen.candles[gen.key_index + 4][3] - 4, side: "short" },
      ] },
    ] },
    { beat_id: "beat_03", start: 12, end: 15, concept: "Kinetic headline + counter", transition_in: "zoom", layers: [
      { id: "b3_l1", kind: "Headline", start: 12, end: 15, rect: { x: 0, y: 0.1, w: 1, h: 0.45 }, text: "WAIT FOR THE RECLAIM", style: "split_words", size: "xl", accent_words: ["RECLAIM"] },
      { id: "b3_l2", kind: "NumberCounter", start: 12.6, end: 15, rect: { x: 0, y: 0.5, w: 1, h: 0.35 }, from: 0, to: 73, suffix: "%", label: "of sweeps reclaim (illustrative)", count_fraction: 0.6 },
      { id: "b3_l3", kind: "Arrow", start: 13.2, end: 15, from: [0.2, 0.9], to: [0.5, 0.62], label: "", curved: true },
    ] },
  ],
});
const dir = path.resolve("output/motion-demo");
writeMotionArtifacts(dir, plan);
const files = await renderMotionPreview(plan, dir);
console.log(files.join("\n"));
