import React from "react";
import { useCurrentFrame, useVideoConfig } from "remotion";
import type { CaptionCue, CaptionStyle } from "../../src/agents/captions/schema.js";
import type { Rect } from "./schema.js";
import { prog, easeOut } from "../motion/util.js";

/** Styled caption pages with active-word treatment, rendered inside the rect the Composer chose for this scene. */
export const CaptionsView: React.FC<{ cues: CaptionCue[]; style: CaptionStyle; rect: Rect; accent: string }> = ({ cues, style, rect, accent }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  const cue = cues.find((c) => t >= c.start && t < c.end);
  if (!cue) return null;
  const inP = easeOut(prog(t, cue.start, cue.start + 0.18));
  const activeIdx = cue.words.findIndex((w) => t >= w.start && t < w.end);
  const verbatim = style.mode === "verbatim";
  // In condensed mode the page text is not the spoken words; highlight the emphasis word or advance a sweep proportional to progress.
  const pageWords = cue.lines.map((l) => l.split(" "));
  const flatCount = pageWords.reduce((a, l) => a + l.length, 0);
  const sweepIdx = verbatim ? activeIdx : Math.min(flatCount - 1, Math.floor(((t - cue.start) / Math.max(0.01, cue.end - cue.start)) * flatCount));
  const entry: React.CSSProperties =
    style.animation === "pop" || style.animation === "word_pop" ? { transform: `scale(${0.9 + 0.1 * inP})`, opacity: inP } : style.animation === "slide_up" ? { transform: `translateY(${(1 - inP) * 24}px)`, opacity: inP } : style.animation === "fade" ? { opacity: inP } : {};
  const bg = style.background === "bar" ? "rgba(0,0,0,0.55)" : style.background === "pill" ? "rgba(0,0,0,0.6)" : "transparent";
  let k = 0;
  const typed = style.animation === "typewriter" ? Math.ceil(cue.text.length * easeOut(prog(t, cue.start, cue.start + 0.5))) : Infinity;
  let charCursor = 0;
  return (
    <div style={{ position: "absolute", left: rect.x, top: rect.y, width: rect.w, height: rect.h, display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none" }}>
      <div style={{ ...entry, background: bg, padding: bg === "transparent" ? 0 : "10px 22px", borderRadius: style.background === "pill" ? 22 : 8, textAlign: "center", maxWidth: rect.w }}>
        {pageWords.map((line, li) => (
          <div key={li} style={{ display: "flex", justifyContent: "center", gap: "0 0.32em", lineHeight: style.line_height, whiteSpace: "nowrap" }}>
            {line.map((w, wi) => {
              const idx = k++;
              const isActive = verbatim ? idx === activeIdx : (cue.emphasis_word ? w.toLowerCase() === cue.emphasis_word.toLowerCase() : idx === sweepIdx);
              const visibleChars = Math.max(0, Math.min(w.length, typed - charCursor));
              charCursor += w.length + 1;
              const shown = typed === Infinity ? w : w.slice(0, visibleChars);
              const box = isActive && style.active_word === "highlight_box";
              const past = verbatim && idx < activeIdx;
              return (
                <span
                  key={wi}
                  style={{
                    fontFamily: style.font_family,
                    fontSize: style.font_size,
                    fontWeight: style.font_weight,
                    letterSpacing: style.letter_spacing,
                    color: box ? "#0B0B0B" : isActive && (style.active_word === "color" || style.active_word === "underline") ? style.highlight_color : past && style.name === "Karaoke" ? style.highlight_color : style.color,
                    background: box ? style.highlight_color : "transparent",
                    padding: box ? "0 0.22em" : 0,
                    borderRadius: box ? 12 : 0,
                    textDecoration: isActive && style.active_word === "underline" ? `underline ${style.highlight_color} 6px` : "none",
                    textUnderlineOffset: 10,
                    transform: isActive && (style.active_word === "scale" || style.animation === "word_pop") ? "scale(1.1)" : "none",
                    display: "inline-block",
                    textShadow: style.background === "shadow" ? "0 4px 18px rgba(0,0,0,0.75), 0 0 2px rgba(0,0,0,0.9)" : "none",
                    textTransform: style.uppercase ? "uppercase" : "none",
                  }}
                >
                  {shown}
                </span>
              );
            })}
          </div>
        ))}
        {!verbatim && cue.emphasis_word === null && accent && <div style={{ height: 6, marginTop: 8, borderRadius: 3, background: accent, width: `${Math.round(((t - cue.start) / Math.max(0.01, cue.end - cue.start)) * 100)}%`, opacity: 0.55 }} />}
      </div>
    </div>
  );
};
