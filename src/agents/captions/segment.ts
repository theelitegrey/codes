import type { CaptionCue, CaptionStyle, CaptionWord } from "./schema.js";

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}']/gu, "");

/**
 * Align ASR words to the script's words (Needleman–Wunsch on normalised
 * tokens) so captions use the script's spelling/punctuation with the ASR's
 * timing. Unmatched script words borrow timing from neighbours.
 */
export function alignToScript(asr: CaptionWord[], scriptText: string): CaptionWord[] {
  const script = scriptText.split(/\s+/).filter(Boolean);
  if (!asr.length || !script.length) return asr;
  const n = asr.length;
  const m = script.length;
  const S = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  for (let i = 1; i <= n; i++) S[i][0] = -i;
  for (let j = 1; j <= m; j++) S[0][j] = -j;
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const match = norm(asr[i - 1].text) === norm(script[j - 1]) ? 2 : -1;
      S[i][j] = Math.max(S[i - 1][j - 1] + match, S[i - 1][j] - 1, S[i][j - 1] - 1);
    }
  }
  const mapped: Array<CaptionWord | null> = new Array(m).fill(null);
  let i = n;
  let j = m;
  while (i > 0 && j > 0) {
    const match = norm(asr[i - 1].text) === norm(script[j - 1]) ? 2 : -1;
    if (S[i][j] === S[i - 1][j - 1] + match) {
      mapped[j - 1] = { text: script[j - 1], start: asr[i - 1].start, end: asr[i - 1].end, emphasis: false };
      i--;
      j--;
    } else if (S[i][j] === S[i - 1][j] - 1) i--;
    else j--;
  }
  // Fill gaps: interpolate between neighbouring matched words.
  const out: CaptionWord[] = [];
  for (let k = 0; k < m; k++) {
    if (mapped[k]) {
      out.push(mapped[k]!);
      continue;
    }
    let prev = k - 1;
    while (prev >= 0 && !mapped[prev]) prev--;
    let next = k + 1;
    while (next < m && !mapped[next]) next++;
    const pEnd = prev >= 0 ? mapped[prev]!.end : asr[0].start;
    const nStart = next < m ? mapped[next]!.start : asr[n - 1].end;
    const gapCount = next - prev - 1;
    const slot = (nStart - pEnd) / Math.max(1, gapCount);
    const idx = k - prev - 1;
    out.push({ text: script[k], start: pEnd + slot * idx, end: pEnd + slot * (idx + 1), emphasis: false });
  }
  // Monotonic guarantee.
  for (let k = 1; k < out.length; k++) if (out[k].start < out[k - 1].end) out[k].start = out[k - 1].end;
  for (const w of out) if (w.end <= w.start) w.end = w.start + 0.05;
  return out;
}

/** Break a list of words into lines honouring max chars per line (greedy, then balance the last two lines). */
export function breakLines(words: string[], maxChars: number, maxLines: number): string[] {
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    if (!cur) cur = w;
    else if ((cur + " " + w).length <= maxChars) cur += " " + w;
    else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  if (lines.length === 2 && lines[1].length < lines[0].length * 0.4) {
    // rebalance: move last word of line 1 down if it fits better
    const l0 = lines[0].split(" ");
    if (l0.length > 1) {
      const moved = l0.pop()!;
      const cand1 = moved + " " + lines[1];
      if (cand1.length <= maxChars) return [l0.join(" "), cand1];
    }
  }
  if (lines.length > maxLines) {
    // Never drop words: fold the overflow into the last permitted line (the segmenter keeps pages within capacity).
    const head = lines.slice(0, maxLines - 1);
    return [...head, lines.slice(maxLines - 1).join(" ")];
  }
  return lines;
}

/**
 * Verbatim segmentation: pages of ≤ maxLines × maxChars, ≤ maxDur seconds,
 * breaking on sentence punctuation and on pauses ≥ gapBreak seconds.
 */
export function segmentVerbatim(words: CaptionWord[], style: CaptionStyle, opts: { maxDur?: number; gapBreak?: number } = {}): CaptionCue[] {
  const maxDur = opts.maxDur ?? 2.5;
  const gapBreak = opts.gapBreak ?? 0.35;
  const capacity = style.max_chars_per_line * style.max_lines;
  const cues: CaptionCue[] = [];
  let buf: CaptionWord[] = [];
  const flush = () => {
    if (!buf.length) return;
    const texts = buf.map((w) => (style.uppercase ? w.text.toUpperCase() : w.text));
    const lines = breakLines(texts, style.max_chars_per_line, style.max_lines);
    cues.push({ id: `cap_${String(cues.length + 1).padStart(3, "0")}`, start: buf[0].start, end: buf[buf.length - 1].end, text: lines.join("\n"), lines, words: buf, emphasis_word: null });
    buf = [];
  };
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const next = words[i + 1];
    const projected = [...buf, w].map((x) => x.text).join(" ").length;
    if (buf.length && (projected > capacity || w.start - buf[0].start > maxDur || breakLines([...buf, w].map((x) => x.text), style.max_chars_per_line, 99).length > style.max_lines)) flush();
    buf.push(w);
    const endsSentence = /[.!?]$/.test(w.text);
    const pause = next ? next.start - w.end : 0;
    if (endsSentence || pause >= gapBreak) flush();
  }
  flush();
  // Enforce minimum on-screen time by extending into the following gap.
  for (let i = 0; i < cues.length; i++) {
    const nextStart = cues[i + 1]?.start ?? Infinity;
    if (cues[i].end - cues[i].start < 0.7) cues[i].end = Math.min(cues[i].start + 0.7, nextStart - 0.02, cues[i].end + 0.5) > cues[i].end ? Math.min(cues[i].start + 0.7, Math.max(cues[i].end, nextStart - 0.02)) : cues[i].end;
  }
  return cues;
}

/** Build cues from condensed pages (word index spans) produced by the LLM. */
export function cuesFromPages(words: CaptionWord[], pages: Array<{ from_word: number; to_word: number; lines: string[]; emphasis_word: string | null }>, style: CaptionStyle): CaptionCue[] {
  return pages.map((p, i) => {
    const span = words.slice(p.from_word, p.to_word + 1);
    const lines = p.lines.map((l) => (style.uppercase ? l.toUpperCase() : l));
    const nextStart = pages[i + 1] ? words[pages[i + 1].from_word].start : Infinity;
    const start = span[0].start;
    const end = Math.max(span[span.length - 1].end, Math.min(start + 0.7, nextStart - 0.02));
    const emph = p.emphasis_word ? (style.uppercase ? p.emphasis_word.toUpperCase() : p.emphasis_word) : null;
    return { id: `cap_${String(i + 1).padStart(3, "0")}`, start, end, text: lines.join("\n"), lines, words: span, emphasis_word: emph };
  });
}

export function lintCues(cues: CaptionCue[], style: CaptionStyle, totalWords: number, mode: "verbatim" | "condensed"): string[] {
  const p: string[] = [];
  let covered = 0;
  for (let i = 0; i < cues.length; i++) {
    const c = cues[i];
    if (c.lines.length > style.max_lines) p.push(`${c.id}: ${c.lines.length} lines > ${style.max_lines}`);
    for (const l of c.lines) if (l.length > style.max_chars_per_line + 2) p.push(`${c.id}: line "${l}" is ${l.length} chars > ${style.max_chars_per_line}`);
    if (c.end <= c.start) p.push(`${c.id}: non-positive duration`);
    if (c.end - c.start > 3.2) p.push(`${c.id}: on screen ${(c.end - c.start).toFixed(1)}s > 2.5s`);
    if (i > 0 && c.start < cues[i - 1].start) p.push(`${c.id}: out of order`);
    if (i > 0 && c.start < cues[i - 1].end - 0.05) p.push(`${c.id}: overlaps ${cues[i - 1].id}`);
    if (c.emphasis_word && !c.text.toLowerCase().includes(c.emphasis_word.toLowerCase())) p.push(`${c.id}: emphasis word "${c.emphasis_word}" is not in the page text`);
    covered += c.words.length;
  }
  if (mode === "verbatim" && covered !== totalWords) p.push(`verbatim pages cover ${covered} of ${totalWords} words`);
  if (mode === "condensed" && covered !== totalWords) p.push(`condensed spans cover ${covered} of ${totalWords} spoken words (every word belongs to exactly one page)`);
  return [...new Set(p)];
}

export function cuesToSrt(cues: CaptionCue[]): string {
  const f = (t: number) => {
    const ms = Math.round(t * 1000);
    const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000), s = Math.floor((ms % 60000) / 1000), r = ms % 1000;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(r).padStart(3, "0")}`;
  };
  return cues.map((c, i) => `${i + 1}\n${f(c.start)} --> ${f(c.end)}\n${c.text}\n`).join("\n");
}
