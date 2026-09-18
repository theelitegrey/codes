import { LLM } from "../providers/llm/llm.js";
import { Script, type HookSet, type ResearchResult, type ShortRequest } from "../core/project.js";
import { CHANNEL_BRIEF } from "./prompts.js";

/** Conversational narration averages ~2.6 words per second. */
export const WORDS_PER_SECOND = 2.6;

export async function scriptAgent(llm: LLM, req: ShortRequest, research: ResearchResult, hooks: HookSet): Promise<Script> {
  const hook = hooks.hooks[hooks.selected_index]?.text ?? hooks.hooks[0].text;
  const targetWords = Math.round(req.target_duration_sec * WORDS_PER_SECOND);
  return llm.structured(
    Script,
    `${CHANNEL_BRIEF}\nYou are the script writer. Write spoken narration for one presenter in a podcast-commentary voice: short sentences, plain words, momentum, no filler, no "in this video". Structure: hook → context → explanation → concrete example → payoff → a one-line CTA. Split into beats of 6–20 words each; each beat becomes one scene with its own visual. Total should be close to the target word count. est_seconds = words / ${WORDS_PER_SECOND}.`,
    `Topic: ${req.topic}\nAudience: ${req.audience}\nLanguage: ${req.language}\nTarget: ${req.target_duration_sec} seconds ≈ ${targetWords} words.\nSelected hook (use verbatim as the first beat): "${hook}"\n\nResearch summary: ${research.summary}\nFacts:\n${research.key_facts.map((f) => `- (${f.confidence}) ${f.fact}`).join("\n")}\nTerminology:\n${research.terminology.map((t) => `- ${t.term}: ${t.definition}`).join("\n")}\n${req.extra_instructions ? `Extra instructions: ${req.extra_instructions}` : ""}`
  );
}
