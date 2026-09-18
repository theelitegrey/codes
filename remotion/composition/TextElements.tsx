import React from "react";
import { useCurrentFrame, useVideoConfig } from "remotion";
import type { TextElement } from "../../src/agents/text/schema.js";
import type { Rect } from "./schema.js";
import type { MotionTheme } from "../motion/schema.js";
import { prog, easeOut, fadeInOut } from "../motion/util.js";

const SIZE: Record<number, number> = { 1: 74, 2: 50, 3: 36, 4: 26 };

/** Renders one Text Agent element inside the rect the Composer assigned. */
export const TextElementView: React.FC<{ element: TextElement; rect: Rect; theme: MotionTheme; fontScale: number }> = ({ element: e, rect, theme, fontScale }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  if (t < e.start || t > e.end) return null;
  const a = fadeInOut(t, e.start, e.end, 0.2);
  const p = easeOut(prog(t, e.start, e.start + 0.35));
  const size = (SIZE[e.level] ?? 36) * fontScale;
  const chip = e.type === "chip" || e.type === "label" || e.type === "chart_label" || e.type === "keyword";
  const tf =
    e.animation === "slide-up" ? `translateY(${(1 - p) * 40}px)` : e.animation === "slide-down" ? `translateY(${(1 - p) * -40}px)` : e.animation === "slide-left" ? `translateX(${(1 - p) * 60}px)` : e.animation === "slide-right" ? `translateX(${(1 - p) * -60}px)` : e.animation === "pop" ? `scale(${0.8 + 0.2 * p})` : "none";
  const clip = e.animation === "wipe" ? `inset(0 ${(1 - p) * 100}% 0 0)` : undefined;
  const text = e.animation === "typewriter" ? e.text.slice(0, Math.ceil(e.text.length * p)) : e.text;
  const align = e.position.endsWith("left") ? "flex-start" : e.position.endsWith("right") ? "flex-end" : "center";
  const isHeadline = e.level === 1 || e.type === "headline" || e.type === "section_title";
  return (
    <div style={{ position: "absolute", left: rect.x, top: rect.y, width: rect.w, height: rect.h, display: "flex", alignItems: "center", justifyContent: align, pointerEvents: "none", opacity: a * (e.animation === "none" ? 1 : p) }}>
      {e.type === "lower_third" ? (
        <div style={{ display: "flex", alignItems: "stretch", transform: tf }}>
          <div style={{ width: 8, background: theme.accent, borderRadius: 4 }} />
          <div style={{ marginLeft: 12, padding: "10px 20px", background: "rgba(0,0,0,0.55)", borderRadius: 10, fontFamily: theme.font, fontWeight: 800, fontSize: size, color: theme.fg }}>{text}</div>
        </div>
      ) : chip ? (
        <div style={{ transform: tf, clipPath: clip, background: e.emphasis ? theme.warn : theme.accent, color: "#0B0B0B", fontFamily: theme.font, fontWeight: 900, fontSize: size, letterSpacing: 2, padding: "8px 18px", borderRadius: 10, textTransform: "uppercase" }}>{text}</div>
      ) : e.type === "statistic" ? (
        <div style={{ transform: tf, fontFamily: theme.mono, fontWeight: 800, fontSize: size * 1.3, color: e.emphasis ? theme.warn : theme.fg, textShadow: "0 4px 18px rgba(0,0,0,0.6)" }}>{text}</div>
      ) : (
        <div style={{ transform: tf, clipPath: clip, fontFamily: theme.font, fontWeight: isHeadline ? 900 : 600, fontSize: size, lineHeight: 1.08, color: e.emphasis && !isHeadline ? theme.accent : theme.fg, textAlign: align === "center" ? "center" : align === "flex-end" ? "right" : "left", textShadow: "0 4px 18px rgba(0,0,0,0.6)", letterSpacing: isHeadline ? -1 : 0, textTransform: isHeadline ? "uppercase" : "none", padding: "0 24px" }}>
          {text}
        </div>
      )}
    </div>
  );
};
