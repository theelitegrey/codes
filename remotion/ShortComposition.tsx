import React from "react";
import { AbsoluteFill, Audio, Sequence, interpolate, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import type { ShortProps } from "./props.js";
import { themeFor } from "./theme.js";
import { Background } from "./components/Background.js";
import { MainVisual } from "./components/MainVisual.js";
import { Presenter } from "./components/Presenter.js";
import { Captions } from "./components/Captions.js";
import { TextOverlay } from "./components/TextOverlay.js";
import { layoutFor } from "./layout.js";

/**
 * The composition. Layout per scene comes from the scene's presenter block
 * (decided by the Visual Director) and the mode preset.
 */
export const ShortComposition: React.FC<ShortProps> = (props) => {
  const { preset, scenes, presenter, assets, captions, narration, music } = props;
  const { fps, width, height } = useVideoConfig();
  const frame = useCurrentFrame();
  const theme = themeFor(preset);
  const timed = scenes.map((s) => {
    const start = Math.round((s.start_time ?? 0) * fps);
    const frames = Math.max(1, Math.round(s.duration * fps));
    return { scene: s, start, frames };
  });
  const current = timed.find((t) => frame >= t.start && frame < t.start + t.frames) ?? timed[timed.length - 1];
  const layout = layoutFor(current.scene, preset, width, height, Boolean(presenter));

  // Presenter visibility spans: contiguous runs of presenter-enabled scenes.
  const spans: Array<{ from: number; to: number }> = [];
  for (const t of timed) {
    if (!t.scene.presenter.enabled || !presenter) continue;
    const last = spans[spans.length - 1];
    if (last && last.to === t.start) last.to = t.start + t.frames;
    else spans.push({ from: t.start, to: t.start + t.frames });
  }

  return (
    <AbsoluteFill style={{ backgroundColor: theme.bg }}>
      <Background theme={theme} motion={preset.visual.camera_motion} />
      {timed.map(({ scene, start, frames }) => {
        const l = layoutFor(scene, preset, width, height, Boolean(presenter));
        return (
          <Sequence key={scene.scene_id} from={start} durationInFrames={frames} layout="none">
            <SceneLayer transition={preset.visual.transitions} fps={fps} frames={frames}>
              <div style={{ position: "absolute", left: l.main.x, top: l.main.y, width: l.main.w, height: l.main.h, overflow: "hidden" }}>
                <MainVisual scene={scene} asset={assets[String(scene.scene_id)]} theme={theme} width={l.main.w} height={l.main.h} sceneStartFrame={0} sceneFrames={frames} fps={fps} />
              </div>
              <TextOverlay text={scene.text_overlay} theme={theme} sceneStartFrame={0} y={l.overlayY} />
            </SceneLayer>
          </Sequence>
        );
      })}
      {presenter &&
        spans.map((sp, i) => (
          <Presenter key={i} presenter={presenter} theme={theme} rect={layout.presenter} visibleFrom={sp.from} visibleTo={sp.to} motion={preset.visual.camera_motion} />
        ))}
      <Captions track={captions} preset={preset} theme={theme} centerY={layout.captionY} width={width} />
      {narration.src && <Audio src={staticFile(narration.src)} />}
      {music?.src && <Audio src={staticFile(music.src)} volume={Math.pow(10, music.volume_db / 20)} loop />}
      <div style={{ position: "absolute", right: 36, top: 40, color: theme.muted, fontFamily: "Inter, Arial, sans-serif", fontSize: 22, fontWeight: 600, opacity: 0.7 }}>{props.topic}</div>
    </AbsoluteFill>
  );
};

// Rendered inside a <Sequence>, so useCurrentFrame() is already scene-relative.
const SceneLayer: React.FC<{ children: React.ReactNode; transition: "cut" | "slide" | "fade" | "zoom"; fps: number; frames: number }> = ({ children, transition, fps, frames }) => {
  const local = useCurrentFrame();
  const d = Math.min(Math.round(fps * 0.3), Math.floor(frames / 2));
  const p = transition === "cut" ? 1 : interpolate(local, [0, d], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const style: React.CSSProperties =
    transition === "slide"
      ? { transform: `translateX(${(1 - p) * 120}px)`, opacity: p }
      : transition === "zoom"
        ? { transform: `scale(${0.92 + p * 0.08})`, opacity: p }
        : transition === "fade"
          ? { opacity: p }
          : {};
  return <AbsoluteFill style={style}>{children}</AbsoluteFill>;
};
