import React from "react";
import type { z } from "zod";
import type { ArrowLayer, NumberCounterLayer, HeadlineLayer, LowerThirdLayer, TimelineLayer, MotionTheme } from "./schema.js";
import { prog, easeOut, fadeInOut, HEADLINE_PX } from "./util.js";

type P<L> = { layer: L; theme: MotionTheme; t: number; width: number; height: number };

export const Arrow: React.FC<P<z.infer<typeof ArrowLayer>>> = ({ layer, theme, t, width, height }) => {
  const a = fadeInOut(t, layer.start, layer.end, 0.2);
  const draw = easeOut(prog(t, layer.start, layer.start + 0.6));
  const [x1, y1] = [layer.from[0] * width, layer.from[1] * height];
  const [x2, y2] = [layer.to[0] * width, layer.to[1] * height];
  const len = Math.hypot(x2 - x1, y2 - y1);
  const color = layer.color ?? theme.accent;
  const mx = (x1 + x2) / 2 + (layer.curved ? (y1 - y2) * 0.35 : 0);
  const my = (y1 + y2) / 2 + (layer.curved ? (x2 - x1) * 0.35 : 0);
  const d = layer.curved ? `M${x1},${y1} Q${mx},${my} ${x2},${y2}` : `M${x1},${y1} L${x2},${y2}`;
  const ang = Math.atan2(y2 - my, x2 - mx);
  const hs = layer.thickness * 2.6;
  return (
    <svg width={width} height={height} style={{ display: "block", opacity: a }}>
      <path d={d} fill="none" stroke={color} strokeWidth={layer.thickness} strokeLinecap="round" strokeDasharray={len * 1.2} strokeDashoffset={len * 1.2 * (1 - draw)} />
      {draw > 0.95 && <polygon points={`${x2},${y2} ${x2 - hs * Math.cos(ang - 0.5)},${y2 - hs * Math.sin(ang - 0.5)} ${x2 - hs * Math.cos(ang + 0.5)},${y2 - hs * Math.sin(ang + 0.5)}`} fill={color} />}
      {layer.label && draw > 0.6 && (
        <text x={mx} y={my - 16} fill={color} fontSize={26} fontWeight={800} textAnchor="middle" fontFamily={theme.font}>
          {layer.label}
        </text>
      )}
    </svg>
  );
};

export const NumberCounter: React.FC<P<z.infer<typeof NumberCounterLayer>>> = ({ layer, theme, t, width, height }) => {
  const a = fadeInOut(t, layer.start, layer.end, 0.25);
  const p = easeOut(prog(t, layer.start, layer.start + (layer.end - layer.start) * layer.count_fraction));
  const v = layer.from + (layer.to - layer.from) * p;
  return (
    <div style={{ width, height, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", opacity: a }}>
      <div style={{ fontFamily: theme.mono, fontWeight: 800, fontSize: Math.min(width / 6, 150), color: theme.fg, letterSpacing: -2, transform: `scale(${0.9 + 0.1 * p})` }}>
        {layer.prefix}
        {v.toFixed(layer.decimals)}
        {layer.suffix}
      </div>
      {layer.label && <div style={{ marginTop: 12, fontFamily: theme.font, fontWeight: 600, fontSize: 30, color: theme.muted, letterSpacing: 2, textTransform: "uppercase" }}>{layer.label}</div>}
    </div>
  );
};

export const Headline: React.FC<P<z.infer<typeof HeadlineLayer>>> = ({ layer, theme, t, width, height }) => {
  const a = fadeInOut(t, layer.start, layer.end, 0.25);
  const px = HEADLINE_PX[layer.size];
  const words = layer.text.split(/\s+/);
  const inDur = 0.5;
  const accent = new Set(layer.accent_words.map((w) => w.toLowerCase()));
  const render = () => {
    if (layer.style === "typewriter") {
      const n = Math.ceil(layer.text.length * prog(t, layer.start, layer.start + inDur * 1.4));
      return <span>{layer.text.slice(0, n)}</span>;
    }
    if (layer.style === "split_words") {
      return words.map((w, i) => {
        const p = easeOut(prog(t, layer.start + i * 0.09, layer.start + i * 0.09 + 0.35));
        return (
          <span key={i} style={{ display: "inline-block", marginRight: "0.28em", opacity: p, transform: `translateY(${(1 - p) * 30}px)`, color: accent.has(w.toLowerCase().replace(/[^a-z0-9]/g, "")) ? theme.accent : theme.fg }}>
            {w}
          </span>
        );
      });
    }
    const p = easeOut(prog(t, layer.start, layer.start + inDur));
    const tf = layer.style === "pop" ? `scale(${0.8 + 0.2 * p})` : layer.style === "slide_up" ? `translateY(${(1 - p) * 60}px)` : "none";
    const clip = layer.style === "wipe" ? `inset(0 ${(1 - p) * 100}% 0 0)` : undefined;
    return <span style={{ display: "inline-block", transform: tf, opacity: p, clipPath: clip }}>{layer.text}</span>;
  };
  return (
    <div style={{ width, height, display: "flex", flexDirection: "column", justifyContent: "center", alignItems: layer.align === "left" ? "flex-start" : "center", padding: 40, opacity: a, boxSizing: "border-box" }}>
      <div style={{ fontFamily: theme.font, fontWeight: 900, fontSize: px, lineHeight: 1.05, color: theme.fg, textAlign: layer.align, letterSpacing: -1 }}>{render()}</div>
      {layer.sub && <div style={{ marginTop: 18, fontFamily: theme.font, fontWeight: 500, fontSize: px * 0.42, color: theme.muted, opacity: prog(t, layer.start + 0.4, layer.start + 0.8) }}>{layer.sub}</div>}
    </div>
  );
};

export const LowerThird: React.FC<P<z.infer<typeof LowerThirdLayer>>> = ({ layer, theme, t, width, height }) => {
  const a = fadeInOut(t, layer.start, layer.end, 0.25);
  const p = easeOut(prog(t, layer.start, layer.start + 0.45));
  const left = layer.side === "left";
  return (
    <div style={{ width, height, position: "relative", opacity: a }}>
      <div style={{ position: "absolute", bottom: 40, [left ? "left" : "right"]: 40, transform: `translateX(${(1 - p) * (left ? -60 : 60)}px)`, display: "flex", alignItems: "stretch" }}>
        <div style={{ width: 8, background: theme.accent, borderRadius: 4 }} />
        <div style={{ padding: "12px 22px", background: "rgba(0,0,0,0.55)", backdropFilter: "blur(6px)", borderRadius: 10, marginLeft: 10 }}>
          <div style={{ fontFamily: theme.font, fontWeight: 800, fontSize: 34, color: theme.fg }}>{layer.title}</div>
          {layer.subtitle && <div style={{ fontFamily: theme.font, fontWeight: 500, fontSize: 22, color: theme.muted, marginTop: 2 }}>{layer.subtitle}</div>}
        </div>
      </div>
    </div>
  );
};

export const Timeline: React.FC<P<z.infer<typeof TimelineLayer>>> = ({ layer, theme, t, width, height }) => {
  const a = fadeInOut(t, layer.start, layer.end, 0.25);
  const horiz = layer.orientation === "horizontal";
  const n = layer.steps.length;
  const pad = 80;
  const len = (horiz ? width : height) - pad * 2;
  return (
    <svg width={width} height={height} style={{ display: "block", opacity: a }}>
      <line x1={horiz ? pad : width / 2} y1={horiz ? height / 2 : pad} x2={horiz ? pad + len * easeOut(prog(t, layer.start, layer.start + 0.6)) : width / 2} y2={horiz ? height / 2 : pad + len * easeOut(prog(t, layer.start, layer.start + 0.6))} stroke={theme.muted} strokeWidth={4} />
      {layer.steps.map((s, i) => {
        const f = i / (n - 1);
        const cx = horiz ? pad + len * f : width / 2;
        const cy = horiz ? height / 2 : pad + len * f;
        const p = easeOut(prog(t, s.at, s.at + 0.35));
        return (
          <g key={i} opacity={p} style={{ transformOrigin: `${cx}px ${cy}px`, transform: `scale(${0.6 + 0.4 * p})` }}>
            <circle cx={cx} cy={cy} r={16} fill={theme.accent} />
            <text x={horiz ? cx : cx + 34} y={horiz ? cy + (i % 2 ? 52 : -32) : cy + 9} fill={theme.fg} fontSize={24} fontWeight={700} textAnchor={horiz ? "middle" : "start"} fontFamily={theme.font}>
              {s.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
};
