import { LLM } from "../providers/llm/llm.js";
import { HookSet, type ResearchResult, type ShortRequest } from "../core/project.js";
import { CHANNEL_BRIEF } from "./prompts.js";

export async function hookAgent(llm: LLM, req: ShortRequest, research: ResearchResult): Promise<HookSet> {
  return llm.structured(
    HookSet,
    `${CHANNEL_BRIEF}\nYou write opening hooks for Shorts. The first 2 seconds decide retention. Produce 5 distinct hooks (curiosity gap, bold claim, question, pattern interrupt, stakes) of at most 14 words each, spoken aloud by the presenter, then choose the strongest for this audience.`,
    `Topic: ${req.topic}\nAudience: ${req.audience}\nKey facts:\n${research.key_facts.map((f) => `- ${f.fact}`).join("\n")}\nAngles: ${research.angles.join("; ")}`
  );
}
