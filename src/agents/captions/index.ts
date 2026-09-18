import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { LLM } from "../../providers/llm/llm.js";
import { log } from "../../core/log.js";
import { env } from "../../core/env.js";
import { CaptionsAgentInput, CaptionsOutput, CondensedPages, CAPTION_PRESETS, type CaptionCue, type CaptionWord } from "./schema.js";
import { transcribeWithFallback, type Transcriber } from "./transcription.js";
import { alignToScript, segmentVerbatim, cuesFromPages, lintCues, cuesToSrt } from "./segment.js";

export * from "./schema.js";
export * from "./segment.js";
export { transcribeWithFallback, WhisperCppTranscriber, VoiceStudioTranscriber, LineTimingTranscriber } from "./transcription.js";

const here = path.dirname(fileURLToPath(import.meta.url));
export const CAPTIONS_AGENT_ROLE = fs.readFileSync(path.join(here, "role.md"), "utf8");
export const CAPTIONS_AGENT_MODEL = env("SHORTS_CAPTIONS_MODEL", "claude-fable-5-1")!;

export interface CaptionsDeps {
  llm?: LLM;
  transcribers?: Transcriber[];
}

/** Captions Agent: final narration → word timings → pages → styled captions.json. */
export class CaptionsAgent {
  private readonly llm: LLM;
  private readonly transcribers?: Transcriber[];
  constructor(deps: CaptionsDeps = {}) {
    this.llm = deps.llm ?? new LLM({ model: CAPTIONS_AGENT_MODEL, effort: "medium" });
    this.transcribers = deps.transcribers;
  }

  async run(raw: CaptionsAgentInput, outDir: string): Promise<CaptionsOutput> {
    const input = CaptionsAgentInput.parse(raw);
    if (!fs.existsSync(input.narration_path)) throw new Error(`Final narration not found at ${input.narration_path}; run the Audio Agent first.`);
    fs.mkdirSync(outDir, { recursive: true });
    const style = { ...CAPTION_PRESETS[input.style] };
    const mode = input.mode ?? style.mode;
    style.mode = mode;

    log.stage("CAPTIONS AGENT · transcription");
    const t = await transcribeWithFallback(input.narration_path, input.language, input.audio_timeline, this.transcribers);
    log.info(`timing source: ${t.source} (${t.words.length} words)`);
    const scriptText = input.script ? input.script.beats.map((b) => b.narration).join(" ") : input.audio_timeline.lines.map((l) => l.text).join(" ");
    const words: CaptionWord[] = scriptText.trim() ? alignToScript(t.words, scriptText) : t.words;

    log.stage(`CAPTIONS AGENT · pages (${mode})`);
    let cues: CaptionCue[];
    if (mode === "verbatim") {
      cues = segmentVerbatim(words, style);
    } else {
      cues = await this.condense(words, style, input.notes);
    }
    const problems = lintCues(cues, style, words.length, mode);
    if (problems.length) throw new Error(`Caption pages invalid:\n- ${problems.join("\n- ")}`);
    const out: CaptionsOutput = { style, mode, timing_source: t.source, transcript: words.map((w) => w.text).join(" "), words, cues };
    fs.writeFileSync(path.join(outDir, "captions.json"), JSON.stringify(out, null, 2));
    fs.writeFileSync(path.join(outDir, "captions.srt"), cuesToSrt(cues));
    return out;
  }

  private async condense(words: CaptionWord[], style: CaptionsOutput["style"], notes: string): Promise<CaptionCue[]> {
    const numbered = words.map((w, i) => `${i}:${w.text}`).join(" ");
    const ask = (extra: string) =>
      this.llm.structured(
        CondensedPages,
        `${CAPTIONS_AGENT_ROLE}\n\nMode: condensed. Style "${style.name}": max ${style.max_chars_per_line} characters per line, max ${style.max_lines} lines, ${style.uppercase ? "uppercase" : "sentence case"} (write lines in normal case; the renderer uppercases). Every spoken word index from 0 to ${words.length - 1} must belong to exactly one page, pages in order, spans contiguous (to_word of a page = from_word of the next minus one). Aim for pages of 2–6 words on screen; a page's span usually covers 3–12 spoken words. ${extra}`,
        `Spoken words (index:word):\n${numbered}\n${notes ? `Notes: ${notes}` : ""}`
      );
    let pages = (await ask("")).pages;
    let cues = cuesFromPages(words, pages, style);
    let problems = lintCues(cues, style, words.length, "condensed");
    if (problems.length) {
      log.warn(`condensed pages have ${problems.length} issue(s); asking for a revision`);
      pages = (await ask(`Your previous attempt had these problems, fix them:\n- ${problems.join("\n- ")}\nPrevious pages: ${JSON.stringify(pages)}`)).pages;
      cues = cuesFromPages(words, pages, style);
      problems = lintCues(cues, style, words.length, "condensed");
      if (problems.length) throw new Error(`Condensed captions still invalid:\n- ${problems.join("\n- ")}`);
    }
    return cues;
  }
}

export function captionsSummary(o: CaptionsOutput): string {
  return [`style ${o.style.name} (${o.mode}), timing from ${o.timing_source}, ${o.words.length} words → ${o.cues.length} pages`, ...o.cues.map((c) => `  ${c.start.toFixed(2).padStart(6)}–${c.end.toFixed(2).padEnd(6)} ${c.lines.join(" / ")}${c.emphasis_word ? `  ★${c.emphasis_word}` : ""}`)].join("\n");
}
