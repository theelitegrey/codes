import { z } from "zod";

/** What the Script Agent receives. */
export const ScriptAgentInput = z.object({
  topic: z.string().min(3),
  platform: z.enum(["youtube_shorts", "tiktok", "instagram_reels", "youtube", "x"]).default("youtube_shorts"),
  duration_sec: z.number().min(10).max(600).default(45),
  audience: z.string().default("general audience"),
  category: z.string().default("education"),
  brand: z.string().default("a knowledgeable, direct podcast host who respects the viewer's time"),
  tone: z.string().default("clear, confident, conversational"),
  /** Optional research the user already has (text or markdown). */
  research: z.string().optional(),
  /** Previous successful scripts (plain text or JSON), used as style references only. */
  previous_scripts: z.array(z.string()).default([]),
  /** Extra constraints from the user. */
  notes: z.string().default(""),
  /** Allow the agent to search the web. */
  web_research: z.boolean().default(true),
});
export type ScriptAgentInput = z.infer<typeof ScriptAgentInput>;

export const KnowledgeKind = z.enum(["FACT", "INTERPRETATION", "EXAMPLE", "OPINION"]);

export const ResearchBrief = z.object({
  meaning: z.string().describe("What the topic actually means, in the audience's language"),
  items: z.array(z.object({ kind: KnowledgeKind, text: z.string(), source: z.string().nullable(), necessary: z.boolean() })).min(3),
  misconceptions: z.array(z.string()),
  examples: z.array(z.string()),
  audience_already_knows: z.array(z.string()),
  removed: z.array(z.string()).describe("Information deliberately left out and why"),
});
export type ResearchBrief = z.infer<typeof ResearchBrief>;

export const HookCategory = z.enum(["curiosity", "contrarian", "problem", "question", "unexpected_result", "mistake", "doing_it_wrong", "open_loop", "demonstration", "story"]);

export const HookScores = z.object({
  clarity: z.number().min(1).max(5),
  curiosity: z.number().min(1).max(5),
  relevance: z.number().min(1).max(5),
  emotional_interest: z.number().min(1).max(5),
  spoken_naturalness: z.number().min(1).max(5),
  transition: z.number().min(1).max(5),
});

export const HookCandidates = z.object({
  hooks: z.array(z.object({ category: HookCategory, text: z.string(), scores: HookScores, note: z.string() })).min(5),
  selected_index: z.number().int().min(0),
  why_selected: z.string(),
});
export type HookCandidates = z.infer<typeof HookCandidates>;

export const BeatPurpose = z.enum(["hook", "problem", "context", "explanation", "example", "distinction", "misconception", "payoff", "cta"]);

export const Beat = z.object({
  id: z.string().regex(/^beat_\d{2}$/),
  start: z.number().min(0),
  end: z.number().positive(),
  narration: z.string().min(1),
  purpose: BeatPurpose,
  /** What to show, not how. */
  visual_intent: z.string().min(1),
  /** Knowledge kinds this beat leans on (for downstream transparency). */
  claim_kinds: z.array(KnowledgeKind).default([]),
});
export type Beat = z.infer<typeof Beat>;

/** The script.json contract consumed by every other agent. */
export const ScriptOutput = z.object({
  duration: z.number().positive(),
  hook: z.string(),
  beats: z.array(Beat).min(3),
  cta: z.string(),
  sources: z.array(z.string()).default([]),
  /** Self-review notes from the agent's final pass. */
  review: z.object({ changes_made: z.array(z.string()), remaining_risks: z.array(z.string()) }).default({ changes_made: [], remaining_risks: [] }),
});
export type ScriptOutput = z.infer<typeof ScriptOutput>;

/** Everything the run writes to disk for review. */
export interface ScriptAgentArtifacts {
  input: ScriptAgentInput;
  research: ResearchBrief;
  hooks: HookCandidates;
  script: ScriptOutput;
}
