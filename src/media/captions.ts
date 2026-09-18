import type { CaptionTrack, CaptionWord, Scene } from "../core/scene.js";
import type { Transcription } from "../providers/voice/VoiceProvider.js";

/**
 * Caption timing. Preferred source: word timestamps from the voice provider's
 * transcription of the final narration (VoiceStudio /v1/audio/transcriptions,
 * verbose_json). Fallback: distribute each scene's narration words evenly
 * across that scene's measured audio segment.
 */
export function estimateCaptionTrack(scenes: Scene[]): CaptionTrack {
  const words: CaptionWord[] = [];
  for (const s of scenes) {
    const start = s.start_time ?? 0;
    const toks = s.narration.split(/\s+/).filter(Boolean);
    const weights = toks.map((t) => Math.max(2, t.replace(/[^\p{L}\p{N}]/gu, "").length + 1));
    const total = weights.reduce((a, b) => a + b, 0);
    let cursor = start;
    toks.forEach((t, i) => {
      const dur = (s.duration * weights[i]) / total;
      words.push({ word: t, start: cursor, end: cursor + dur });
      cursor += dur;
    });
  }
  return { words, source: "estimated" };
}

export function captionTrackFromTranscription(t: Transcription, fallback: CaptionTrack): CaptionTrack {
  if (!t.words.length) return fallback;
  return { words: t.words.map((w) => ({ word: w.word, start: w.start, end: w.end })), source: "transcription" };
}

function fmt(t: number): string {
  const ms = Math.round(t * 1000);
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  const r = ms % 1000;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(r).padStart(3, "0")}`;
}

/** Group words into short caption lines (max `maxWords` per cue) and emit SRT. */
export function toSrt(track: CaptionTrack, maxWords = 4): string {
  const cues: Array<{ start: number; end: number; text: string }> = [];
  let buf: CaptionWord[] = [];
  const flush = () => {
    if (!buf.length) return;
    cues.push({ start: buf[0].start, end: buf[buf.length - 1].end, text: buf.map((w) => w.word).join(" ") });
    buf = [];
  };
  for (const w of track.words) {
    buf.push(w);
    if (buf.length >= maxWords || /[.!?]$/.test(w.word)) flush();
  }
  flush();
  return cues.map((c, i) => `${i + 1}\n${fmt(c.start)} --> ${fmt(c.end)}\n${c.text}\n`).join("\n");
}

/** Fill each scene's `caption` with its narration lines (used by the renderer as a fallback). */
export function fillSceneCaptions(scenes: Scene[]): Scene[] {
  return scenes.map((s) => ({ ...s, caption: s.caption || s.narration }));
}
