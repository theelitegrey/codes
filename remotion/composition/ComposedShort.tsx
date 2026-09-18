import React from "react";
import { AbsoluteFill, Audio, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import type { Layer, MasterTimeline, SceneLayout } from "./schema.js";
import { LayerView } from "./Layers.js";
import { prog, easeOut } from "../motion/util.js";

/** Renders the Composer's master timeline: every scene's z-ordered layers on one clock. */
export const ComposedShort: React.FC<{ timeline: MasterTimeline }> = ({ timeline }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const t = frame / fps;
  // Presenter/caption layers can span scenes; render all scene layers whose window contains t.
  return (
    <AbsoluteFill style={{ backgroundColor: timeline.theme.bg }}>
      {timeline.scenes.map((scene) => (
        <SceneView key={scene.scene} scene={scene} timeline={timeline} t={t} width={width} height={height} />
      ))}
      {timeline.audio_src && <Audio src={staticFile(timeline.audio_src)} />}
    </AbsoluteFill>
  );
};

const SceneView: React.FC<{ scene: SceneLayout; timeline: MasterTimeline; t: number; width: number; height: number }> = ({ scene, timeline, t, width, height }) => {
  const active = t >= scene.start && t < scene.end + 0.001;
  const p = scene.transition_in === "cut" ? 1 : easeOut(prog(t, scene.start, scene.start + 0.3));
  const style: React.CSSProperties =
    scene.transition_in === "fade" ? { opacity: p } : scene.transition_in === "slide_left" ? { opacity: p, transform: `translateX(${(1 - p) * 100}px)` } : scene.transition_in === "slide_up" ? { opacity: p, transform: `translateY(${(1 - p) * 60}px)` } : scene.transition_in === "zoom" ? { opacity: p, transform: `scale(${0.94 + 0.06 * p})` } : {};
  const sorted: Layer[] = [...scene.layers].sort((a, b) => a.z - b.z);
  // Layers that persist across scenes (presenter, captions, background) are not subject to the scene transition.
  const isPersistent = (l: Layer) => l.type === "presenter" || l.type === "caption" || l.type === "background";
  const persistent: Layer[] = sorted.filter(isPersistent);
  const scoped: Layer[] = sorted.filter((l) => !isPersistent(l));
  return (
    <>
      {persistent.map((l) => (
        <LayerView key={l.id} layer={l} scene={scene} theme={timeline.theme} t={t} width={width} height={height} />
      ))}
      {active && (
        <AbsoluteFill style={{ ...style, pointerEvents: "none" }}>
          {scoped.map((l) => (
            <LayerView key={l.id} layer={l} scene={scene} theme={timeline.theme} t={t} width={width} height={height} />
          ))}
        </AbsoluteFill>
      )}
    </>
  );
};
