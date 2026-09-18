import React from "react";
import { interpolate, useCurrentFrame } from "remotion";
import type { ChartSpec } from "../../src/core/scene.js";
import type { Theme } from "../theme.js";

/** Draws line/area/bar/candlestick charts from scene data with progressive reveal. */
export const Chart: React.FC<{ spec: ChartSpec; theme: Theme; width: number; height: number; sceneStartFrame: number; sceneFrames: number }> = ({ spec, theme, width, height, sceneStartFrame, sceneFrames }) => {
  const frame = useCurrentFrame();
  const local = frame - sceneStartFrame;
  const revealFrames = Math.max(1, Math.round(sceneFrames * 0.6));
  const progress = spec.animate ? interpolate(local, [0, revealFrames], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) : 1;
  const n = spec.series.length;
  const shown = Math.max(1, Math.ceil(n * progress));
  const pad = { l: 70, r: 40, t: 90, b: 60 };
  const w = width - pad.l - pad.r;
  const h = height - pad.t - pad.b;
  const values = spec.series.flatMap((p) => (Array.isArray(p) ? p : [p]));
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const x = (i: number) => pad.l + (i / Math.max(1, n - 1)) * w;
  const y = (v: number) => pad.t + h - ((v - min) / range) * h;
  const isCandle = spec.kind === "candlestick";
  const up = "#22D3A5";
  const down = "#FF5A5A";
  const linePts = spec.series.slice(0, shown).map((p, i) => `${x(i)},${y(Array.isArray(p) ? p[3] : p)}`).join(" ");
  const gridLines = 4;
  return (
    <svg width={width} height={height} style={{ display: "block" }}>
      <rect x={0} y={0} width={width} height={height} rx={28} fill={theme.panel} />
      {spec.title && (
        <text x={pad.l} y={54} fill={theme.fg} fontSize={34} fontWeight={700} fontFamily="Inter, Arial, sans-serif">
          {spec.title}
        </text>
      )}
      {Array.from({ length: gridLines + 1 }, (_, i) => {
        const gy = pad.t + (h * i) / gridLines;
        const v = max - (range * i) / gridLines;
        return (
          <g key={i}>
            <line x1={pad.l} x2={pad.l + w} y1={gy} y2={gy} stroke={theme.muted} strokeOpacity={0.25} strokeDasharray="6 8" />
            <text x={pad.l - 12} y={gy + 8} fill={theme.muted} fontSize={20} textAnchor="end" fontFamily="Inter, Arial, sans-serif">
              {v.toFixed(range < 10 ? 1 : 0)}
            </text>
          </g>
        );
      })}
      {isCandle
        ? spec.series.slice(0, shown).map((p, i) => {
            if (!Array.isArray(p)) return null;
            const [o, hi, lo, c] = p;
            const cw = Math.max(4, (w / n) * 0.6);
            const color = c >= o ? up : down;
            return (
              <g key={i}>
                <line x1={x(i)} x2={x(i)} y1={y(hi)} y2={y(lo)} stroke={color} strokeWidth={2} />
                <rect x={x(i) - cw / 2} y={Math.min(y(o), y(c))} width={cw} height={Math.max(2, Math.abs(y(o) - y(c)))} fill={color} rx={2} />
              </g>
            );
          })
        : spec.kind === "bar"
          ? spec.series.slice(0, shown).map((p, i) => {
              const v = Array.isArray(p) ? p[3] : p;
              const bw = Math.max(6, (w / n) * 0.65);
              return <rect key={i} x={x(i) - bw / 2} y={y(v)} width={bw} height={pad.t + h - y(v)} fill={theme.accent} rx={4} />;
            })
          : (
            <g>
              {spec.kind === "area" && shown > 1 && <polygon points={`${x(0)},${pad.t + h} ${linePts} ${x(shown - 1)},${pad.t + h}`} fill={theme.accent} fillOpacity={0.18} />}
              <polyline points={linePts} fill="none" stroke={theme.accent} strokeWidth={5} strokeLinejoin="round" strokeLinecap="round" />
            </g>
          )}
      {spec.annotations
        .filter((a) => a.index < shown)
        .map((a, i) => {
          const color = a.color ?? theme.accent;
          const ay = a.level !== undefined ? Math.max(pad.t + 26, y(a.level)) : pad.t + 30 + i * 40;
          return (
            <g key={i}>
              {a.level !== undefined && <line x1={pad.l} x2={pad.l + w} y1={ay} y2={ay} stroke={color} strokeWidth={2} strokeDasharray="10 8" />}
              <circle cx={x(a.index)} cy={ay} r={9} fill={color} />
              <rect x={Math.min(x(a.index) + 14, pad.l + w - 220)} y={ay - 22} width={200} height={44} rx={10} fill={color} />
              <text x={Math.min(x(a.index) + 24, pad.l + w - 210)} y={ay + 9} fill="#0B0B0B" fontSize={24} fontWeight={800} fontFamily="Inter, Arial, sans-serif">
                {a.label}
              </text>
            </g>
          );
        })}
      {spec.labels && spec.labels.length > 0 && (
        <g>
          {[0, Math.floor((n - 1) / 2), n - 1].map((i) => (
            <text key={i} x={x(i)} y={pad.t + h + 34} fill={theme.muted} fontSize={20} textAnchor="middle" fontFamily="Inter, Arial, sans-serif">
              {spec.labels?.[i] ?? ""}
            </text>
          ))}
        </g>
      )}
    </svg>
  );
};
