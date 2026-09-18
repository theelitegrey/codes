import { LLM } from "../../providers/llm/llm.js";
import { Metadata, type Script, type ShortRequest } from "../../core/project.js";
import { CHANNEL_BRIEF } from "./prompts.js";

export async function metadataAgent(llm: LLM, req: ShortRequest, script: Script): Promise<Metadata> {
  return llm.structured(
    Metadata,
    `${CHANNEL_BRIEF}\nWrite publishing metadata for YouTube Shorts: a title under 70 characters that front-loads the payoff, a 2–4 sentence description, a one-line social caption, and 5–12 hashtags (include #Shorts). No clickbait that the video does not deliver.`,
    `Topic: ${req.topic}\nAudience: ${req.audience}\nScript:\n${script.beats.map((b) => b.narration).join(" ")}`,
    { effort: "low" }
  );
}
