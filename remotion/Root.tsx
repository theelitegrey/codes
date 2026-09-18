import React from "react";
import { Composition } from "remotion";
import { ShortComposition } from "./ShortComposition.js";
import { ShortProps } from "./props.js";
import { BUILTIN_PRESETS } from "../src/presets/schema.js";

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

export const Root: React.FC = () => (
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
);
