import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { LLM } from "../../providers/llm/llm.js";
import { log } from "../../core/log.js";
import { TextAgentInput, TextOutput, MAX_WORDS_BY_LEVEL, MAX_VISIBLE_AT_ONCE, type TextElement } from "./schema.js";
import type { ScriptOutput } from "../script/schema.js";

export * from "./schema.js";

const here = path.dirname(fileURLToPath(import.meta.url));
export const TEXT_AGENT_ROLE = fs.readFileSync(path.join(here, "role.md"), "utf8");

/** Text Agent: script beats → timed, positioned on-screen text elements. */
export class TextAgent {
  constructor(private readonly llm: LLM) {}

  async run(raw: TextAgentInput | { script: ScriptOutput } & Partial<TextAgentInput>): Promise<TextOutput> {
    const input = TextAgentInput.parse(raw);
    log.stage("TEXT AGENT · plan");
    const draft = await this.llm.structured(
      TextOutput,
      `${TEXT_AGENT_ROLE}\n\nProduce the on-screen text plan for the whole script. Element ids: txt_01, txt_02, … Times are absolute seconds and must sit inside the owning beat's window. Levels: 1 headline, 2 concept, 3 supporting, 4 label. Prefer fewer, stronger elements. List beats you intentionally left silent.`,
      `Platform: ${input.platform}\nBrand: ${input.brand}\nTone: ${input.tone}\n${input.notes ? `Notes: ${input.notes}\n` : ""}\nScript:\n${JSON.stringify({ duration: input.script.duration, hook: input.script.hook, cta: input.script.cta, beats: input.script.beats }, null, 2)}`
    );
    log.stage("TEXT AGENT · validate");
    const problems = lintText(draft, input.script);
    if (!problems.length) return draft;
    log.warn(`text plan has ${problems.length} issue(s); asking the agent to fix them`);
    const fixed = await this.llm.structured(
      TextOutput,
      `${TEXT_AGENT_ROLE}\n\nRevise the plan so every listed problem is resolved. Keep everything else unchanged.`,
      `Problems:\n- ${problems.join("\n- ")}\n\nPlan:\n${JSON.stringify(draft, null, 2)}\n\nScript beats:\n${JSON.stringify(input.script.beats, null, 2)}`,
      { effort: "medium" }
    );
    const remaining = lintText(fixed, input.script);
    if (remaining.length) throw new Error(`Text plan still invalid:\n- ${remaining.join("\n- ")}`);
    return fixed;
  }
}

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();

/** Deterministic rules from the role spec. Returns human-readable problems (empty = valid). */
export function lintText(out: TextOutput, script: ScriptOutput): string[] {
  const problems: string[] = [];
  const beats = new Map(script.beats.map((b) => [b.id, b]));
  const ids = new Set<string>();
  for (const e of out.elements) {
    if (ids.has(e.id)) problems.push(`${e.id}: duplicate id`);
    ids.add(e.id);
    const beat = beats.get(e.beat_id);
    if (!beat) {
      problems.push(`${e.id}: unknown beat ${e.beat_id}`);
      continue;
    }
    if (e.start < beat.start - 0.05 || e.end > beat.end + 0.05) problems.push(`${e.id}: ${e.start}–${e.end}s is outside ${beat.id} (${beat.start}–${beat.end}s)`);
    if (e.end <= e.start) problems.push(`${e.id}: end must be after start`);
    if (e.end - e.start < 0.8) problems.push(`${e.id}: visible for ${(e.end - e.start).toFixed(1)}s, too short to read`);
    const words = e.text.split(/\s+/).filter(Boolean).length;
    const max = MAX_WORDS_BY_LEVEL[e.level] ?? 8;
    if (words > max) problems.push(`${e.id}: ${words} words exceeds level ${e.level} limit of ${max}`);
    if (/[.!?].+[.!?]/.test(e.text) || words > 8) problems.push(`${e.id}: reads like a paragraph`);
    const n = norm(beat.narration);
    const t = norm(e.text);
    // Duplication = a long run of the spoken sentence, not a short extracted keyword.
    const nWords = n.split(" ").length;
    if (n.includes(t) && (words >= 5 || words / nWords >= 0.6)) problems.push(`${e.id}: duplicates the narration ("${e.text}")`);
    if (e.type === "cta" && beat.id !== script.beats[script.beats.length - 1].id) problems.push(`${e.id}: CTA text must be in the final beat`);
    if (e.type === "statistic" && !/\d/.test(e.text)) problems.push(`${e.id}: statistic has no number`);
  }
  // Headline count per beat and clutter check.
  for (const b of script.beats) {
    const inBeat = out.elements.filter((e) => e.beat_id === b.id);
    if (inBeat.filter((e) => e.level === 1).length > 1) problems.push(`${b.id}: more than one level-1 headline`);
  }
  const times = [...new Set(out.elements.flatMap((e) => [e.start, e.end]))].sort((a, b) => a - b);
  for (const t of times) {
    const visible = out.elements.filter((e) => e.start <= t && t < e.end);
    if (visible.length > MAX_VISIBLE_AT_ONCE) problems.push(`${visible.length} elements visible at ${t}s (max ${MAX_VISIBLE_AT_ONCE}): ${visible.map((v) => v.id).join(", ")}`);
  }
  return [...new Set(problems)];
}

export function textTimeline(out: TextOutput): string {
  return [...out.elements]
    .sort((a, b) => a.start - b.start || a.order - b.order)
    .map((e) => `${e.start.toFixed(1).padStart(5)}–${e.end.toFixed(1).padEnd(5)} L${e.level} ${e.type.padEnd(13)} ${e.position.padEnd(15)} ${e.emphasis ? "★ " : "  "}${e.text}${e.group ? `  [${e.group}#${e.order}]` : ""}`)
    .join("\n");
}

export function writeTextArtifacts(dir: string, out: TextOutput): void {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "text.json"), JSON.stringify(out, null, 2));
  fs.writeFileSync(path.join(dir, "timeline.txt"), textTimeline(out));
}

export type { TextElement };
