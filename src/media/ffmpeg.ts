import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { env } from "../core/env.js";

export function ffmpegBin(): string {
  return env("FFMPEG_PATH", "ffmpeg")!;
}
export function ffprobeBin(): string {
  return env("FFPROBE_PATH", "ffprobe")!;
}

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

export function run(cmd: string, args: string[], opts: { cwd?: string; env?: NodeJS.ProcessEnv; onLine?: (l: string) => void } = {}): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: opts.cwd, env: { ...process.env, ...opts.env }, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => {
      const s = d.toString();
      stdout += s;
      opts.onLine?.(s);
    });
    child.stderr.on("data", (d) => {
      const s = d.toString();
      stderr += s;
      opts.onLine?.(s);
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? -1, stdout, stderr }));
  });
}

export async function commandExists(cmd: string): Promise<boolean> {
  const r = await run(process.platform === "win32" ? "where" : "which", [cmd]).catch(() => ({ code: 1, stdout: "", stderr: "" }));
  return r.code === 0;
}

export interface MediaInfo {
  duration_sec: number;
  width?: number;
  height?: number;
  fps?: number;
  has_audio: boolean;
  has_video: boolean;
  audio_sample_rate?: number;
  audio_channels?: number;
  codec_video?: string;
  codec_audio?: string;
}

export async function probe(file: string): Promise<MediaInfo> {
  const r = await run(ffprobeBin(), ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", file]);
  if (r.code !== 0) throw new Error(`ffprobe failed for ${file}: ${r.stderr}`);
  const j = JSON.parse(r.stdout) as { format?: { duration?: string }; streams?: Array<Record<string, string>> };
  const streams = j.streams ?? [];
  const v = streams.find((s) => s.codec_type === "video");
  const a = streams.find((s) => s.codec_type === "audio");
  let fps: number | undefined;
  if (v?.r_frame_rate) {
    const [n, d] = v.r_frame_rate.split("/").map(Number);
    if (n && d) fps = n / d;
  }
  return {
    duration_sec: Number(j.format?.duration ?? 0),
    width: v ? Number(v.width) : undefined,
    height: v ? Number(v.height) : undefined,
    fps,
    has_audio: Boolean(a),
    has_video: Boolean(v),
    audio_sample_rate: a ? Number(a.sample_rate) : undefined,
    audio_channels: a ? Number(a.channels) : undefined,
    codec_video: v?.codec_name,
    codec_audio: a?.codec_name,
  };
}

/** Concatenate audio files (any format) into one WAV, inserting `gapSec` of silence between them. Returns per-segment offsets. */
export async function concatAudio(files: string[], outFile: string, gapSec = 0.25): Promise<{ offsets: number[]; total: number }> {
  const offsets: number[] = [];
  let cursor = 0;
  const durations: number[] = [];
  for (const f of files) {
    const info = await probe(f);
    offsets.push(cursor);
    durations.push(info.duration_sec);
    cursor += info.duration_sec + gapSec;
  }
  const total = cursor - gapSec;
  const args: string[] = ["-y"];
  for (const f of files) args.push("-i", f);
  // Build filter: [0:a]apad=pad_dur=gap[a0]; ... concat
  const parts = files.map((_, i) => `[${i}:a]aformat=sample_fmts=s16:sample_rates=48000:channel_layouts=mono,apad=pad_dur=${i < files.length - 1 ? gapSec : 0}[a${i}]`);
  const concat = files.map((_, i) => `[a${i}]`).join("") + `concat=n=${files.length}:v=0:a=1[out]`;
  args.push("-filter_complex", `${parts.join(";")};${concat}`, "-map", "[out]", "-c:a", "pcm_s16le", outFile);
  const r = await run(ffmpegBin(), args);
  if (r.code !== 0) throw new Error(`ffmpeg concat failed: ${r.stderr.slice(-2000)}`);
  return { offsets, total };
}

/** Apply post-processing to narration: pitch shift (semitones), gain (dB), normalisation. */
export async function postProcessAudio(inFile: string, outFile: string, opts: { pitchSemitones?: number; gainDb?: number; loudnorm?: boolean }): Promise<void> {
  const filters: string[] = [];
  const st = opts.pitchSemitones ?? 0;
  if (st !== 0) {
    const ratio = Math.pow(2, st / 12);
    // Pitch shift preserving duration: resample then tempo-correct.
    filters.push(`asetrate=48000*${ratio.toFixed(5)}`, `aresample=48000`, `atempo=${(1 / ratio).toFixed(5)}`);
  }
  if (opts.gainDb) filters.push(`volume=${opts.gainDb}dB`);
  if (opts.loudnorm !== false) filters.push("loudnorm=I=-16:TP=-1.5:LRA=11");
  const args = ["-y", "-i", inFile, "-ar", "48000"];
  if (filters.length) args.push("-af", filters.join(","));
  args.push("-c:a", "pcm_s16le", outFile);
  const r = await run(ffmpegBin(), args);
  if (r.code !== 0) throw new Error(`ffmpeg post-process failed: ${r.stderr.slice(-2000)}`);
}

/** Mux a silent video with an audio track (re-encode audio to AAC, copy video). */
export async function muxAudio(videoFile: string, audioFile: string, outFile: string): Promise<void> {
  const r = await run(ffmpegBin(), ["-y", "-i", videoFile, "-i", audioFile, "-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-shortest", "-movflags", "+faststart", outFile]);
  if (r.code !== 0) throw new Error(`ffmpeg mux failed: ${r.stderr.slice(-2000)}`);
}

/** Final delivery encode: H.264 high, yuv420p, faststart – YouTube Shorts friendly. */
export async function finalizeMp4(inFile: string, outFile: string, opts: { width: number; height: number; fps: number }): Promise<void> {
  const r = await run(ffmpegBin(), [
    "-y", "-i", inFile,
    "-vf", `scale=${opts.width}:${opts.height}:flags=lanczos,fps=${opts.fps},format=yuv420p`,
    "-c:v", "libx264", "-profile:v", "high", "-preset", "medium", "-crf", "18",
    "-c:a", "aac", "-b:a", "192k", "-ar", "48000",
    "-movflags", "+faststart", outFile,
  ]);
  if (r.code !== 0) throw new Error(`ffmpeg finalize failed: ${r.stderr.slice(-2000)}`);
}

/** Convert any audio to 16 kHz mono WAV (what LongCat's audio pipeline loads via librosa). */
export async function toWav16kMono(inFile: string, outFile: string): Promise<void> {
  const r = await run(ffmpegBin(), ["-y", "-i", inFile, "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", outFile]);
  if (r.code !== 0) throw new Error(`ffmpeg wav convert failed: ${r.stderr.slice(-2000)}`);
}

export function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

export function fileExistsNonEmpty(file: string): boolean {
  try {
    return fs.statSync(file).size > 0;
  } catch {
    return false;
  }
}

export function basenameNoExt(file: string): string {
  return path.basename(file, path.extname(file));
}
