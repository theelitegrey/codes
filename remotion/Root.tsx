import React from "react";
import { z } from "zod";
import { Composition } from "remotion";
import { ShortComposition } from "./ShortComposition.js";
import { ShortProps } from "./props.js";
import { BUILTIN_PRESETS } from "../src/presets/schema.js";
import { MotionPreview } from "./motion/MotionStage.js";
import { MotionPreviewProps } from "./motion/schema.js";
import { ComposedShort } from "./composition/ComposedShort.js";
import { MasterTimeline } from "./composition/schema.js";

const demoPreset = BUILTIN_PRESETS.PODCAST_SHORT;

const demoProps: ShortProps = {
  preset: demoPreset,
  topic: "Demo",
  scenes: [
    { scene_id: 1, duration: 4, start_time: 0, narration: "Liquidity sweeps are not random. They are engineered.", presenter: { enabled: true, position: "bottom", size: "medium", height_fraction: 0.45 }, main_visual: { type: "headline", headline: "Liquidity sweeps", subheadline: "Why price hunts stops", motion: "slow_zoom" }, text_overlay: "ENGINEERED", caption: "", music: "", sound_effect: "whoosh" },
    { scene_id: 2, duration: 5, start_time: 4, narration: "Price runs above the old high, grabs the stops, then reverses.", presenter: { enabled: true, position: "bottom", size: "medium", height_fraction: 0.4 }, main_visual: { type: "chart", motion: "none", chart: { kind: "candlestick", title: "NQ 5m (illustrative)", series: Array.from({ length: 30 }, (_, i) => { const b = 100 + Math.sin(i / 4) * 3 + (i > 20 ? -4 : 0) + (i === 20 ? 6 : 0); return [b, b + 1.5, b - 1.5, b + (i % 2 ? 0.8 : -0.8)] as [number, number, number, number]; }), annotations: [{ index: 20, label: "sweep", level: 108, color: "#FF5A5A" }], animate: true } }, text_overlay: "STOP HUNT", caption: "", music: "", sound_effect: "" },
    { scene_id: 3, duration: 4, start_time: 9, narration: "Wait for the reclaim before you act.", presenter: { enabled: false, position: "bottom", size: "medium" }, main_visual: { type: "broll", prompt: "trader watching screens", motion: "push_in" }, text_overlay: "WAIT FOR THE RECLAIM", caption: "", music: "", sound_effect: "" },
  ],
  narration: { src: "", duration_sec: 13 },
  assets: {},
  captions: { source: "estimated", words: [] },
};

const demoMotion: MotionPreviewProps = {
  from: 0,
  to: 6,
  plan: {
    width: 1080,
    height: 1080,
    fps: 30,
    theme: { bg: "#0B0E14", fg: "#F4F6FA", muted: "#8A93A6", accent: "#4F8CFF", up: "#22D3A5", down: "#FF5A5A", warn: "#FFD84D", font: "Inter, Arial, sans-serif", mono: "JetBrains Mono, Menlo, monospace" },
    beats: [{ beat_id: "demo", start: 0, end: 6, concept: "sweep", transition_in: "fade", layers: [{ id: "l1", kind: "LiquiditySweep", start: 0, end: 6, rect: { x: 0, y: 0, w: 1, h: 1 }, z: 0, level_label: "PREVIOUS HIGH", sweep_label: "SWEEP", direction: "high", reversal_label: "REVERSAL", stages: { approach: 0.25, break: 0.4, wick: 0.5, label: 0.6, reverse: 0.85 } }] }],
  },
};

const ComposedProps = z.object({ timeline: MasterTimeline });
const demoTimeline: z.infer<typeof ComposedProps> = {
  timeline: { width: 1080, height: 1920, fps: 30, duration: 3, audio_src: "", theme: demoMotion.plan.theme, scenes: [{ scene: 1, beat_id: "demo", start: 0, end: 3, duration: 3, transition_in: "cut", reserved: [], caption_rect: null, layers: [{ id: "bg", type: "background", z: 0, start: 0, end: 3, rect: { x: 0, y: 0, w: 1080, h: 1920 }, style: "clean_dark", accent: "#4F8CFF", motion: "subtle" }] }], events: [] },
};

export const Root: React.FC = () => (
  <>
  <Composition
    id="ComposedShort"
    component={ComposedShort}
    schema={ComposedProps}
    defaultProps={demoTimeline}
    width={1080}
    height={1920}
    fps={30}
    durationInFrames={90}
    calculateMetadata={({ props }) => {
      const p = props as z.infer<typeof ComposedProps>;
      return { width: p.timeline.width, height: p.timeline.height, fps: p.timeline.fps, durationInFrames: Math.max(1, Math.ceil(p.timeline.duration * p.timeline.fps)) };
    }}
  />
  <Composition
    id="MotionPreview"
    component={MotionPreview}
    schema={MotionPreviewProps}
    defaultProps={demoMotion}
    width={1080}
    height={1080}
    fps={30}
    durationInFrames={180}
    calculateMetadata={({ props }) => {
      const p = props as MotionPreviewProps;
      return { width: p.plan.width, height: p.plan.height, fps: p.plan.fps, durationInFrames: Math.max(1, Math.ceil((p.to - p.from) * p.plan.fps)) };
    }}
  />
  <Composition
    id="Short"
    component={ShortComposition}
    schema={ShortProps}
    defaultProps={demoProps}
    width={demoPreset.width}
    height={demoPreset.height}
    fps={demoPreset.fps}
    durationInFrames={Math.ceil(13 * demoPreset.fps)}
    calculateMetadata={({ props }) => {
      const p = props as ShortProps;
      const total = p.scenes.reduce((a, s) => Math.max(a, (s.start_time ?? 0) + s.duration), p.narration.duration_sec);
      return { width: p.preset.width, height: p.preset.height, fps: p.preset.fps, durationInFrames: Math.max(1, Math.ceil(total * p.preset.fps)) };
    }}
  />
  </>
);
