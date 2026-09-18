import { LLM } from "../providers/llm/llm.js";
import { FactCheckResult, type ResearchResult, type Script } from "../core/project.js";
import { CHANNEL_BRIEF } from "./prompts.js";

export async function factCheckAgent(llm: LLM, script: Script, research: ResearchResult): Promise<FactCheckResult> {
  return llm.structured(
    FactCheckResult,
    `${CHANNEL_BRIEF}\nYou are the fact checker. Compare every factual claim in the script against the research. Flag unsupported numbers, overstated certainty, misleading simplifications and anything the research contradicts. If any issue is medium or high severity, return verdict "revise" with a full revised_script that keeps the same beat structure and length but fixes the claims (soften, correct or remove). Otherwise verdict "pass" and no revised_script.`,
    `Script:\n${JSON.stringify(script, null, 2)}\n\nResearch:\n${JSON.stringify(research, null, 2)}`
  );
}
