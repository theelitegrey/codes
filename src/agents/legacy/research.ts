import { LLM } from "../../providers/llm/llm.js";
import { ResearchResult, type ShortRequest } from "../../core/project.js";
import { CHANNEL_BRIEF } from "./prompts.js";

export async function researchAgent(llm: LLM, req: ShortRequest): Promise<ResearchResult> {
  const notes = await llm.research(
    `${CHANNEL_BRIEF}\nYou are the research agent. Use web search to gather accurate, current information for a short explainer. Prefer primary or reputable sources. Write findings as bullet points with the source URL after each fact.`,
    `Topic: ${req.topic}\nAudience: ${req.audience}\nTarget length: ${req.target_duration_sec} seconds (so only the 5–8 most important facts matter).\n${req.extra_instructions ? `Extra instructions: ${req.extra_instructions}` : ""}`
  );
  return llm.structured(
    ResearchResult,
    `${CHANNEL_BRIEF}\nConvert research notes into structured findings. Keep source URLs with each fact. Mark confidence honestly.`,
    `Topic: ${req.topic}\n\nNotes:\n${notes}`,
    { effort: "medium" }
  );
}
