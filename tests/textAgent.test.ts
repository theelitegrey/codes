import { describe, it, expect } from "vitest";
import { z } from "zod";
import { LLM } from "../src/providers/llm/llm.js";
import { TextAgent, TextOutput, lintText, textTimeline } from "../src/agents/text/index.js";
import type { ScriptOutput } from "../src/agents/script/schema.js";

const script: ScriptOutput = {
  duration: 20, hook: "That wick you ignored matters.", cta: "Follow for more.", sources: [], review: { changes_made: [], remaining_risks: [] },
  beats: [
    { id: "beat_01", start: 0, end: 4, narration: "That wick you ignored matters.", purpose: "hook", visual_intent: "wick above a high", claim_kinds: [] },
    { id: "beat_02", start: 4, end: 14, narration: "Price takes the previous high before aggressively reversing.", purpose: "explanation", visual_intent: "show the sweep", claim_kinds: ["FACT"] },
    { id: "beat_03", start: 14, end: 20, narration: "Wait for the reclaim. Follow for more.", purpose: "cta", visual_intent: "reclaim then cta", claim_kinds: [] },
  ],
};

const good: TextOutput = {
  elements: [
    { id: "txt_01", beat_id: "beat_01", text: "THAT WICK", type: "headline", level: 1, start: 0.6, end: 3.8, position: "top-center", animation: "slide-up", emphasis: true, group: null, order: 0, rationale: "" },
    { id: "txt_02", beat_id: "beat_02", text: "PREVIOUS HIGH", type: "label", level: 2, start: 4.5, end: 13.5, position: "top-center", animation: "fade", emphasis: false, group: "chain", order: 0, rationale: "" },
    { id: "txt_03", beat_id: "beat_02", text: "LIQUIDITY", type: "keyword", level: 2, start: 6.5, end: 13.5, position: "center", animation: "fade", emphasis: false, group: "chain", order: 1, rationale: "" },
    { id: "txt_04", beat_id: "beat_02", text: "SWEEP", type: "headline", level: 1, start: 8.5, end: 13.5, position: "bottom-center", animation: "pop", emphasis: true, group: "chain", order: 2, rationale: "" },
    { id: "txt_05", beat_id: "beat_03", text: "FOLLOW", type: "cta", level: 2, start: 16, end: 20, position: "above-presenter", animation: "pop", emphasis: true, group: null, order: 0, rationale: "" },
  ],
  silent_beats: [],
};

describe("Text Agent lint", () => {
  it("accepts a plan that follows the rules", () => {
    expect(lintText(good, script)).toEqual([]);
    expect(textTimeline(good)).toContain("[chain#2]");
  });
  it("rejects narration duplication, paragraphs, off-beat timing, clutter and misplaced CTA", () => {
    const bad: TextOutput = {
      elements: [
        { ...good.elements[0], text: "Price takes the previous high before aggressively reversing.", beat_id: "beat_02", start: 5, end: 9, level: 3 },
        { ...good.elements[1], id: "b2", text: "This is one sentence. And this is another one here.", level: 3 },
        { ...good.elements[2], id: "b3", start: 2, end: 6 },
        { ...good.elements[3], id: "b4", start: 5, end: 9 },
        { ...good.elements[4], id: "b5", start: 5, end: 9, beat_id: "beat_02" },
      ],
      silent_beats: [],
    };
    const problems = lintText(bad, script);
    expect(problems.join("\n")).toMatch(/duplicates the narration/);
    expect(problems.join("\n")).toMatch(/paragraph/);
    expect(problems.join("\n")).toMatch(/b3: 2–6s is outside beat_02/);
    expect(problems.join("\n")).toMatch(/elements visible at 5s \(max 3\)/);
    expect(problems.join("\n")).toMatch(/CTA text must be in the final beat/);
  });
});

describe("Text Agent run", () => {
  it("re-asks the model once when the first plan breaks a rule", async () => {
    let calls = 0;
    class Stub extends LLM {
      constructor() { super({ model: "stub", client: {} as never }); }
      override async structured<S extends z.ZodType>(): Promise<z.infer<S>> {
        calls++;
        if (calls === 1) return { ...good, elements: [{ ...good.elements[0], text: "That wick you ignored matters" }] } as z.infer<S>;
        return good as z.infer<S>;
      }
    }
    const out = await new TextAgent(new Stub()).run({ script });
    expect(calls).toBe(2);
    expect(out.elements.length).toBe(5);
  });
});
