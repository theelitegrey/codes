import fs from "node:fs";
import path from "node:path";
import { ffmpegBin, run, probe, ensureDir } from "../../media/ffmpeg.js";
import type { LoudnessReport } from "./schema.js";

/** Concatenate spoken lines with their trailing pauses into one 48 kHz mono WAV. Returns line start offsets. */
export async function assembleLines(lines: Array<{ path: string; pauseAfterSec: number; tempo?: number }>, outFile: string): Promise<{ starts: number[]; ends: number[]; total: number }> {
  const starts: number[] = [];
  const ends: number[] = [];
  let cursor = 0;
  const args: string[] = ["-y"];
  const parts: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    args.push("-i", l.path);
    const info = await probe(l.path);
    const tempo = l.tempo && Math.abs(l.tempo - 1) > 0.005 ? l.tempo : 1;
    const dur = info.duration_sec / tempo;
    starts.push(cursor);
    ends.push(cursor + dur);
    cursor += dur + l.pauseAfterSec;
    const tempoFilter = tempo !== 1 ? `,atempo=${tempo.toFixed(4)}` : "";
    parts.push(`[${i}:a]aformat=sample_fmts=s16:sample_rates=48000:channel_layouts=mono${tempoFilter},apad=pad_dur=${l.pauseAfterSec.toFixed(3)}[a${i}]`);
  }
  const concat = lines.map((_, i) => `[a${i}]`).join("") + `concat=n=${lines.length}:v=0:a=1[out]`;
  args.push("-filter_complex", `${parts.join(";")};${concat}`, "-map", "[out]", "-c:a", "pcm_s16le", outFile);
  const r = await run(ffmpegBin(), args);
  if (r.code !== 0) throw new Error(`assembleLines failed: ${r.stderr.slice(-1500)}`);
  const total = (await probe(outFile)).duration_sec;
  return { starts, ends, total };
}

export interface MixOptions {
  narration: string;
  music?: {
    file: string;
    /** Music loudness relative to the narration loudness while nobody speaks (LU, negative). */
    baseGainDb: number;
    /** Extra reduction while speech is present (dB). */
    duckDb: number;
    /** Speech spans on the narration timeline; music ducks under them. */
    speech: Array<{ start: number; end: number }>;
    intensity?: Array<{ start: number; end: number; level: number }>;
  };
  sfx: Array<{ file: string; at: number; gainDb: number }>;
  durationSec: number;
  targetLufs: number;
  targetTp: number;
  outDir: string;
}

/** Gaps between speech spans (≥ minGap s) over [0, duration]; the music may rise there. */
export function speechGaps(speech: Array<{ start: number; end: number }>, duration: number, minGap = 0.5): Array<{ start: number; end: number }> {
  const spans = [...speech].sort((a, b) => a.start - b.start);
  const gaps: Array<{ start: number; end: number }> = [];
  let cursor = 0;
  for (const s of spans) {
    if (s.start - cursor >= minGap) gaps.push({ start: cursor, end: s.start });
    cursor = Math.max(cursor, s.end);
  }
  if (duration - cursor >= minGap) gaps.push({ start: cursor, end: duration });
  return gaps;
}

/**
 * Deterministic ducking as an FFmpeg volume expression: `duckFactor` under
 * speech, rising smoothly (0.35 s up, 0.2 s down) to 1 inside speech gaps.
 */
export function duckExpression(gaps: Array<{ start: number; end: number }>, duckDb: number): string {
  const duck = Math.pow(10, -duckDb / 20).toFixed(4);
  if (!gaps.length) return duck;
  const g = gaps.map((x) => `min(max((t-${x.start.toFixed(3)})/0.35,0),1)*min(max((${x.end.toFixed(3)}-t)/0.2,0),1)`).join("+");
  return `${duck}+(1-${duck})*min(${g},1)`;
}

/**
 * Builds the final mix: narration + calibrated, ducked music bed + SFX, then
 * gain + limiter + two-pass loudness normalisation. Writes stems for analysis.
 */
export async function mixMaster(o: MixOptions): Promise<{ master: string; musicStem?: string }> {
  ensureDir(o.outDir);
  const master = path.join(o.outDir, "master.wav");
  const premix = path.join(o.outDir, "premix.wav");
  const pre = path.join(o.outDir, "premaster.wav");
  const args: string[] = ["-y", "-i", o.narration];
  const filters: string[] = ["[0:a]aformat=sample_fmts=s16:sample_rates=48000:channel_layouts=mono,apad=whole_dur=" + o.durationSec.toFixed(3) + "[narr]"];
  const mixInputs: string[] = ["[narr]"];
  let idx = 1;
  let musicStem: string | undefined;
  if (o.music) {
    // Calibrate: measure narration and bed loudness, then place the bed baseGainDb LU under the narration.
    const narrLufs = (await measureLoudnorm(o.narration, o.targetLufs, o.targetTp)).input_i;
    const bedLufs = (await measureLoudnorm(o.music.file, o.targetLufs, o.targetTp, o.durationSec)).input_i;
    const gainDb = narrLufs + o.music.baseGainDb - bedLufs;
    args.push("-stream_loop", "-1", "-i", o.music.file);
    let volExpr = "1";
    if (o.music.intensity?.length) {
      const segs = o.music.intensity.map((s) => `between(t,${s.start.toFixed(2)},${s.end.toFixed(2)})*${Math.pow(10, (-9 * (1 - s.level)) / 20).toFixed(4)}`);
      volExpr = `max(${segs.join("+")},0.35)`;
    }
    const duck = duckExpression(speechGaps(o.music.speech, o.durationSec), o.music.duckDb);
    const fadeOut = Math.max(0, o.durationSec - 1.5);
    filters.push(
      `[${idx}:a]aformat=sample_fmts=s16:sample_rates=48000:channel_layouts=mono,atrim=0:${o.durationSec.toFixed(3)},asetpts=PTS-STARTPTS,volume=${gainDb.toFixed(2)}dB,volume='${volExpr}':eval=frame,volume='${duck}':eval=frame,afade=t=in:d=1,afade=t=out:st=${fadeOut.toFixed(2)}:d=1.5[bed]`,
      `[bed]asplit=2[bedMix][bedStem]`
    );
    mixInputs.push("[bedMix]");
    musicStem = path.join(o.outDir, "music_stem.wav");
    idx++;
  }
  for (const s of o.sfx) {
    args.push("-i", s.file);
    const ms = Math.round(s.at * 1000);
    filters.push(`[${idx}:a]aformat=sample_fmts=s16:sample_rates=48000:channel_layouts=mono,volume=${s.gainDb}dB,adelay=${ms}|${ms}[sfx${idx}]`);
    mixInputs.push(`[sfx${idx}]`);
    idx++;
  }
  filters.push(`${mixInputs.join("")}amix=inputs=${mixInputs.length}:duration=first:normalize=0[mix]`);
  args.push("-filter_complex", filters.join(";"), "-map", "[mix]", "-ar", "48000", "-c:a", "pcm_s16le", premix);
  if (musicStem) args.push("-map", "[bedStem]", "-ar", "48000", "-c:a", "pcm_s16le", musicStem);
  const r = await run(ffmpegBin(), args);
  if (r.code !== 0) throw new Error(`mix failed: ${r.stderr.slice(-2000)}`);

  // Bus: gain towards the target, then a brick-wall limiter at the true-peak ceiling (peaky narration needs this to reach the target).
  const m0 = await measureLoudnorm(premix, o.targetLufs, o.targetTp);
  const gain = o.targetLufs - m0.input_i + 1.5;
  const bus = `volume=${gain.toFixed(2)}dB,alimiter=limit=${Math.pow(10, (o.targetTp - 0.3) / 20).toFixed(4)}:attack=3:release=50:level=false`;
  const r1 = await run(ffmpegBin(), ["-y", "-i", premix, "-af", bus, "-ar", "48000", "-c:a", "pcm_s16le", pre]);
  if (r1.code !== 0) throw new Error(`bus processing failed: ${r1.stderr.slice(-1500)}`);

  // Two-pass loudnorm (linear) for the final trim.
  const m = await measureLoudnorm(pre, o.targetLufs, o.targetTp);
  const apply = `loudnorm=I=${o.targetLufs}:TP=${o.targetTp}:LRA=11:measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true`;
  const r2 = await run(ffmpegBin(), ["-y", "-i", pre, "-af", apply, "-ar", "48000", "-c:a", "pcm_s16le", master]);
  if (r2.code !== 0) throw new Error(`loudnorm failed: ${r2.stderr.slice(-1500)}`);
  const check = await measureLoudnorm(master, o.targetLufs, o.targetTp);
  if (Math.abs(check.input_i - o.targetLufs) > 0.8) {
    const r3 = await run(ffmpegBin(), ["-y", "-i", pre, "-af", `loudnorm=I=${o.targetLufs}:TP=${o.targetTp}:LRA=11:linear=false`, "-ar", "48000", "-c:a", "pcm_s16le", master]);
    if (r3.code !== 0) throw new Error(`dynamic loudnorm failed: ${r3.stderr.slice(-1500)}`);
  }
  return { master, musicStem };
}

interface LoudnormMeasure {
  input_i: number;
  input_tp: number;
  input_lra: number;
  input_thresh: number;
  target_offset: number;
}

export async function measureLoudnorm(file: string, targetLufs: number, targetTp: number, limitSec?: number): Promise<LoudnormMeasure> {
  const r = await run(ffmpegBin(), ["-hide_banner", ...(limitSec ? ["-t", limitSec.toFixed(2)] : []), "-i", file, "-af", `loudnorm=I=${targetLufs}:TP=${targetTp}:LRA=11:print_format=json`, "-f", "null", "-"]);
  const m = r.stderr.match(/\{[\s\S]*?\}/g);
  if (!m) throw new Error(`loudnorm measurement failed: ${r.stderr.slice(-800)}`);
  const j = JSON.parse(m[m.length - 1]) as Record<string, string>;
  const num = (k: string) => {
    const v = Number(j[k]);
    return Number.isFinite(v) ? v : -99;
  };
  return { input_i: num("input_i"), input_tp: num("input_tp"), input_lra: num("input_lra"), input_thresh: num("input_thresh"), target_offset: num("target_offset") };
}

/** Full analysis of a master (and optional stems) per the role spec. */
export async function analyzeMaster(master: string, opts: { narration?: string; musicStem?: string; targetLufs: number; targetTp: number }): Promise<LoudnessReport> {
  const m = await measureLoudnorm(master, opts.targetLufs, opts.targetTp);
  const stats = await run(ffmpegBin(), ["-hide_banner", "-i", master, "-af", "astats=metadata=0:reset=0:measure_overall=Peak_level+Flat_factor+Peak_count:measure_perchannel=none", "-f", "null", "-"]);
  const peak = Number(stats.stderr.match(/Peak level dB:\s*([-\d.]+)/)?.[1] ?? "0");
  const peakCount = Number(stats.stderr.match(/Peak count:\s*(\d+)/)?.[1] ?? "0");
  const flat = Number(stats.stderr.match(/Flat factor:\s*([-\d.]+)/)?.[1] ?? "0");
  const clipped = peak >= -0.05 && flat > 0 ? peakCount : 0;
  const sil = await run(ffmpegBin(), ["-hide_banner", "-i", master, "-af", "silencedetect=noise=-45dB:d=1.2", "-f", "null", "-"]);
  const silences: Array<{ start: number; end: number }> = [];
  const starts = [...sil.stderr.matchAll(/silence_start:\s*([\d.]+)/g)].map((x) => Number(x[1]));
  const ends = [...sil.stderr.matchAll(/silence_end:\s*([\d.]+)/g)].map((x) => Number(x[1]));
  starts.forEach((s, i) => silences.push({ start: s, end: ends[i] ?? s }));
  let speech: number | null = null;
  let music: number | null = null;
  if (opts.narration && fs.existsSync(opts.narration)) speech = (await measureLoudnorm(opts.narration, opts.targetLufs, opts.targetTp)).input_i;
  if (opts.musicStem && fs.existsSync(opts.musicStem)) music = (await measureLoudnorm(opts.musicStem, opts.targetLufs, opts.targetTp)).input_i;
  const ratio = speech !== null && music !== null && music > -70 ? speech - music : null;
  const notes: string[] = [];
  const passed = [
    Math.abs(m.input_i - opts.targetLufs) <= 1.0 || notes.push(`integrated ${m.input_i.toFixed(1)} LUFS is off target ${opts.targetLufs}`) === 0,
    m.input_tp <= opts.targetTp + 0.2 || notes.push(`true peak ${m.input_tp.toFixed(1)} dBTP exceeds ${opts.targetTp}`) === 0,
    clipped === 0 || notes.push(`${clipped} clipped samples`) === 0,
    ratio === null || ratio >= 8 || notes.push(`speech/music ratio ${ratio.toFixed(1)} dB is below 8 dB`) === 0,
    ratio === null || ratio <= 30 || notes.push(`speech/music ratio ${ratio.toFixed(1)} dB: music is effectively inaudible`) === 0,
    silences.every((s) => s.end - s.start < 2) || notes.push(`long silence(s): ${silences.filter((s) => s.end - s.start >= 2).map((s) => `${s.start.toFixed(1)}–${s.end.toFixed(1)}s`).join(", ")}`) === 0,
  ].every(Boolean);
  return {
    integrated_lufs: m.input_i,
    true_peak_dbtp: m.input_tp,
    loudness_range_lu: m.input_lra,
    speech_lufs: speech,
    music_lufs: music,
    speech_music_ratio_db: ratio,
    peak_level_db: peak,
    clipped_samples: clipped,
    silences,
    target_lufs: opts.targetLufs,
    target_tp: opts.targetTp,
    passed,
    notes,
  };
}
