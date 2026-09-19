import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { LLM } from "../../providers/llm/llm.js";
import { log } from "../../core/log.js";
import { VoiceConfigStore, type VoiceConfig } from "../../config/voices.js";
import { createVoiceProvider } from "../../providers/voice/index.js";
import type { VoiceProvider } from "../../providers/voice/VoiceProvider.js";
import { ensureDir, postProcessAudio } from "../../media/ffmpeg.js";
import { AudioLibrary, synthesizeSfx } from "./library.js";
import { assembleLines, mixMaster, analyzeMaster } from "./mix.js";
import { AudioAgentInput, PerformancePlan, VoiceCandidate, PLATFORM_LOUDNESS, type AudioAgentArtifacts, type AudioTimeline, type SfxCue } from "./schema.js";
import type { ScriptOutput } from "../script/schema.js";

export * from "./schema.js";
export { AudioLibrary, synthesizeSfx } from "./library.js";
export { assembleLines, mixMaster, analyzeMaster } from "./mix.js";

const here = path.dirname(fileURLToPath(import.meta.url));
export const AUDIO_AGENT_ROLE = fs.readFileSync(path.join(here, "role.md"), "utf8");

export interface AudioAgentDeps {
  llm: LLM;
  voices?: VoiceConfigStore;
  library?: AudioLibrary;
  /** Override provider resolution (tests, or forcing local TTS). */
  voiceProvider?: (cfg: VoiceConfig) => VoiceProvider;
}

/**
 * Audio Agent: voice selection → performance plan → VoiceStudio narration
 * (line by line, with performed pauses) → music bed + ducking → sparse SFX
 * → loudness-normalised master + analysis report.
 */
export class AudioAgent {
  private readonly llm: LLM;
  private readonly voices: VoiceConfigStore;
  private readonly library: AudioLibrary;
  private readonly providerFor: (cfg: VoiceConfig) => VoiceProvider;

  constructor(deps: AudioAgentDeps) {
    this.llm = deps.llm;
    this.voices = deps.voices ?? new VoiceConfigStore();
    this.library = deps.library ?? new AudioLibrary();
    this.providerFor = deps.voiceProvider ?? ((cfg) => createVoiceProvider(cfg));
  }

  /** Voices the agent may pick from: configured voices, with live availability from their provider. */
  async candidates(): Promise<VoiceCandidate[]> {
    const out: VoiceCandidate[] = [];
    const healthCache = new Map<string, boolean>();
    for (const v of this.voices.list()) {
      if (!healthCache.has(v.provider)) {
        const h = await this.providerFor(v).health().catch(() => ({ ok: false }));
        healthCache.set(v.provider, h.ok);
      }
      out.push(VoiceCandidate.parse({ id: v.id, label: v.label, provider: v.provider, gender: v.traits.gender, age: v.traits.age, accent: v.traits.accent, energy: v.traits.energy, authority: v.traits.authority, best_for: v.traits.best_for, style: v.style, available: healthCache.get(v.provider) ?? false }));
    }
    return out;
  }

  async plan(input: AudioAgentInput, candidates: VoiceCandidate[]): Promise<PerformancePlan> {
    const usable = candidates.filter((c) => c.available);
    if (!usable.length) throw new Error("No voice provider is reachable (start VoiceStudio, or configure a local voice)");
    const forced = input.voice_id ? usable.find((c) => c.id === input.voice_id) : undefined;
    if (input.voice_id && !forced) throw new Error(`Voice "${input.voice_id}" is not available`);
    const lib = this.library.manifest();
    const plan = await this.llm.structured(
      PerformancePlan,
      `${AUDIO_AGENT_ROLE}\n\nProduce the full performance plan for this script. ${forced ? `The voice is fixed: use voice_config_id "${forced.id}".` : "Choose voice_config_id from the candidates."} Split every beat's narration into spoken lines with intentional pauses (pause_after_ms), keeping the words identical to the script. SFX cue times are absolute seconds. Music tags should match the library where possible.`,
      `Platform: ${input.platform}\nAudience: ${input.audience}\nBrand: ${input.brand}\nTone: ${input.tone}\nCategory: ${input.category}\nMusic enabled: ${input.music_enabled}\nSFX enabled: ${input.sfx_enabled}\n${input.notes ? `Notes: ${input.notes}\n` : ""}\nVoice candidates:\n${JSON.stringify(usable, null, 2)}\n\nMusic library (genre/mood/tags):\n${lib.music.length ? JSON.stringify(lib.music.map((m) => ({ genre: m.genre, mood: m.mood, tags: m.tags })), null, 2) : "(empty — pick a genre/mood anyway; the bed will be silent unless a file is provided)"}\n\nScript:\n${JSON.stringify({ duration: input.script.duration, beats: input.script.beats.map((b) => ({ id: b.id, start: b.start, end: b.end, purpose: b.purpose, narration: b.narration })) }, null, 2)}`
    );
    const problems = lintPlan(plan, input.script, input);
    if (!problems.length) return plan;
    log.warn(`performance plan has ${problems.length} issue(s); asking the agent to fix`);
    const fixed = await this.llm.structured(PerformancePlan, `${AUDIO_AGENT_ROLE}\n\nRevise the plan so every problem is resolved; change nothing else.`, `Problems:\n- ${problems.join("\n- ")}\n\nPlan:\n${JSON.stringify(plan, null, 2)}\n\nScript beats:\n${JSON.stringify(input.script.beats, null, 2)}`, { effort: "medium" });
    const remaining = lintPlan(fixed, input.script, input);
    if (remaining.length) throw new Error(`Performance plan still invalid:\n- ${remaining.join("\n- ")}`);
    return fixed;
  }

  async run(raw: { script: ScriptOutput } & Partial<AudioAgentInput>, outDir: string): Promise<AudioAgentArtifacts> {
    const input = AudioAgentInput.parse(raw);
    ensureDir(outDir);
    log.stage("AUDIO AGENT · voice candidates");
    const candidates = await this.candidates();
    log.stage("AUDIO AGENT · performance plan");
    const plan = await this.plan(input, candidates);
    fs.writeFileSync(path.join(outDir, "performance.json"), JSON.stringify(plan, null, 2));

    log.stage(`AUDIO AGENT · narration (${plan.voice.voice_config_id})`);
    const { narration, timeline } = await this.synthesize(input, plan, outDir);

    log.stage("AUDIO AGENT · sfx");
    const sfxDir = path.join(outDir, "sfx");
    ensureDir(sfxDir);
    const cues: AudioTimeline["sfx"] = [];
    if (input.sfx_enabled) {
      for (const c of plan.sfx) {
        const mapped = remapTime(c.at, input.script, timeline);
        const libFile = this.library.findSfx(c.type);
        const file = libFile ?? (await synthesizeSfx(c.type, path.join(sfxDir, `${c.type}.wav`)));
        cues.push({ ...c, at: mapped, file, procedural: !libFile });
      }
    }
    timeline.sfx = cues;

    log.stage("AUDIO AGENT · music + mix");
    const musicFile = input.music_file ?? (input.music_enabled && plan.music.enabled ? this.library.findMusic(plan.music.genre, plan.music.mood, plan.music.tags) : undefined);
    if (input.music_enabled && plan.music.enabled && !musicFile) log.warn("no music bed matched the library; mixing without music (see config/audio/README.md)");
    timeline.music = { file: musicFile ?? null, base_gain_db: plan.music.base_gain_db, duck_db: plan.music.duck_db };
    const target = PLATFORM_LOUDNESS[input.platform];
    const intensity = plan.music.intensity
      .map((i) => {
        const b = timeline.beats.find((x) => x.beat_id === i.beat_id);
        return b ? { start: b.start, end: b.end, level: i.level } : undefined;
      })
      .filter((x): x is { start: number; end: number; level: number } => Boolean(x));
    const { master, musicStem } = await mixMaster({
      narration,
      music: musicFile ? { file: musicFile, baseGainDb: plan.music.base_gain_db, duckDb: plan.music.duck_db, speech: timeline.lines.map((l) => ({ start: l.start, end: l.end })), intensity } : undefined,
      sfx: cues.map((c) => ({ file: c.file, at: c.at, gainDb: c.gain_db })),
      durationSec: timeline.duration_sec + 0.3,
      targetLufs: target.lufs,
      targetTp: target.tp,
      outDir,
    });

    log.stage("AUDIO AGENT · analysis");
    const report = await analyzeMaster(master, { narration, musicStem, targetLufs: target.lufs, targetTp: target.tp });
    fs.writeFileSync(path.join(outDir, "timeline.json"), JSON.stringify(timeline, null, 2));
    fs.writeFileSync(path.join(outDir, "report.json"), JSON.stringify(report, null, 2));
    fs.writeFileSync(path.join(outDir, "input.json"), JSON.stringify(input, null, 2));
    return { input, candidates, plan, timeline, narration_path: narration, master_path: master, report };
  }

  /** Line-by-line synthesis with pauses, per-beat fit to the script timing. */
  private async synthesize(input: AudioAgentInput, plan: PerformancePlan, outDir: string): Promise<{ narration: string; timeline: AudioTimeline }> {
    const cfg = this.voices.get(plan.voice.voice_config_id);
    const voice: VoiceConfig = { ...cfg, speaking_speed: clamp(cfg.speaking_speed * plan.voice.speed, 0.5, 2), emotion: plan.voice.delivery || cfg.emotion };
    const provider = this.providerFor(voice);
    const linesDir = path.join(outDir, "lines");
    ensureDir(linesDir);
    const rendered: Array<{ beat_id: string; index: number; text: string; path: string; pauseAfterSec: number; tempo: number; words?: Array<{ word: string; start: number; end: number }> }> = [];
    for (const pb of plan.beats) {
      const beat = input.script.beats.find((b) => b.id === pb.beat_id)!;
      const beatLines: typeof rendered = [];
      for (let i = 0; i < pb.lines.length; i++) {
        const l = pb.lines[i];
        const file = path.join(linesDir, `${pb.beat_id}_${String(i + 1).padStart(2, "0")}.${voice.output_format}`);
        const lineVoice: VoiceConfig = { ...voice, speaking_speed: clamp(voice.speaking_speed * pb.speed, 0.5, 2), emotion: [voice.emotion, l.delivery].filter(Boolean).join("; ") };
        const r = await provider.synthesize({ text: l.text, voice: lineVoice, outPath: file });
        beatLines.push({ beat_id: pb.beat_id, index: i, text: l.text, path: r.path, pauseAfterSec: l.pause_after_ms / 1000, tempo: 1, words: r.words });
        log.info(`${pb.beat_id} line ${i + 1}: ${r.duration_sec.toFixed(2)}s "${l.text.slice(0, 50)}"`);
      }
      // Fit: if the beat overruns its window by > 5 %, first trim pauses, then apply a mild tempo (≤ 1.12).
      const window = beat.end - beat.start;
      const spoken = await totalDuration(beatLines.map((b) => b.path));
      let pauses = beatLines.reduce((a, b) => a + b.pauseAfterSec, 0);
      let over = spoken + pauses - window;
      if (over > window * 0.05) {
        const trim = Math.min(pauses * 0.6, over);
        if (trim > 0) {
          const f = (pauses - trim) / pauses;
          for (const b of beatLines) b.pauseAfterSec *= f;
          pauses -= trim;
          over -= trim;
        }
        if (over > window * 0.05) {
          const tempo = clamp((spoken + pauses) / window, 1, 1.12);
          for (const b of beatLines) b.tempo = tempo;
          log.warn(`${pb.beat_id} overruns by ${over.toFixed(1)}s; tempo ${tempo.toFixed(3)} applied`);
        }
      }
      rendered.push(...beatLines);
    }
    // The last line's pause is dropped so the narration ends cleanly.
    if (rendered.length) rendered[rendered.length - 1].pauseAfterSec = 0;
    const raw = path.join(outDir, "narration_raw.wav");
    const { starts, ends, total } = await assembleLines(rendered, raw);
    const narration = path.join(outDir, "narration.wav");
    await postProcessAudio(raw, narration, { pitchSemitones: voice.pitch_semitones, gainDb: voice.gain_db, loudnorm: true });

    const beats: AudioTimeline["beats"] = input.script.beats.map((b) => {
      const idx = rendered.map((r, i) => (r.beat_id === b.id ? i : -1)).filter((i) => i >= 0);
      const start = idx.length ? starts[idx[0]] : 0;
      const last = idx[idx.length - 1];
      const end = idx.length ? ends[last] + rendered[last].pauseAfterSec : start;
      return { beat_id: b.id, planned_start: b.start, planned_end: b.end, start, end, tempo_applied: idx.length ? rendered[idx[0]].tempo : 1 };
    });
    const lines: AudioTimeline["lines"] = rendered.map((r, i) => ({ beat_id: r.beat_id, index: r.index, text: r.text, start: starts[i], end: ends[i], pause_after_ms: Math.round(r.pauseAfterSec * 1000), words: r.words?.map((w) => ({ text: w.word, start: starts[i] + w.start / r.tempo, end: starts[i] + w.end / r.tempo })) }));
    return { narration, timeline: { duration_sec: total, beats, lines, sfx: [], music: { file: null, base_gain_db: 0, duck_db: 0 } } };
  }
}

/** Map a planned (script) time onto the measured narration timeline. */
export function remapTime(t: number, script: ScriptOutput, tl: AudioTimeline): number {
  const b = script.beats.find((x) => t >= x.start && t < x.end) ?? script.beats[script.beats.length - 1];
  const m = tl.beats.find((x) => x.beat_id === b.id);
  if (!m) return t;
  const f = (t - b.start) / Math.max(0.01, b.end - b.start);
  return m.start + f * (m.end - m.start);
}

export function lintPlan(plan: PerformancePlan, script: ScriptOutput, input: AudioAgentInput): string[] {
  const p: string[] = [];
  const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  for (const b of script.beats) {
    const pb = plan.beats.find((x) => x.beat_id === b.id);
    if (!pb) {
      p.push(`${b.id}: missing from plan`);
      continue;
    }
    const joined = norm(pb.lines.map((l) => l.text).join(" "));
    if (joined !== norm(b.narration)) p.push(`${b.id}: line text must equal the narration word for word`);
    const pauses = pb.lines.reduce((a, l) => a + l.pause_after_ms, 0) / 1000;
    if (pauses > (b.end - b.start) * 0.4) p.push(`${b.id}: ${pauses.toFixed(1)}s of pauses is too much for a ${(b.end - b.start).toFixed(1)}s beat`);
  }
  for (const x of plan.beats) if (!script.beats.some((b) => b.id === x.beat_id)) p.push(`${x.beat_id}: unknown beat`);
  const cues = [...plan.sfx].sort((a, b) => a.at - b.at);
  if (input.sfx_enabled) {
    if (cues.length > Math.ceil(script.duration / 6)) p.push(`${cues.length} SFX cues exceeds ~1 per 6 s`);
    for (let i = 0; i < cues.length; i++) {
      if (cues[i].at < 0.5) p.push(`sfx ${cues[i].type} at ${cues[i].at}s is inside the first 0.5 s`);
      if (cues[i].at > script.duration) p.push(`sfx ${cues[i].type} at ${cues[i].at}s is after the end`);
      if (i > 0 && cues[i].at - cues[i - 1].at < 1.5) p.push(`sfx ${cues[i - 1].type}@${cues[i - 1].at}s and ${cues[i].type}@${cues[i].at}s are closer than 1.5 s`);
    }
  } else if (cues.length) p.push("SFX are disabled but cues were planned");
  if (plan.music.base_gain_db - plan.music.duck_db > -12) p.push(`music would sit only ${Math.abs(plan.music.base_gain_db - plan.music.duck_db)} LU under speech (base_gain_db - duck_db must be ≤ -12): not subtle`);
  return [...new Set(p)];
}

async function totalDuration(files: string[]): Promise<number> {
  const { probe } = await import("../../media/ffmpeg.js");
  let t = 0;
  for (const f of files) t += (await probe(f)).duration_sec;
  return t;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

export function audioSummary(a: AudioAgentArtifacts): string {
  const r = a.report;
  return [
    `voice: ${a.plan.voice.voice_config_id} (speed ${a.plan.voice.speed}) — ${a.plan.voice.rationale}`,
    `narration: ${a.timeline.duration_sec.toFixed(1)}s  ${a.narration_path}`,
    ...a.timeline.beats.map((b) => `  ${b.beat_id} planned ${b.planned_start}–${b.planned_end}s → ${b.start.toFixed(1)}–${b.end.toFixed(1)}s${b.tempo_applied !== 1 ? ` (tempo ${b.tempo_applied.toFixed(2)})` : ""}`),
    `music: ${a.timeline.music.file ?? "none"}  sfx: ${a.timeline.sfx.map((s) => `${s.type}@${s.at.toFixed(1)}s`).join(", ") || "none"}`,
    `master: ${a.master_path}`,
    `loudness: ${r.integrated_lufs.toFixed(1)} LUFS (target ${r.target_lufs}), TP ${r.true_peak_dbtp.toFixed(1)} dBTP, LRA ${r.loudness_range_lu.toFixed(1)}, speech/music ${r.speech_music_ratio_db?.toFixed(1) ?? "n/a"} dB, clipped ${r.clipped_samples}, silences ${r.silences.length}`,
    `QA: ${r.passed ? "PASS" : "FAIL — " + r.notes.join("; ")}`,
  ].join("\n");
}
