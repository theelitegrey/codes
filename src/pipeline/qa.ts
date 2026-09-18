import { probe } from "../media/ffmpeg.js";
import type { QAReport, ProjectState } from "../core/project.js";
import type { ModePreset } from "../presets/modes.js";

/** Technical QA on the rendered MP4 (no LLM): format, dimensions, fps, duration, audio, sync sanity. */
export async function technicalQA(file: string, preset: ModePreset, project: ProjectState): Promise<QAReport> {
  const info = await probe(file);
  const checks: QAReport["checks"] = [];
  const add = (name: string, passed: boolean, detail: string) => checks.push({ name, passed, detail });
  add("container/codec", info.codec_video === "h264" && info.codec_audio === "aac", `video=${info.codec_video} audio=${info.codec_audio}`);
  add("dimensions 9:16", info.width === preset.width && info.height === preset.height, `${info.width}x${info.height} (expected ${preset.width}x${preset.height})`);
  add("frame rate", Math.abs((info.fps ?? 0) - preset.fps) < 0.6, `${info.fps?.toFixed(2)} fps (expected ${preset.fps})`);
  add("duration ≤ 180s (Shorts limit)", info.duration_sec > 0 && info.duration_sec <= 180, `${info.duration_sec.toFixed(2)}s`);
  const target = project.request.target_duration_sec;
  add("duration near target", Math.abs(info.duration_sec - target) <= Math.max(8, target * 0.25), `${info.duration_sec.toFixed(1)}s vs target ${target}s`);
  add("has audio", info.has_audio && (info.audio_sample_rate ?? 0) >= 44100, `sample_rate=${info.audio_sample_rate} channels=${info.audio_channels}`);
  if (project.narration) {
    add("narration fits video", info.duration_sec + 0.5 >= project.narration.duration_sec, `video ${info.duration_sec.toFixed(1)}s vs narration ${project.narration.duration_sec.toFixed(1)}s`);
  }
  if (project.presenter_video) {
    const pv = project.presenter_video;
    add("presenter covers narration", pv.duration_sec + 0.5 >= (project.narration?.duration_sec ?? 0), `presenter ${pv.duration_sec.toFixed(1)}s vs narration ${(project.narration?.duration_sec ?? 0).toFixed(1)}s`);
  }
  if (project.captions) add("captions present", project.captions.words.length > 0, `${project.captions.words.length} words (${project.captions.source})`);
  return { passed: checks.every((c) => c.passed), checks };
}
