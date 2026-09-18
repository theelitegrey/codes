import React, { useMemo } from "react";
import type { z } from "zod";
import { CandlestickChartLayer, type ChartOverlay, type MotionTheme, type Candle } from "./schema.js";
import { generateCandles } from "./candles.js";
import { prog, easeOut, fadeInOut } from "./util.js";

type Props = { layer: z.infer<typeof CandlestickChartLayer>; theme: MotionTheme; t: number; width: number; height: number };

/** Candle chart with progressive reveal and price-space overlays (FVG, levels, markers, trade setups, sessions, sweeps). */
export const CandlestickChart: React.FC<Props> = ({ layer, theme, t, width, height }) => {
  const data = useMemo(() => ("candles" in layer.source ? { candles: layer.source.candles as Candle[], key_index: 0, key_level: 0 } : generateCandles(layer.source.generate.pattern, layer.source.generate.count, layer.source.generate.seed, layer.source.generate.key_index)), [layer.source]);
  const n = data.candles.length;
  const pad = { l: 24, r: 96, t: layer.title ? 64 : 24, b: 28 };
  const w = width - pad.l - pad.r;
  const h = height - pad.t - pad.b;
  const all = data.candles.flatMap((c) => [c[1], c[2]]);
  const overlayVals = layer.overlays.flatMap((o) => ("price" in o ? [o.price] : "top" in o ? [o.top, o.bottom] : "entry" in o ? [o.entry, o.stop, o.target] : "level" in o ? [o.level] : []));
  const min = Math.min(...all, ...overlayVals) - 0.5;
  const max = Math.max(...all, ...overlayVals) + 0.5;
  const x = (i: number) => pad.l + ((i + 0.5) / n) * w;
  const y = (p: number) => pad.t + h - ((p - min) / (max - min)) * h;
  const cw = Math.max(3, (w / n) * 0.62);
  const revealEnd = layer.start + (layer.end - layer.start) * layer.reveal_fraction;
  const shown = Math.max(1, Math.ceil(n * easeOut(prog(t, layer.start, revealEnd))));
  const alpha = fadeInOut(t, layer.start, layer.end, 0.25);
  return (
    <svg width={width} height={height} style={{ display: "block", opacity: alpha }}>
      {layer.title && (
        <text x={pad.l} y={40} fill={theme.fg} fontSize={30} fontWeight={700} fontFamily={theme.font}>
          {layer.title}
        </text>
      )}
      {layer.show_grid &&
        [0, 0.25, 0.5, 0.75, 1].map((f) => (
          <line key={f} x1={pad.l} x2={pad.l + w} y1={pad.t + h * f} y2={pad.t + h * f} stroke={theme.muted} strokeOpacity={0.18} strokeDasharray="4 8" />
        ))}
      {data.candles.slice(0, shown).map((c, i) => {
        const [o, hi, lo, cl] = c;
        const up = cl >= o;
        const color = up ? theme.up : theme.down;
        const grow = i === shown - 1 ? easeOut(prog(t, layer.start + ((i / n) * (revealEnd - layer.start)), layer.start + (((i + 1) / n) * (revealEnd - layer.start)))) : 1;
        return (
          <g key={i} style={{ transformOrigin: `${x(i)}px ${y(Math.min(o, cl))}px`, transform: `scaleY(${Math.max(0.05, grow)})` }}>
            <line x1={x(i)} x2={x(i)} y1={y(hi)} y2={y(lo)} stroke={color} strokeWidth={2} />
            <rect x={x(i) - cw / 2} y={Math.min(y(o), y(cl))} width={cw} height={Math.max(2, Math.abs(y(o) - y(cl)))} fill={color} rx={1.5} />
          </g>
        );
      })}
      {layer.overlays.map((o, i) => (
        <Overlay key={i} o={o} t={t} x={x} y={y} theme={theme} n={n} padL={pad.l} w={w} shown={shown} />
      ))}
    </svg>
  );
};

const Overlay: React.FC<{ o: ChartOverlay; t: number; x: (i: number) => number; y: (p: number) => number; theme: MotionTheme; n: number; padL: number; w: number; shown: number }> = ({ o, t, x, y, theme, n, padL, w, shown }) => {
  if (t < o.start || t > o.end) return null;
  const a = fadeInOut(t, o.start, o.end, 0.25);
  const grow = easeOut(prog(t, o.start, o.start + 0.5));
  const right = padL + w;
  switch (o.kind) {
    case "PriceLabel": {
      const x1 = x(o.from_index) - 8;
      const x2 = o.to_index !== undefined ? x(o.to_index) : right;
      const color = o.color ?? (o.emphasis ? theme.warn : theme.fg);
      return (
        <g opacity={a}>
          <line x1={x1} x2={x1 + (x2 - x1) * grow} y1={y(o.price)} y2={y(o.price)} stroke={color} strokeWidth={o.emphasis ? 3 : 2} strokeDasharray={o.style === "dashed" ? "10 8" : undefined} />
          <rect x={right + 4} y={y(o.price) - 16} width={90} height={32} rx={6} fill={color} />
          <text x={right + 49} y={y(o.price) + 7} fill="#0B0B0B" fontSize={17} fontWeight={800} textAnchor="middle" fontFamily={theme.font}>
            {o.label}
          </text>
        </g>
      );
    }
    case "FVGBox": {
      const x1 = x(o.from_index) - 4;
      const x2 = o.to_index !== undefined ? x(o.to_index) : right;
      const color = o.color ?? (o.inverted ? theme.down : theme.accent);
      return (
        <g opacity={a}>
          <rect x={x1} y={y(o.top)} width={(x2 - x1) * grow} height={Math.max(2, y(o.bottom) - y(o.top))} fill={color} fillOpacity={0.22} stroke={color} strokeWidth={1.5} strokeDasharray={o.inverted ? "6 6" : undefined} />
          <text x={x1 + 10} y={y(o.top) + 24} fill={color} fontSize={20} fontWeight={800} fontFamily={theme.font}>
            {o.label}
          </text>
        </g>
      );
    }
    case "Marker": {
      const color = o.color ?? theme.warn;
      const pulse = o.pulse ? 1 + 0.25 * Math.sin(t * 6) : 1;
      const cx = x(o.index);
      const cy = y(o.price);
      const up = o.shape === "arrow_up";
      return (
        <g opacity={a} style={{ transformOrigin: `${cx}px ${cy}px`, transform: `scale(${grow})` }}>
          {o.shape === "ring" ? <circle cx={cx} cy={cy} r={14 * pulse} fill="none" stroke={color} strokeWidth={3} /> : o.shape === "dot" ? <circle cx={cx} cy={cy} r={9 * pulse} fill={color} /> : <polygon points={up ? `${cx},${cy - 14} ${cx - 12},${cy + 8} ${cx + 12},${cy + 8}` : `${cx},${cy + 14} ${cx - 12},${cy - 8} ${cx + 12},${cy - 8}`} fill={color} />}
          <text x={cx} y={up ? cy + 34 : cy - 22} fill={color} fontSize={20} fontWeight={800} textAnchor="middle" fontFamily={theme.font}>
            {o.label}
          </text>
        </g>
      );
    }
    case "TradeSetup": {
      const x1 = x(o.from_index) - 6;
      const wdt = (right - x1) * grow;
      const long = o.side === "long";
      const riskTop = long ? o.entry : o.stop;
      const riskBot = long ? o.stop : o.entry;
      const rewTop = long ? o.target : o.entry;
      const rewBot = long ? o.entry : o.target;
      return (
        <g opacity={a}>
          <rect x={x1} y={y(rewTop)} width={wdt} height={Math.max(2, y(rewBot) - y(rewTop))} fill={theme.up} fillOpacity={0.2} />
          <rect x={x1} y={y(riskTop)} width={wdt} height={Math.max(2, y(riskBot) - y(riskTop))} fill={theme.down} fillOpacity={0.2} />
          {[
            [o.entry, "ENTRY", theme.fg],
            [o.stop, "SL", theme.down],
            [o.target, "TP", theme.up],
          ].map(([p, l, c]) => (
            <g key={l as string}>
              <line x1={x1} x2={x1 + wdt} y1={y(p as number)} y2={y(p as number)} stroke={c as string} strokeWidth={2} />
              <text x={x1 + 8} y={y(p as number) - 6} fill={c as string} fontSize={18} fontWeight={800} fontFamily={theme.mono}>
                {l as string}
              </text>
            </g>
          ))}
        </g>
      );
    }
    case "SessionRange": {
      const x1 = x(o.from_index) - 6;
      const x2 = x(Math.min(o.to_index, n - 1)) + 6;
      const color = o.color ?? theme.accent;
      return (
        <g opacity={a}>
          <rect x={x1} y={0} width={(x2 - x1) * grow} height="100%" fill={color} fillOpacity={0.08} />
          <text x={x1 + 8} y={22} fill={color} fontSize={18} fontWeight={800} fontFamily={theme.font}>
            {o.label}
          </text>
        </g>
      );
    }
    case "SweepHighlight": {
      if (o.index >= shown) return null;
      const cx = x(o.index);
      const above = o.direction === "above";
      const p = prog(t, o.start, o.start + 0.6);
      return (
        <g opacity={a}>
          <circle cx={cx} cy={y(o.level)} r={22 + 40 * p} fill="none" stroke={theme.warn} strokeWidth={3} strokeOpacity={1 - p} />
          <circle cx={cx} cy={y(o.level)} r={20} fill="none" stroke={theme.warn} strokeWidth={3} />
          <rect x={cx - 48} y={above ? y(o.level) - 62 : y(o.level) + 30} width={96} height={30} rx={7} fill={theme.warn} />
          <text x={cx} y={above ? y(o.level) - 41 : y(o.level) + 51} fill="#0B0B0B" fontSize={17} fontWeight={900} textAnchor="middle" fontFamily={theme.font}>
            {o.label}
          </text>
        </g>
      );
    }
  }
};
