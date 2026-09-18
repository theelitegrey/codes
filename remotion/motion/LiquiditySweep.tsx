import React from "react";
import type { z } from "zod";
import type { LiquiditySweepLayer, MotionTheme } from "./schema.js";
import { prog, easeOut, easeInOut, fadeInOut } from "./util.js";

type Props = { layer: z.infer<typeof LiquiditySweepLayer>; theme: MotionTheme; t: number; width: number; height: number };

/**
 * Schematic sweep: 1 price approaches the level, 2 breaks it, 3 wick
 * extends, 4 label appears, 5 price reverses, 6 reversal highlighted.
 */
export const LiquiditySweep: React.FC<Props> = ({ layer, theme, t, width, height }) => {
  const dur = layer.end - layer.start;
  const s = layer.stages;
  const at = (f: number) => layer.start + dur * f;
  const up = layer.direction === "high";
  const pad = 70;
  const levelY = up ? height * 0.32 : height * 0.68;
  const baseY = up ? height * 0.78 : height * 0.22;
  const peakY = up ? levelY - height * 0.14 : levelY + height * 0.14;
  const xApproachEnd = width * 0.5;
  const xPeak = width * 0.58;
  const xEnd = width - pad;
  // Path: flat start → rise to just below level → break to peak → reverse below base.
  const approach = easeInOut(prog(t, layer.start, at(s.approach)));
  const brk = easeOut(prog(t, at(s.approach), at(s.break)));
  const wick = easeOut(prog(t, at(s.break), at(s.wick)));
  const labelP = easeOut(prog(t, at(s.label), at(s.label) + 0.35));
  const rev = easeInOut(prog(t, at(s.label), at(s.reverse)));
  const hl = prog(t, at(s.reverse), layer.end);
  const alpha = fadeInOut(t, layer.start, layer.end, 0.25);

  const pts: Array<[number, number]> = [];
  const nearLevelY = up ? levelY + 18 : levelY - 18;
  const approachPts: Array<[number, number]> = [
    [pad, baseY],
    [pad + (xApproachEnd - pad) * 0.35, baseY + (up ? -10 : 10)],
    [pad + (xApproachEnd - pad) * 0.7, baseY + (nearLevelY - baseY) * 0.45],
    [xApproachEnd, nearLevelY],
  ];
  const nA = Math.max(1, Math.ceil(approachPts.length * approach));
  pts.push(...approachPts.slice(0, nA));
  if (approach >= 1) {
    const breakY = nearLevelY + (peakY - nearLevelY) * (0.55 * brk + 0.45 * wick);
    pts.push([xApproachEnd + (xPeak - xApproachEnd) * Math.max(brk, 0.01), breakY]);
    if (wick >= 1) {
      const revX = xPeak + (xEnd - xPeak) * rev;
      const revY = peakY + (baseY + (up ? 30 : -30) - peakY) * rev;
      pts.push([revX, revY]);
    }
  }
  const d = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
  const levelW = width - pad * 2;
  return (
    <svg width={width} height={height} style={{ display: "block", opacity: alpha }}>
      <line x1={pad} x2={pad + levelW * easeOut(prog(t, layer.start, layer.start + 0.5))} y1={levelY} y2={levelY} stroke={theme.fg} strokeWidth={3} strokeDasharray="14 10" />
      <text x={pad} y={up ? levelY - 16 : levelY + 34} fill={theme.fg} fontSize={26} fontWeight={800} fontFamily={theme.font} letterSpacing={2} opacity={prog(t, layer.start + 0.2, layer.start + 0.5)}>
        {layer.level_label}
      </text>
      <path d={d} fill="none" stroke={theme.accent} strokeWidth={7} strokeLinejoin="round" strokeLinecap="round" />
      {wick > 0 && <line x1={xPeak} x2={xPeak} y1={nearLevelY} y2={nearLevelY + (peakY - nearLevelY) * wick} stroke={theme.warn} strokeWidth={4} opacity={0.9} />}
      {labelP > 0 && (
        <g opacity={labelP} style={{ transformOrigin: `${xPeak}px ${peakY}px`, transform: `scale(${0.7 + 0.3 * labelP})` }}>
          <circle cx={xPeak} cy={peakY} r={12} fill={theme.warn} />
          <rect x={xPeak - 60} y={up ? peakY - 64 : peakY + 30} width={120} height={36} rx={8} fill={theme.warn} />
          <text x={xPeak} y={up ? peakY - 39 : peakY + 55} fill="#0B0B0B" fontSize={20} fontWeight={900} textAnchor="middle" fontFamily={theme.font} letterSpacing={1}>
            {layer.sweep_label}
          </text>
        </g>
      )}
      {hl > 0 && (
        <g opacity={Math.min(1, hl * 2)}>
          <path d={`M${xPeak},${peakY} L${xEnd},${baseY + (up ? 30 : -30)}`} fill="none" stroke={theme.down} strokeWidth={9} strokeLinecap="round" strokeDasharray={`${Math.hypot(xEnd - xPeak, baseY - peakY)}`} strokeDashoffset={`${Math.hypot(xEnd - xPeak, baseY - peakY) * (1 - easeOut(hl))}`} />
          <polygon points={`${xEnd},${baseY + (up ? 30 : -30)} ${xEnd - 22},${baseY + (up ? 4 : -4)} ${xEnd - 4},${baseY + (up ? 2 : -2)}`} fill={theme.down} opacity={easeOut(hl)} />
          {layer.reversal_label && (
            <text x={xEnd - 10} y={baseY + (up ? 68 : -52)} fill={theme.down} fontSize={24} fontWeight={800} textAnchor="end" fontFamily={theme.font} letterSpacing={1}>
              {layer.reversal_label}
            </text>
          )}
        </g>
      )}
    </svg>
  );
};
