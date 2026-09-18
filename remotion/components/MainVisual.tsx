import React from "react";
import { AbsoluteFill, Img, OffthreadVideo, interpolate, staticFile, useCurrentFrame } from "remotion";
import type { Scene } from "../../src/core/scene.js";
import type { Theme } from "../theme.js";
import { Chart } from "./Chart.js";

interface Props {
  scene: Scene;
  asset?: { src: string; kind: "video" | "image" };
  theme: Theme;
  width: number;
  height: number;
  sceneStartFrame: number;
  sceneFrames: number;
  fps: number;
}

/** The upper "main content" area: chart, headline, B-roll, image, or a generated graphic fallback. */
export const MainVisual: React.FC<Props> = ({ scene, asset, theme, width, height, sceneStartFrame, sceneFrames, fps }) => {
  const frame = useCurrentFrame();
  const local = Math.max(0, frame - sceneStartFrame);
  const t = sceneFrames > 0 ? local / sceneFrames : 0;
  const motion = scene.main_visual.motion;
  const scale = motion === "slow_zoom" ? 1 + t * 0.06 : motion === "push_in" ? 1 + t * 0.12 : 1;
  const tx = motion === "pan_left" ? -t * 40 : motion === "pan_right" ? t * 40 : 0;
  const mv = scene.main_visual;
  const inner: React.CSSProperties = { position: "absolute", inset: 0, transform: `translateX(${tx}px) scale(${scale})`, transformOrigin: "50% 50%" };

  if (mv.type === "chart" && mv.chart) {
    return (
      <AbsoluteFill style={{ paddingTop: scene.text_overlay ? 110 : 40, paddingLeft: 40, paddingRight: 40, paddingBottom: 40 }}>
        <Chart spec={mv.chart} theme={theme} width={width - 80} height={height - (scene.text_overlay ? 150 : 80)} sceneStartFrame={sceneStartFrame} sceneFrames={sceneFrames} />
      </AbsoluteFill>
    );
  }

  if (asset?.kind === "video") {
    return (
      <AbsoluteFill style={{ overflow: "hidden" }}>
        <OffthreadVideo src={staticFile(asset.src)} muted startFrom={0} style={{ ...inner, width: "100%", height: "100%", objectFit: "cover" }} />
        <Gradient theme={theme} />
      </AbsoluteFill>
    );
  }
  if (asset?.kind === "image") {
    return (
      <AbsoluteFill style={{ overflow: "hidden" }}>
        <Img src={staticFile(asset.src)} style={{ ...inner, width: "100%", height: "100%", objectFit: "cover" }} />
        <Gradient theme={theme} />
      </AbsoluteFill>
    );
  }

  // Headline / graphic / fallback for missing assets: animated typographic card.
  const headline = mv.headline ?? scene.text_overlay ?? "";
  const sub = mv.subheadline ?? (mv.type === "broll" || mv.type === "ai_visual" || mv.type === "image" || mv.type === "screen_recording" ? mv.prompt ?? "" : "");
  const rise = interpolate(local, [0, Math.round(fps * 0.5)], [60, 0], { extrapolateRight: "clamp" });
  const fade = interpolate(local, [0, Math.round(fps * 0.4)], [0, 1], { extrapolateRight: "clamp" });
  return (
    <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", padding: 70 }}>
      <div style={{ position: "absolute", width: 520, height: 520, borderRadius: 260, background: theme.accent, opacity: 0.18, filter: "blur(60px)", transform: `scale(${scale})` }} />
      <div style={{ transform: `translateY(${rise}px)`, opacity: fade, textAlign: "center" }}>
        <div style={{ color: theme.fg, fontFamily: "Inter, Arial, sans-serif", fontWeight: 900, fontSize: headline.length > 28 ? 64 : 84, lineHeight: 1.05, letterSpacing: -1 }}>{headline}</div>
        {sub && <div style={{ marginTop: 28, color: theme.muted, fontFamily: "Inter, Arial, sans-serif", fontWeight: 500, fontSize: 34, lineHeight: 1.3 }}>{sub}</div>}
      </div>
    </AbsoluteFill>
  );
};

const Gradient: React.FC<{ theme: Theme }> = ({ theme }) => <AbsoluteFill style={{ background: `linear-gradient(180deg, transparent 55%, ${theme.bg} 100%)` }} />;
