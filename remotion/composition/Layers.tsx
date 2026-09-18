import React from "react";
import { AbsoluteFill, Img, OffthreadVideo, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import type { Layer, SceneLayout } from "./schema.js";
import type { MotionTheme } from "../motion/schema.js";
import { BeatStage } from "../motion/MotionStage.js";
import { CaptionsView } from "./Captions.js";
import { TextElementView } from "./TextElements.js";
import { prog, easeOut, fadeInOut } from "../motion/util.js";

const BG: Record<string, { a: string; b: string; grid: boolean; grain: boolean }> = {
  clean_dark: { a: "#0E1016", b: "#1B1F2A", grid: true, grain: false },
  clean_light: { a: "#F7F7F5", b: "#E4E6EE", grid: false, grain: false },
  gradient: { a: "#141A33", b: "#3A1C5C", grid: false, grain: false },
  studio: { a: "#15161A", b: "#2A2C33", grid: false, grain: false },
  cinematic_grain: { a: "#0B0A0A", b: "#1E1714", grid: false, grain: true },
  newsroom: { a: "#0C1730", b: "#1A2C55", grid: true, grain: false },
  terminal: { a: "#07100E", b: "#0E1F1A", grid: true, grain: false },
};

export const LayerView: React.FC<{ layer: Layer; scene: SceneLayout; theme: MotionTheme; t: number; width: number; height: number }> = ({ layer, scene, theme, t, width, height }) => {
  const { fps } = useVideoConfig();
  if (t < layer.start || t > layer.end) return null;
  const r = layer.rect;
  switch (layer.type) {
    case "background": {
      const c = BG[layer.style] ?? BG.clean_dark;
      const drift = layer.motion === "none" ? 0 : (t * (layer.motion === "dynamic" ? 6 : 2)) % 60;
      return (
        <AbsoluteFill style={{ zIndex: layer.z, background: `radial-gradient(120% 80% at ${50 + drift * 0.3}% ${30 + drift * 0.2}%, ${c.b} 0%, ${c.a} 70%)` }}>
          {c.grid && <AbsoluteFill style={{ backgroundImage: `linear-gradient(${layer.accent}12 1px, transparent 1px), linear-gradient(90deg, ${layer.accent}12 1px, transparent 1px)`, backgroundSize: "90px 90px", opacity: 0.35, transform: `translate(${-drift}px, ${-drift * 0.6}px)` }} />}
          {c.grain && <AbsoluteFill style={{ opacity: 0.08, backgroundImage: "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='120' height='120'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2'/></filter><rect width='120' height='120' filter='url(%23n)' opacity='0.6'/></svg>\")" }} />}
        </AbsoluteFill>
      );
    }
    case "illustration": {
      const p = (t - layer.start) / Math.max(0.01, layer.end - layer.start);
      const scale = layer.motion === "slow_zoom" ? 1 + p * 0.06 : layer.motion === "push_in" ? 1 + p * 0.12 : 1;
      const tx = layer.motion === "pan_left" ? -p * 40 : layer.motion === "pan_right" ? p * 40 : 0;
      const a = fadeInOut(t, layer.start, layer.end, 0.25);
      const mask = layer.mask === "fade_bottom" ? "linear-gradient(180deg, black 60%, transparent 100%)" : undefined;
      const media: React.CSSProperties = { width: "100%", height: "100%", objectFit: layer.fit, transform: `translateX(${tx}px) scale(${scale})`, transformOrigin: "50% 50%" };
      return (
        <div style={{ position: "absolute", left: r.x, top: r.y, width: r.w, height: r.h, zIndex: layer.z, overflow: "hidden", opacity: a, borderRadius: layer.mask === "rounded" ? 28 : 0, WebkitMaskImage: mask, maskImage: mask }}>
          {layer.kind === "video" ? <OffthreadVideo src={staticFile(layer.src)} muted style={media} /> : <Img src={staticFile(layer.src)} style={media} />}
        </div>
      );
    }
    case "motion":
      return (
        <div style={{ position: "absolute", left: r.x, top: r.y, width: r.w, height: r.h, zIndex: layer.z, overflow: "hidden" }}>
          <BeatStage beat={layer.beat} theme={theme} t={t} width={r.w} height={r.h} />
        </div>
      );
    case "presenter": {
      const inDur = 0.35;
      const enter = layer.transition === "none" ? 1 : easeOut(prog(t, layer.start, layer.start + inDur));
      const exit = layer.transition === "none" ? 1 : 1 - easeOut(prog(t, layer.end - inDur, layer.end));
      const vis = Math.min(enter, exit);
      const breathe = 1 + Math.sin(t / 2.2) * 0.006;
      const mask = layer.feather_px > 0 ? `linear-gradient(180deg, transparent 0px, black ${layer.feather_px}px, black 100%)` : undefined;
      return (
        <div style={{ position: "absolute", left: r.x, top: r.y + (layer.transition === "slide_up" ? (1 - vis) * 80 : 0), width: r.w, height: r.h, zIndex: layer.z, opacity: vis, overflow: "hidden", WebkitMaskImage: mask, maskImage: mask }}>
          <OffthreadVideo
            src={staticFile(layer.src)}
            muted
            transparent={layer.alpha}
            startFrom={Math.round(0)}
            style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: layer.focal, transform: `scale(${layer.scale_boost * breathe})`, transformOrigin: "50% 30%", filter: layer.alpha ? undefined : "contrast(1.04) saturate(1.05) brightness(0.98)" }}
          />
          {layer.vignette && !layer.alpha && <div style={{ position: "absolute", inset: 0, background: "radial-gradient(120% 90% at 50% 40%, transparent 55%, rgba(0,0,0,0.75) 100%)" }} />}
          {layer.alpha && <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: r.h * 0.22, background: "linear-gradient(180deg, transparent, rgba(0,0,0,0.45))", pointerEvents: "none" }} />}
        </div>
      );
    }
    case "text":
      return (
        <div style={{ position: "absolute", inset: 0, zIndex: layer.z }}>
          <TextElementView element={layer.element} rect={r} theme={theme} fontScale={layer.font_scale} />
        </div>
      );
    case "caption":
      return (
        <div style={{ position: "absolute", inset: 0, zIndex: layer.z }}>
          <CaptionsView cues={layer.cues} style={layer.style} rect={r} accent={theme.accent} />
        </div>
      );
    case "effect": {
      const p = prog(t, layer.start, layer.end);
      if (layer.effect === "flash") return <AbsoluteFill style={{ zIndex: layer.z, background: "#fff", opacity: (1 - p) * layer.intensity * 0.6 }} />;
      if (layer.effect === "vignette_pulse") return <AbsoluteFill style={{ zIndex: layer.z, background: `radial-gradient(70% 60% at 50% 50%, transparent 55%, rgba(0,0,0,${(0.4 + 0.3 * Math.sin(t * 6)) * layer.intensity}) 100%)` }} />;
      return null;
    }
  }
  void fps; void width; void height; void scene;
  return null;
};
