import React from "react";
import { useCurrentFrame, useVideoConfig } from "remotion";
import type { CaptionTrack } from "../../src/core/scene.js";
import type { ModePreset } from "../../src/presets/schema.js";
import type { Theme } from "../theme.js";

interface Props {
  track: CaptionTrack;
  preset: ModePreset;
  theme: Theme;
  /** Vertical centre (px) where captions should sit for the current scene. */
  centerY: number;
  width: number;
}

/** Dynamic word-highlight captions grouped into 3–5 word chunks. */
export const Captions: React.FC<Props> = ({ track, preset, theme, centerY, width }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  if (!track.words.length) return null;
  const chunkSize = preset.captions.style === "minimal" ? 6 : 4;
  const idx = track.words.findIndex((w) => t >= w.start && t < w.end + 0.08);
  const active = idx >= 0 ? idx : track.words.findIndex((w) => w.start > t) - 1;
  if (active < 0 || active >= track.words.length) return null;
  const chunkStart = Math.floor(active / chunkSize) * chunkSize;
  const chunk = track.words.slice(chunkStart, chunkStart + chunkSize);
  const style = preset.captions;
  const fontSize = style.style === "minimal" ? 44 : 60;
  return (
    <div style={{ position: "absolute", left: 40, right: 40, top: centerY - fontSize, display: "flex", flexWrap: "wrap", justifyContent: "center", gap: "0 18px", width: width - 80 }}>
      {chunk.map((w, i) => {
        const isActive = chunkStart + i === active;
        const highlight = style.style === "line" ? false : isActive;
        return (
          <span
            key={i}
            style={{
              fontFamily: style.font_family,
              fontWeight: style.font_weight,
              fontSize,
              lineHeight: 1.15,
              color: highlight ? "#0B0B0B" : theme.fg,
              background: highlight ? style.highlight_color : "transparent",
              padding: highlight ? "2px 14px" : "2px 0",
              borderRadius: 14,
              textShadow: highlight ? "none" : "0 4px 18px rgba(0,0,0,0.6)",
              transform: highlight && style.style === "dynamic_word" ? "scale(1.08)" : "none",
              textTransform: style.style === "karaoke" ? "uppercase" : "none",
            }}
          >
            {w.word}
          </span>
        );
      })}
    </div>
  );
};
