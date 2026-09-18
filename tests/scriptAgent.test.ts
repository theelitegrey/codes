import { describe, it, expect } from "vitest";
import { z } from "zod";
import { LLM } from "../src/providers/llm/llm.js";
import { ScriptAgent, ScriptOutput, ResearchBrief, HookCandidates, validateScript, timeline } from "../src/agents/script/index.js";

const research = { meaning: "A liquidity sweep is a fast push through an obvious swing point that triggers resting stops.", items: [{ kind: "FACT", text: "Stops cluster beyond obvious highs/lows.", source: "https://example.com", necessary: true }, { kind: "INTERPRETATION", text: "Sweeps are often engineered by larger participants.", source: null, necessary: true }, { kind: "EXAMPLE", text: "NQ runs the London high then reverses.", source: null, necessary: true }], misconceptions: ["Every wick is a sweep"], examples: ["NQ London high"], audience_already_knows: ["what a candle is"], removed: ["order book mechanics"] };
const hooks = { hooks: Array.from({ length: 5 }, (_, i) => ({ category: "curiosity", text: i === 0 ? "That wick you just ignored? It might be the most important part of the move." : `Hook ${i}`, scores: { clarity: 5, curiosity: 5, relevance: 5, emotional_interest: 4, spoken_naturalness: 5, transition: 5 }, note: "" })), selected_index: 0, why_selected: "clear + curious" };
const script = {
  duration: 45, hook: hooks.hooks[0].text, cta: "Follow for more.",
  beats: [
    { id: "beat_01", start: 0, end: 4, narration: hooks.hooks[0].text, purpose: "hook", visual_intent: "Show a wick poking above a high.", claim_kinds: [] },
    { id: "beat_02", start: 4, end: 12, narration: "Most traders see a spike and think it's noise. It's usually a stop hunt.", purpose: "problem", visual_intent: "Show stops clustering above a high.", claim_kinds: ["FACT"] },
    { id: "beat_03", start: 12, end: 28, narration: "Price pushes through the level, triggers the resting orders, then snaps back into the range. That is the sweep.", purpose: "explanation", visual_intent: "Show the liquidity sweep happening.", claim_kinds: ["FACT", "INTERPRETATION"] },
    { id: "beat_04", start: 28, end: 38, narration: "The tell is a fast reclaim. No reclaim, no sweep, just a breakout.", purpose: "distinction", visual_intent: "Contrast reclaim versus breakout.", claim_kinds: ["INTERPRETATION"] },
    { id: "beat_05", start: 38, end: 45, narration: "Wait for the reclaim before you act. Follow for more.", purpose: "cta", visual_intent: "Show the reclaim then CTA.", claim_kinds: [] },
  ],
  sources: ["https://example.com"], review: { changes_made: [], remaining_risks: [] },
};

class StubLLM extends LLM {
  constructor() { super({ model: "stub", client: {} as never }); }
  override async research(): Promise<string> { return "- notes"; }
  override async structured<S extends z.ZodType>(schema: S): Promise<z.infer<S>> {
    const s = schema as unknown;
    if (s === ResearchBrief) return research as z.infer<S>;
    if (s === HookCandidates) return hooks as z.infer<S>;
    if (s === ScriptOutput) return script as z.infer<S>;
    throw new Error("unexpected schema");
  }
}

describe("Script Agent", () => {
  it("runs research → hooks → beats → review and returns all artifacts", async () => {
    const a = await new ScriptAgent(new StubLLM()).run({ topic: "NQ liquidity sweep", duration_sec: 45, audience: "beginner traders" });
    expect(a.research.items.map((i) => i.kind)).toEqual(["FACT", "INTERPRETATION", "EXAMPLE"]);
    expect(a.hooks.hooks.length).toBeGreaterThanOrEqual(5);
    expect(a.script.beats[0].purpose).toBe("hook");
    expect(a.script.beats[0].narration).toBe(hooks.hooks[0].text);
    expect(timeline(a.script.beats)).toMatch(/^00–04s {2}hook/);
  });
  it("rejects beats that do not tile the duration or overrun their timing", () => {
    expect(() => validateScript(script as never, 45)).not.toThrow();
    const gap = { ...script, beats: script.beats.map((b) => (b.id === "beat_03" ? { ...b, start: 13 } : b)) };
    expect(() => validateScript(gap as never, 45)).toThrow(/beat_03 starts at 13/);
    const short = { ...script, beats: script.beats.slice(0, 4) };
    expect(() => validateScript(short as never, 45)).toThrow(/last beat ends at 38/);
    const wordy = { ...script, beats: script.beats.map((b) => (b.id === "beat_01" ? { ...b, narration: Array(40).fill("word").join(" ") } : b)) };
    expect(() => validateScript(wordy as never, 45)).toThrow(/beat_01 has 40 words/);
  });
});
