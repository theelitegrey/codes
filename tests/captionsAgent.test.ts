import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { LLM } from "../src/providers/llm/llm.js";
import { CaptionsAgent, CAPTION_PRESETS, alignToScript, segmentVerbatim, breakLines, lintCues, cuesFromPages, LineTimingTranscriber, type CaptionWord } from "../src/agents/captions/index.js";
import type { AudioTimeline } from "../src/agents/audio/schema.js";

const timeline: AudioTimeline = {
  duration_sec: 8,
  beats: [{ beat_id: "beat_01", planned_start: 0, planned_end: 8, start: 0, end: 8, tempo_applied: 1 }],
  lines: [
    { beat_id: "beat_01", index: 0, text: "A liquidity sweep occurs when price trades beyond a significant high or low", start: 0, end: 4.6, pause_after_ms: 400 },
    { beat_id: "beat_01", index: 1, text: "before reversing.", start: 5.0, end: 6.2, pause_after_ms: 0 },
  ],
  sfx: [], music: { file: null, base_gain_db: 0, duck_db: 0 },
};

describe("line-timing transcriber", () => {
  it("spreads words inside their spoken line", async () => {
    const r = await new LineTimingTranscriber(timeline).transcribe();
    expect(r.words.length).toBe(15);
    expect(r.words[0].start).toBe(0);
    expect(r.words[12].end).toBeCloseTo(4.6, 5);
    expect(r.words[13].start).toBe(5.0);
  });
});

describe("alignment", () => {
  it("keeps script spelling with ASR timing and fills dropped words", () => {
    const asr: CaptionWord[] = [{ text: "a", start: 0, end: 0.2, emphasis: false }, { text: "liquidty", start: 0.2, end: 0.7, emphasis: false }, { text: "sweep", start: 0.7, end: 1.1, emphasis: false }, { text: "occurs", start: 1.1, end: 1.5, emphasis: false }, { text: "price", start: 1.9, end: 2.2, emphasis: false }];
    const out = alignToScript(asr, "A liquidity sweep occurs when price");
    expect(out.map((w) => w.text)).toEqual(["A", "liquidity", "sweep", "occurs", "when", "price"]);
    expect(out[2]).toMatchObject({ start: 0.7, end: 1.1 });
    expect(out[4].start).toBeGreaterThanOrEqual(1.5);
    expect(out[4].end).toBeLessThanOrEqual(1.9);
    expect(out[5]).toMatchObject({ start: 1.9, end: 2.2 });
  });
});

describe("segmentation", () => {
  it("breaks lines at the character limit and balances", () => {
    expect(breakLines(["PRICE", "TAKES", "THE", "HIGH", "AND", "REVERSES"], 18, 2)).toEqual(["PRICE TAKES THE", "HIGH AND REVERSES"]);
    expect(breakLines(["A", "B", "C"], 1, 2)).toEqual(["A", "B C"]);
  });
  it("verbatim pages respect capacity, sentence ends and pauses", async () => {
    const words = (await new LineTimingTranscriber(timeline).transcribe()).words;
    const cues = segmentVerbatim(words, CAPTION_PRESETS.Karaoke);
    expect(cues.length).toBeGreaterThanOrEqual(3);
    expect(lintCues(cues, CAPTION_PRESETS.Karaoke, words.length, "verbatim")).toEqual([]);
    expect(cues[cues.length - 1].text).toBe("BEFORE REVERSING.");
    for (const c of cues) expect(c.lines.every((l) => l.length <= 22)).toBe(true);
  });
  it("condensed pages take timing from their spoken span", async () => {
    const words = (await new LineTimingTranscriber(timeline).transcribe()).words;
    const cues = cuesFromPages(words, [{ from_word: 0, to_word: 3, lines: ["Liquidity sweep"], emphasis_word: "sweep" }, { from_word: 4, to_word: 12, lines: ["Price takes", "the high"], emphasis_word: null }, { from_word: 13, to_word: 14, lines: ["and reverses"], emphasis_word: "reverses" }], CAPTION_PRESETS.Podcast);
    expect(cues.map((c) => c.text)).toEqual(["LIQUIDITY SWEEP", "PRICE TAKES\nTHE HIGH", "AND REVERSES"]);
    expect(cues[0].start).toBe(0);
    expect(cues[2].start).toBe(5.0);
    expect(cues[0].emphasis_word).toBe("SWEEP");
    expect(lintCues(cues, CAPTION_PRESETS.Podcast, words.length, "condensed")).toEqual([]);
    const gap = lintCues(cuesFromPages(words, [{ from_word: 0, to_word: 3, lines: ["x"], emphasis_word: null }], CAPTION_PRESETS.Podcast), CAPTION_PRESETS.Podcast, words.length, "condensed");
    expect(gap.join()).toMatch(/cover 4 of 15/);
  });
});

describe("Captions Agent run", () => {
  it("produces condensed captions via the LLM with line-timing fallback and writes srt", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cap-"));
    const wav = path.join(dir, "narration.wav");
    fs.writeFileSync(wav, "x");
    class Stub extends LLM {
      constructor() { super({ model: "stub", client: {} as never }); }
      override async structured<S extends z.ZodType>(): Promise<z.infer<S>> {
        return { pages: [{ from_word: 0, to_word: 3, lines: ["Liquidity sweep"], emphasis_word: "sweep" }, { from_word: 4, to_word: 12, lines: ["Price takes", "the high"], emphasis_word: null }, { from_word: 13, to_word: 14, lines: ["and reverses"], emphasis_word: null }] } as z.infer<S>;
      }
    }
    const out = await new CaptionsAgent({ llm: new Stub(), transcribers: [new LineTimingTranscriber(timeline)] }).run({ narration_path: wav, audio_timeline: timeline, style: "Podcast", language: "en", notes: "" }, dir);
    expect(out.timing_source).toBe("line_timing");
    expect(out.mode).toBe("condensed");
    expect(out.cues.length).toBe(3);
    expect(fs.readFileSync(path.join(dir, "captions.srt"), "utf8")).toMatch(/LIQUIDITY SWEEP/);
  });
  it("verbatim mode needs no LLM", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cap-"));
    const wav = path.join(dir, "narration.wav");
    fs.writeFileSync(wav, "x");
    const out = await new CaptionsAgent({ llm: new LLM({ model: "unused", client: {} as never }), transcribers: [new LineTimingTranscriber(timeline)] }).run({ narration_path: wav, audio_timeline: timeline, style: "Karaoke", language: "en", notes: "" }, dir);
    expect(out.mode).toBe("verbatim");
    expect(out.cues.flatMap((c) => c.words).length).toBe(15);
  });
});
