import { probe } from "../../media/ffmpeg.js";
import type { MasterTimeline } from "../../../remotion/composition/schema.js";
import type { RenderSpec } from "./schema.js";

export interface QACheck {
  name: string;
  passed: boolean;
  detail: string;
}
export interface QAReport {
  passed: boolean;
  checks: QACheck[];
}

/** Delivery + synchronisation QA on the final file and the timeline. */
export async function composerQA(file: string, timeline: MasterTimeline, spec: RenderSpec, narrationDuration: number): Promise<QAReport> {
  const info = await probe(file);
  const checks: QACheck[] = [];
  const add = (name: string, passed: boolean, detail: string) => checks.push({ name, passed, detail });
  add("container/codec", info.codec_video === "h264" && info.codec_audio === "aac", `video=${info.codec_video} audio=${info.codec_audio}`);
  add("dimensions", info.width === spec.width && info.height === spec.height, `${info.width}x${info.height} (expected ${spec.width}x${spec.height})`);
  add("frame rate", Math.abs((info.fps ?? 0) - spec.fps) < 0.6, `${info.fps?.toFixed(2)} fps (expected ${spec.fps})`);
  add("duration ≤ 180s", info.duration_sec > 0 && info.duration_sec <= 180, `${info.duration_sec.toFixed(2)}s`);
  add("audio 48 kHz", info.has_audio && (info.audio_sample_rate ?? 0) === 48000, `sample_rate=${info.audio_sample_rate}`);
  add("video covers narration", info.duration_sec + 0.3 >= narrationDuration, `video ${info.duration_sec.toFixed(2)}s vs narration ${narrationDuration.toFixed(2)}s`);
  // Sync: scenes tile the narration with no gaps.
  const scenes = [...timeline.scenes].sort((a, b) => a.start - b.start);
  const gaps = scenes.slice(1).filter((s, i) => Math.abs(s.start - scenes[i].end) > 0.05).map((s) => s.beat_id);
  add("scenes tile the timeline", gaps.length === 0, gaps.length ? `gaps before ${gaps.join(", ")}` : `${scenes.length} scenes contiguous`);
  // Overlap: no caption rect intersects a reserved rect.
  const overlaps: string[] = [];
  for (const s of scenes) {
    const cap = s.layers.find((l) => l.type === "caption");
    if (!cap) continue;
    for (const r of s.reserved) {
      const a = cap.rect, b = r.rect;
      const area = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
      if (area > a.w * a.h * 0.1) overlaps.push(`${s.beat_id}:${r.owner}`);
    }
  }
  add("captions clear of faces/charts/headlines", overlaps.length === 0, overlaps.length ? overlaps.join(", ") : "no significant overlap");
  // Safe area: all text/caption rects inside.
  const outside = scenes.flatMap((s) => s.layers.filter((l) => (l.type === "text" || l.type === "caption") && (l.rect.y < timeline.height * 0.08 - 1 || l.rect.y + l.rect.h > timeline.height * (1 - 0.14) + 1)).map((l) => l.id));
  add("safe areas", outside.length === 0, outside.length ? outside.join(", ") : "all text inside safe area");
  // Presenter visible share.
  const presenterTime = scenes.filter((s) => s.layers.some((l) => l.type === "presenter")).reduce((a, s) => a + s.duration, 0);
  add("presenter presence", timeline.scenes.length === 0 || presenterTime === 0 || presenterTime / narrationDuration >= 0.55, `${Math.round((presenterTime / Math.max(1, narrationDuration)) * 100)}% of runtime`);
  return { passed: checks.every((c) => c.passed), checks };
}
