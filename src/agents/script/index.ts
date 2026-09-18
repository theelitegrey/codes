import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { LLM } from "../../providers/llm/llm.js";
import { log } from "../../core/log.js";
import { ScriptAgentInput, ResearchBrief, HookCandidates, ScriptOutput, type ScriptAgentArtifacts, type Beat } from "./schema.js";

export * from "./schema.js";

const here = path.dirname(fileURLToPath(import.meta.url));
export const SCRIPT_AGENT_ROLE = fs.readFileSync(path.join(here, "role.md"), "utf8");

export const WORDS_PER_SECOND = 2.5;

/**
 * Script Agent: research → hooks → beats → self-review. Returns every
 * intermediate artifact so each stage can be inspected.
 */
export class ScriptAgent {
  constructor(private readonly llm: LLM) {}

  async run(raw: Partial<ScriptAgentInput> & { topic: string }): Promise<ScriptAgentArtifacts> {
    const input = ScriptAgentInput.parse(raw);
    log.stage("SCRIPT AGENT · research");
    const research = await this.research(input);
    log.stage("SCRIPT AGENT · hooks");
    const hooks = await this.hooks(input, research);
    log.stage("SCRIPT AGENT · beats");
    const draft = await this.beats(input, research, hooks);
    log.stage("SCRIPT AGENT · review");
    const script = await this.review(input, research, draft);
    validateScript(script, input.duration_sec);
    return { input, research, hooks, script };
  }

  async research(input: ScriptAgentInput): Promise<ResearchBrief> {
    let notes = input.research ?? "";
    if (input.web_research) {
      try {
        const found = await this.llm.research(
          `${SCRIPT_AGENT_ROLE}\n\nYou are in step 1 (research). Gather what a ${input.duration_sec}-second ${input.platform} video for "${input.audience}" needs: meaning, key facts, misconceptions, concrete examples. Cite a URL after each factual point.`,
          `Topic: ${input.topic}\nCategory: ${input.category}\n${notes ? `User-supplied research:\n${notes}\n` : ""}${input.notes ? `Notes: ${input.notes}` : ""}`
        );
        notes = notes ? `${notes}\n\n---\nWeb research:\n${found}` : found;
      } catch (e) {
        log.warn(`web research failed, continuing with supplied research only: ${(e as Error).message}`);
      }
    }
    return this.llm.structured(
      ResearchBrief,
      `${SCRIPT_AGENT_ROLE}\n\nYou are in step 1 (research). Turn the notes into a research brief. Label each item FACT / INTERPRETATION / EXAMPLE / OPINION and mark whether it is necessary for a ${input.duration_sec}-second video aimed at "${input.audience}". List what the audience already knows and what you removed.`,
      `Topic: ${input.topic}\n\nNotes:\n${notes || "(none — use your own knowledge and label confidence honestly)"}`
    );
  }

  async hooks(input: ScriptAgentInput, research: ResearchBrief): Promise<HookCandidates> {
    return this.llm.structured(
      HookCandidates,
      `${SCRIPT_AGENT_ROLE}\n\nYou are in step 2 (hooks). Write 6–10 hooks spanning different categories, each at most 16 spoken words, in the brand voice. Score each 1–5 on the six criteria and select one. The selected hook must lead naturally into the first explanation beat.`,
      `Topic: ${input.topic}\nAudience: ${input.audience}\nBrand: ${input.brand}\nTone: ${input.tone}\nMeaning: ${research.meaning}\nMisconceptions: ${research.misconceptions.join(" | ")}\nNecessary items:\n${research.items.filter((i) => i.necessary).map((i) => `- [${i.kind}] ${i.text}`).join("\n")}`
    );
  }

  async beats(input: ScriptAgentInput, research: ResearchBrief, hooks: HookCandidates): Promise<ScriptOutput> {
    const hook = hooks.hooks[hooks.selected_index] ?? hooks.hooks[0];
    const targetWords = Math.round(input.duration_sec * WORDS_PER_SECOND);
    const previous = input.previous_scripts.length ? `\nPrevious successful scripts (style reference only, do not copy lines):\n${input.previous_scripts.map((s, i) => `--- ${i + 1} ---\n${s}`).join("\n")}` : "";
    return this.llm.structured(
      ScriptOutput,
      `${SCRIPT_AGENT_ROLE}\n\nYou are in step 3 (beats). Produce the script as timed beats that tile 0 → ${input.duration_sec}s exactly (first beat starts at 0, each beat starts where the previous ended, last beat ends at ${input.duration_sec}). Size narration to ≈${WORDS_PER_SECOND} words/second. Beat ids are beat_01, beat_02, … Use the selected hook verbatim as beat_01's narration. visual_intent describes WHAT to show, never how. Tag claim_kinds from the research labels.`,
      `Topic: ${input.topic}\nPlatform: ${input.platform}\nDuration: ${input.duration_sec}s ≈ ${targetWords} words total\nAudience: ${input.audience}\nCategory: ${input.category}\nBrand: ${input.brand}\nTone: ${input.tone}\n${input.notes ? `Notes: ${input.notes}\n` : ""}Selected hook: "${hook.text}" (${hook.category})\n\nResearch brief:\n${JSON.stringify(research, null, 2)}${previous}`
    );
  }

  async review(input: ScriptAgentInput, research: ResearchBrief, draft: ScriptOutput): Promise<ScriptOutput> {
    return this.llm.structured(
      ScriptOutput,
      `${SCRIPT_AGENT_ROLE}\n\nYou are in step 4 (review). Check the draft against the research labels: FACTs stated plainly, INTERPRETATION/OPINION worded as such, nothing unsupported, nothing unnecessary, beats tile 0 → ${input.duration_sec}s, word counts fit the timing, every beat earns the next. Return the corrected script with review.changes_made and review.remaining_risks filled in. Keep the hook unless it is factually wrong.`,
      `Draft:\n${JSON.stringify(draft, null, 2)}\n\nResearch brief:\n${JSON.stringify(research, null, 2)}`,
      { effort: "medium" }
    );
  }
}

/** Deterministic checks every script.json must pass before other agents consume it. */
export function validateScript(script: ScriptOutput, durationSec: number): void {
  const problems: string[] = [];
  const beats = [...script.beats].sort((a, b) => a.start - b.start);
  if (beats[0].start !== 0) problems.push(`first beat starts at ${beats[0].start}, expected 0`);
  for (let i = 1; i < beats.length; i++) {
    if (Math.abs(beats[i].start - beats[i - 1].end) > 0.05) problems.push(`${beats[i].id} starts at ${beats[i].start} but ${beats[i - 1].id} ends at ${beats[i - 1].end}`);
  }
  const last = beats[beats.length - 1];
  if (Math.abs(last.end - durationSec) > 1.5) problems.push(`last beat ends at ${last.end}, target duration ${durationSec}`);
  for (const b of beats) {
    if (b.end <= b.start) problems.push(`${b.id} has non-positive length`);
    const words = b.narration.split(/\s+/).filter(Boolean).length;
    const max = Math.ceil((b.end - b.start) * WORDS_PER_SECOND * 1.35);
    if (words > max) problems.push(`${b.id} has ${words} words for ${(b.end - b.start).toFixed(1)}s (max ≈${max})`);
  }
  if (beats[0].purpose !== "hook") problems.push("first beat must be the hook");
  if (problems.length) throw new Error(`Script validation failed:\n- ${problems.join("\n- ")}`);
}

/** Pretty timeline like "0–03s Hook". */
export function timeline(beats: Beat[]): string {
  return beats.map((b) => `${String(Math.round(b.start)).padStart(2, "0")}–${String(Math.round(b.end)).padStart(2, "0")}s  ${b.purpose.padEnd(12)} ${b.narration}`).join("\n");
}

export function writeScriptArtifacts(dir: string, a: ScriptAgentArtifacts): void {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "input.json"), JSON.stringify(a.input, null, 2));
  fs.writeFileSync(path.join(dir, "research.json"), JSON.stringify(a.research, null, 2));
  fs.writeFileSync(path.join(dir, "hooks.json"), JSON.stringify(a.hooks, null, 2));
  fs.writeFileSync(path.join(dir, "script.json"), JSON.stringify(a.script, null, 2));
  fs.writeFileSync(path.join(dir, "timeline.txt"), timeline(a.script.beats));
}
