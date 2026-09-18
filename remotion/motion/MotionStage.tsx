import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import type { BeatMotion, MotionLayer, MotionTheme } from "./schema.js";
import { CandlestickChart } from "./CandlestickChart.js";
import { LiquiditySweep } from "./LiquiditySweep.js";
import { Arrow, NumberCounter, Headline, LowerThird, Timeline } from "./Primitives.js";
import { prog, easeOut } from "./util.js";

/** Renders one layer at time t inside its normalised rect. */
export const LayerView: React.FC<{ layer: MotionLayer; theme: MotionTheme; t: number; width: number; height: number }> = ({ layer, theme, t, width, height }) => {
  if (t < layer.start || t > layer.end) return null;
  const w = Math.round(layer.rect.w * width);
  const h = Math.round(layer.rect.h * height);
  const common = { theme, t, width: w, height: h };
  let node: React.ReactNode = null;
  switch (layer.kind) {
    case "CandlestickChart":
      node = <CandlestickChart layer={layer} {...common} />;
      break;
    case "LiquiditySweep":
      node = <LiquiditySweep layer={layer} {...common} />;
      break;
    case "Arrow":
      node = <Arrow layer={layer} {...common} />;
      break;
    case "NumberCounter":
      node = <NumberCounter layer={layer} {...common} />;
      break;
    case "Headline":
      node = <Headline layer={layer} {...common} />;
      break;
    case "LowerThird":
      node = <LowerThird layer={layer} {...common} />;
      break;
    case "Timeline":
      node = <Timeline layer={layer} {...common} />;
      break;
  }
  return <div style={{ position: "absolute", left: layer.rect.x * width, top: layer.rect.y * height, width: w, height: h, zIndex: layer.z }}>{node}</div>;
};

/** Renders a beat's layers with its entrance transition. `t` is absolute seconds. */
export const BeatStage: React.FC<{ beat: BeatMotion; theme: MotionTheme; t: number; width: number; height: number }> = ({ beat, theme, t, width, height }) => {
  if (t < beat.start || t > beat.end) return null;
  const p = beat.transition_in === "none" || beat.transition_in === "cut" ? 1 : easeOut(prog(t, beat.start, beat.start + 0.35));
  const style: React.CSSProperties =
    beat.transition_in === "fade" ? { opacity: p } : beat.transition_in === "slide_left" ? { opacity: p, transform: `translateX(${(1 - p) * 120}px)` } : beat.transition_in === "slide_up" ? { opacity: p, transform: `translateY(${(1 - p) * 80}px)` } : beat.transition_in === "zoom" ? { opacity: p, transform: `scale(${0.92 + 0.08 * p})` } : {};
  return (
    <AbsoluteFill style={style}>
      {[...beat.layers].sort((a, b) => a.z - b.z).map((l) => (
        <LayerView key={l.id} layer={l} theme={theme} t={t} width={width} height={height} />
      ))}
    </AbsoluteFill>
  );
};

/** Preview composition: renders plan time [from, to] on a themed background. */
export const MotionPreview: React.FC<{ plan: { theme: MotionTheme; beats: BeatMotion[] }; from: number; to: number }> = ({ plan, from }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const t = from + frame / fps;
  return (
    <AbsoluteFill style={{ backgroundColor: plan.theme.bg }}>
      {plan.beats.map((b) => (
        <BeatStage key={b.beat_id} beat={b} theme={plan.theme} t={t} width={width} height={height} />
      ))}
    </AbsoluteFill>
  );
};
