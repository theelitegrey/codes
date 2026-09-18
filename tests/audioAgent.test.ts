import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { LLM } from "../src/providers/llm/llm.js";
import { AudioAgent, PerformancePlan, lintPlan, synthesizeSfx, remapTime, type AudioTimeline } from "../src/agents/audio/index.js";
import { speechGaps, duckExpression } from "../src/agents/audio/mix.js";
import { LocalTTSProvider } from "../src/providers/voice/LocalTTSProvider.js";
import { AudioLibrary } from "../src/agents/audio/library.js";
import { commandExists, run, ffmpegBin, probe } from "../src/media/ffmpeg.js";
import type { ScriptOutput } from "../src/agents/script/schema.js";

const script: ScriptOutput = {
  duration: 14, hook: "Most traders think this is a breakout.", cta: "Wait for the reclaim.", sources: [], review: { changes_made: [], remaining_risks: [] },
  beats: [
    { id: "beat_01", start: 0, end: 5, narration: "Most traders think this is a breakout. But it isn't.", purpose: "hook", visual_intent: "wick", claim_kinds: [] },
    { id: "beat_02", start: 5, end: 10, narration: "Price sweeps the high, then snaps back inside the range.", purpose: "explanation", visual_intent: "sweep", claim_kinds: ["FACT"] },
    { id: "beat_03", start: 10, end: 14, narration: "Wait for the reclaim.", purpose: "cta", visual_intent: "cta", claim_kinds: [] },
  ],
};

const plan: PerformancePlan = {
  voice: { voice_config_id: "local_dev", speed: 1, delivery: "calm", rationale: "only available voice" },
  beats: [
    { beat_id: "beat_01", lines: [{ text: "Most traders think this is a breakout.", pause_after_ms: 600, emphasis: ["breakout"], delivery: "" }, { text: "But it isn't.", pause_after_ms: 300, emphasis: [], delivery: "punchy" }], speed: 1, energy: 4 },
    { beat_id: "beat_02", lines: [{ text: "Price sweeps the high, then snaps back inside the range.", pause_after_ms: 300, emphasis: [], delivery: "" }], speed: 1, energy: 3 },
    { beat_id: "beat_03", lines: [{ text: "Wait for the reclaim.", pause_after_ms: 0, emphasis: [], delivery: "" }], speed: 0.95, energy: 3 },
  ],
  music: { enabled: true, genre: "minimal electronic", mood: "focused", tags: ["trading"], base_gain_db: -10, duck_db: 6, intensity: [{ beat_id: "beat_01", level: 0.8 }, { beat_id: "beat_02", level: 0.4 }, { beat_id: "beat_03", level: 0.9 }] },
  sfx: [{ type: "whoosh", at: 4.6, beat_id: "beat_01", gain_db: -10, reason: "reveal" }, { type: "click", at: 9.5, beat_id: "beat_02", gain_db: -12, reason: "transition" }],
  transitions: [],
};

class Stub extends LLM {
  constructor() { super({ model: "stub", client: {} as never }); }
  override async structured<S extends z.ZodType>(): Promise<z.infer<S>> { return plan as z.infer<S>; }
}

describe("Audio Agent plan lint", () => {
  it("accepts a valid plan", () => {
    expect(lintPlan(plan, script, { script, platform: "youtube_shorts", audience: "", brand: "", tone: "", category: "trading", music_enabled: true, sfx_enabled: true, notes: "" })).toEqual([]);
  });
  it("rejects altered words, excessive pauses, clustered sfx and loud music", () => {
    const bad: PerformancePlan = { ...plan, beats: [{ ...plan.beats[0], lines: [{ text: "Most traders think this is a breakout, but it is not.", pause_after_ms: 2500, emphasis: [], delivery: "" }] }, plan.beats[1], plan.beats[2]], sfx: [{ ...plan.sfx[0], at: 0.2 }, { ...plan.sfx[1], at: 1.0 }, { ...plan.sfx[1], at: 3 }, { ...plan.sfx[1], at: 8 }], music: { ...plan.music, base_gain_db: -6, duck_db: 2 } };
    const p = lintPlan(bad, script, { script, platform: "youtube_shorts", audience: "", brand: "", tone: "", category: "trading", music_enabled: true, sfx_enabled: true, notes: "" }).join("\n");
    expect(p).toMatch(/word for word/);
    expect(p).toMatch(/pauses is too much/);
    expect(p).toMatch(/inside the first 0.5 s/);
    expect(p).toMatch(/closer than 1.5 s/);
    expect(p).toMatch(/not subtle/);
    expect(p).toMatch(/exceeds ~1 per 6 s/);
  });
  it("remaps planned times onto the measured timeline", () => {
    const tl: AudioTimeline = { duration_sec: 12, beats: [{ beat_id: "beat_01", planned_start: 0, planned_end: 5, start: 0, end: 4, tempo_applied: 1 }, { beat_id: "beat_02", planned_start: 5, planned_end: 10, start: 4, end: 9, tempo_applied: 1 }, { beat_id: "beat_03", planned_start: 10, planned_end: 14, start: 9, end: 12, tempo_applied: 1 }], lines: [], sfx: [], music: { file: null, base_gain_db: 0, duck_db: 0 } };
    expect(remapTime(2.5, script, tl)).toBeCloseTo(2, 5);
    expect(remapTime(7.5, script, tl)).toBeCloseTo(6.5, 5);
  });
});

describe("ducking", () => {
  it("finds speech gaps and builds a bounded volume expression", () => {
    const gaps = speechGaps([{ start: 0.2, end: 3 }, { start: 3.3, end: 6 }, { start: 7, end: 9 }], 11);
    expect(gaps).toEqual([{ start: 6, end: 7 }, { start: 9, end: 11 }]);
    const e = duckExpression(gaps, 6);
    expect(e.startsWith("0.5012+(1-0.5012)*min(")).toBe(true);
    expect(duckExpression([], 6)).toBe("0.5012");
  });
});

describe("Audio Agent end to end (espeak + procedural sfx + synthetic music)", async () => {
  const hasTts = await commandExists("espeak-ng");
  it.skipIf(!hasTts)("produces narration, ducked music, sfx, a normalised master and a passing report", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "audio-agent-"));
    const music = path.join(dir, "bed.wav");
    await run(ffmpegBin(), ["-y", "-f", "lavfi", "-i", "sine=f=110:d=20", "-f", "lavfi", "-i", "sine=f=165:d=20", "-filter_complex", "[0:a][1:a]amix=inputs=2,volume=0.5[o]", "-map", "[o]", "-ar", "48000", music]);
    const agent = new AudioAgent({ llm: new Stub(), library: new AudioLibrary(path.join(dir, "nolib")), voiceProvider: () => new LocalTTSProvider() });
    const a = await agent.run({ script, music_file: music, category: "trading" }, path.join(dir, "audio"));
    expect(a.timeline.beats.length).toBe(3);
    expect(a.timeline.lines.length).toBe(4);
    expect(a.timeline.lines[0].pause_after_ms).toBeGreaterThan(0);
    expect(a.timeline.beats[1].start).toBeGreaterThan(a.timeline.beats[0].start);
    expect(a.timeline.sfx.map((s) => s.type)).toEqual(["whoosh", "click"]);
    expect(a.timeline.sfx.every((s) => s.procedural && fs.existsSync(s.file))).toBe(true);
    const master = await probe(a.master_path);
    expect(master.duration_sec).toBeGreaterThan(a.timeline.duration_sec);
    expect(Math.abs(a.report.integrated_lufs - -14)).toBeLessThanOrEqual(1.0);
    expect(a.report.true_peak_dbtp).toBeLessThanOrEqual(-0.8);
    expect(a.report.clipped_samples).toBe(0);
    expect(a.report.speech_music_ratio_db).not.toBeNull();
    expect(a.report.speech_music_ratio_db!).toBeGreaterThan(8);
    expect(a.report.speech_music_ratio_db!).toBeLessThan(30);
    expect(a.report.passed).toBe(true);
    expect(fs.existsSync(path.join(dir, "audio", "narration.wav"))).toBe(true);
    expect(fs.existsSync(path.join(dir, "audio", "report.json"))).toBe(true);
  }, 120_000);
  it("synthesises every sfx type", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sfx-"));
    for (const t of ["whoosh", "hit", "click", "rise", "impact", "notification", "chart_movement", "transition"] as const) {
      const f = await synthesizeSfx(t, path.join(dir, `${t}.wav`));
      expect((await probe(f)).duration_sec).toBeGreaterThan(0.02);
    }
  }, 60_000);
});
