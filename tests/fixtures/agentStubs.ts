import type { z } from "zod";
import { LLM } from "../../src/providers/llm/llm.js";
import { ResearchBrief, HookCandidates, ScriptOutput } from "../../src/agents/script/schema.js";
import { TextOutput } from "../../src/agents/text/schema.js";
import { PerformancePlan } from "../../src/agents/audio/schema.js";
import { BeatMotion } from "../../remotion/motion/schema.js";
import { IllustrationPlan } from "../../src/agents/illustration/schema.js";
import { PresenterPlan } from "../../src/agents/presenter/schema.js";
import { CondensedPages } from "../../src/agents/captions/schema.js";
import { ComposerOverrides } from "../../src/agents/composer/schema.js";
import { generateCandles } from "../../remotion/motion/candles.js";

/** One stub LLM for the whole DAG: answers by schema identity with a consistent NQ sweep project. */
export const FIXTURE_SCRIPT = {
  duration: 20, hook: "That wick you just ignored? It might be the whole move.", cta: "Wait for the reclaim.", sources: ["https://example.com"], review: { changes_made: [], remaining_risks: [] },
  beats: [
    { id: "beat_01", start: 0, end: 4, narration: "That wick you just ignored? It might be the whole move.", purpose: "hook", visual_intent: "A wick poking above a previous high.", claim_kinds: [] },
    { id: "beat_02", start: 4, end: 10, narration: "Price runs above the previous high, grabs the resting stops, then reverses hard.", purpose: "explanation", visual_intent: "Show the liquidity sweep happening.", claim_kinds: ["FACT"] },
    { id: "beat_03", start: 10, end: 15, narration: "On the chart it leaves a long wick and a fast reclaim of the level.", purpose: "example", visual_intent: "Show the sweep on candles with the reclaim.", claim_kinds: ["EXAMPLE"] },
    { id: "beat_04", start: 15, end: 20, narration: "No reclaim, no sweep. Wait for the reclaim.", purpose: "cta", visual_intent: "Contrast and CTA.", claim_kinds: [] },
  ],
};

export class StubLLM extends LLM {
  calls: string[] = [];
  constructor() { super({ model: "stub", client: {} as never }); }
  override async research(): Promise<string> { return "- Stops cluster beyond obvious highs. [https://example.com]"; }
  override async structured<S extends z.ZodType>(schema: S, system: string): Promise<z.infer<S>> {
    const s = schema as unknown;
    const r = (v: unknown) => v as z.infer<S>;
    if (s === ResearchBrief) return r({ meaning: "A liquidity sweep is a run through an obvious level that triggers stops.", items: [{ kind: "FACT", text: "Stops cluster beyond obvious highs/lows.", source: "https://example.com", necessary: true }, { kind: "INTERPRETATION", text: "Larger players engineer sweeps.", source: null, necessary: true }, { kind: "EXAMPLE", text: "NQ takes the London high and reverses.", source: null, necessary: true }], misconceptions: ["every wick is a sweep"], examples: ["London high"], audience_already_knows: ["candles"], removed: ["order book detail"] });
    if (s === HookCandidates) return r({ hooks: Array.from({ length: 5 }, (_, i) => ({ category: "curiosity", text: i === 0 ? FIXTURE_SCRIPT.hook : `Hook ${i}`, scores: { clarity: 5, curiosity: 5, relevance: 5, emotional_interest: 4, spoken_naturalness: 5, transition: 5 }, note: "" })), selected_index: 0, why_selected: "clear" });
    if (s === ScriptOutput) return r(FIXTURE_SCRIPT);
    if (s === TextOutput) return r({ elements: [
      { id: "txt_01", beat_id: "beat_01", text: "THAT WICK", type: "headline", level: 1, start: 0.6, end: 3.8, position: "top-center", animation: "slide-up", emphasis: true, group: null, order: 0, rationale: "" },
      { id: "txt_02", beat_id: "beat_02", text: "PREVIOUS HIGH", type: "label", level: 2, start: 4.4, end: 9.6, position: "top-left", animation: "fade", emphasis: false, group: "chain", order: 0, rationale: "" },
      { id: "txt_03", beat_id: "beat_02", text: "SWEEP", type: "chip", level: 2, start: 6.5, end: 9.6, position: "top-right", animation: "pop", emphasis: true, group: "chain", order: 1, rationale: "" },
      { id: "txt_04", beat_id: "beat_04", text: "FOLLOW", type: "cta", level: 2, start: 17, end: 20, position: "bottom-center", animation: "pop", emphasis: true, group: null, order: 0, rationale: "" },
    ], silent_beats: [{ beat_id: "beat_03", reason: "chart carries it" }] });
    if (s === PerformancePlan) return r({ voice: { voice_config_id: "local_dev", speed: 1, delivery: "calm, direct", rationale: "only available voice" }, beats: [
      { beat_id: "beat_01", lines: [{ text: "That wick you just ignored?", pause_after_ms: 500, emphasis: ["wick"], delivery: "" }, { text: "It might be the whole move.", pause_after_ms: 300, emphasis: [], delivery: "" }], speed: 1, energy: 4 },
      { beat_id: "beat_02", lines: [{ text: "Price runs above the previous high, grabs the resting stops,", pause_after_ms: 350, emphasis: [], delivery: "" }, { text: "then reverses hard.", pause_after_ms: 300, emphasis: ["reverses"], delivery: "punchy" }], speed: 1, energy: 3 },
      { beat_id: "beat_03", lines: [{ text: "On the chart it leaves a long wick and a fast reclaim of the level.", pause_after_ms: 300, emphasis: [], delivery: "" }], speed: 1, energy: 3 },
      { beat_id: "beat_04", lines: [{ text: "No reclaim, no sweep.", pause_after_ms: 500, emphasis: [], delivery: "" }, { text: "Wait for the reclaim.", pause_after_ms: 0, emphasis: ["reclaim"], delivery: "warm" }], speed: 0.97, energy: 3 },
    ], music: { enabled: false, genre: "", mood: "", tags: [], base_gain_db: -10, duck_db: 6, intensity: [] }, sfx: [{ type: "whoosh", at: 3.6, beat_id: "beat_01", gain_db: -10, reason: "reveal" }, { type: "click", at: 14.5, beat_id: "beat_03", gain_db: -12, reason: "transition" }], transitions: [] });
    if (s === BeatMotion) {
      const beatId = /Beat (beat_\d\d)/.exec(system + "")?.[1];
      // system doesn't include the user text; caller passes user separately – we get it via the third arg in real LLM, so derive from call order.
      return r(this.nextMotion(beatId));
    }
    if (s === IllustrationPlan) return r({ decisions: [
      { beat_id: "beat_01", need: "text", ladder: ["text? yes"], rationale: "headline", prompt: "", negative_prompt: "", style: "", aspect: "16:9", requirements: { quality_min: 3, consistency_min: 2, commercial: true }, duration_sec: 4 },
      { beat_id: "beat_02", need: "motion", ladder: ["text? no", "animate? yes"], rationale: "sweep schematic", prompt: "", negative_prompt: "", style: "", aspect: "16:9", requirements: { quality_min: 3, consistency_min: 2, commercial: true }, duration_sec: 4 },
      { beat_id: "beat_03", need: "chart", ladder: ["text? no", "animate? chart"], rationale: "candles", prompt: "", negative_prompt: "", style: "", aspect: "16:9", requirements: { quality_min: 3, consistency_min: 2, commercial: true }, duration_sec: 4 },
      { beat_id: "beat_04", need: "none", ladder: ["text? cta"], rationale: "presenter + cta", prompt: "", negative_prompt: "", style: "", aspect: "16:9", requirements: { quality_min: 3, consistency_min: 2, commercial: true }, duration_sec: 4 },
    ] });
    if (s === PresenterPlan) return r({ profile_id: "default_host", shot: { camera_angle: "eye level", shot_size: "medium", body_position: "seated, leaning in", gesture_style: "natural hand gestures", eye_contact: "direct", clothing: "dark charcoal t-shirt, open black overshirt", background: "flat uniform bright green backdrop", lighting: "soft key front-left", personality: "engaged, direct", background_mode: "keyable", prompt: "A confident male podcast host in his early thirties, short textured dark brown hair, light stubble, dark charcoal t-shirt under an open black overshirt, medium shot chest-up, looking at the camera and speaking with natural hand gestures, soft key light from the front-left, in front of a flat uniform bright green backdrop with no objects and even lighting." }, beats: [
      { beat_id: "beat_01", presenter_enabled: true, position: "bottom", scale: 0.45, camera: "medium", expression: "curious", gesture: "natural_hand_gesture", eye_contact: "direct", background: "transparent_or_keyable", reason: "hook" },
      { beat_id: "beat_02", presenter_enabled: true, position: "bottom", scale: 0.42, camera: "medium", expression: "confident", gesture: "natural_hand_gesture", eye_contact: "direct", background: "transparent_or_keyable", reason: "explain" },
      { beat_id: "beat_03", presenter_enabled: false, position: "bottom", scale: 0.42, camera: "medium", expression: "neutral", gesture: "still", eye_contact: "direct", background: "transparent_or_keyable", reason: "full-frame chart" },
      { beat_id: "beat_04", presenter_enabled: true, position: "bottom", scale: 0.5, camera: "medium_close", expression: "warm", gesture: "subtle_hand_gesture", eye_contact: "direct", background: "transparent_or_keyable", reason: "cta" },
    ] });
    if (s === CondensedPages) return r(this.condensedPages);
    if (s === ComposerOverrides) return r({ scenes: [{ beat_id: "beat_03", transition_in: "zoom", drop_text_ids: [], effect: "none", reason: "chart reveal" }] });
    // Intake fallback
    return r({ topic: "NQ liquidity sweeps", target_duration_sec: null, audience: null, language: null, extra_instructions: null });
  }

  /** Set by the e2e script after the word list is known (indices must match the narration). */
  condensedPages: z.infer<typeof CondensedPages> = { pages: [] };

  private motionIdx = 0;
  private nextMotion(_beatId?: string): z.infer<typeof BeatMotion> {
    const gen = generateCandles("rally_sweep_reverse", 40, 11);
    const plans: z.infer<typeof BeatMotion>[] = [
      { beat_id: "beat_01", start: 0, end: 4, concept: "the ignored wick", transition_in: "fade", layers: [{ id: "beat_01_l1", kind: "CandlestickChart", start: 0, end: 4, rect: { x: 0, y: 0.18, w: 1, h: 0.82 }, z: 0, source: { generate: { pattern: "rally_sweep_reverse", count: 24, seed: 3 } }, title: "", reveal_fraction: 0.5, show_grid: false, overlays: [{ kind: "Marker", start: 2.2, end: 4, index: 14, price: generateCandles("rally_sweep_reverse", 24, 3).candles[14][1], label: "this wick", shape: "ring", pulse: true }] }] },
      { beat_id: "beat_02", start: 4, end: 10, concept: "sweep mechanism", transition_in: "slide_left", layers: [{ id: "beat_02_l1", kind: "LiquiditySweep", start: 4, end: 10, rect: { x: 0, y: 0.12, w: 1, h: 0.88 }, z: 0, level_label: "PREVIOUS HIGH", sweep_label: "SWEEP", direction: "high", reversal_label: "REVERSAL", stages: { approach: 0.25, break: 0.4, wick: 0.5, label: 0.6, reverse: 0.85 } }] },
      { beat_id: "beat_03", start: 10, end: 15, concept: "sweep on candles + reclaim", transition_in: "zoom", layers: [{ id: "beat_03_l1", kind: "CandlestickChart", start: 10, end: 15, rect: { x: 0, y: 0, w: 1, h: 1 }, z: 0, source: { generate: { pattern: "rally_sweep_reverse", count: 40, seed: 11 } }, title: "NQ 5m (illustrative)", reveal_fraction: 0.45, show_grid: true, overlays: [{ kind: "PriceLabel", start: 10.4, end: 15, price: gen.key_level, label: "PDH", from_index: 6, style: "dashed", emphasis: true }, { kind: "SweepHighlight", start: 12.4, end: 15, index: gen.key_index, level: gen.key_level, label: "SWEEP", direction: "above" }, { kind: "Marker", start: 13.6, end: 15, index: gen.key_index + 3, price: gen.candles[gen.key_index + 3][3], label: "reclaim", shape: "arrow_down", pulse: true }] }] },
      { beat_id: "beat_04", start: 15, end: 20, concept: "reclaim rule", transition_in: "fade", layers: [{ id: "beat_04_l1", kind: "Headline", start: 15, end: 20, rect: { x: 0, y: 0.25, w: 1, h: 0.5 }, z: 0, text: "NO RECLAIM, NO SWEEP", sub: "", style: "split_words", size: "l", align: "center", accent_words: ["RECLAIM"] }] },
    ];
    return plans[this.motionIdx++ % plans.length];
  }
}
