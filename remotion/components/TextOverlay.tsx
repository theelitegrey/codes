import React from "react";
import { interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import type { Theme } from "../theme.js";

export const TextOverlay: React.FC<{ text: string; theme: Theme; sceneStartFrame: number; y: number }> = ({ text, theme, sceneStartFrame, y }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  if (!text) return null;
  const local = frame - sceneStartFrame;
  const w = interpolate(local, [0, Math.round(fps * 0.3)], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <div style={{ position: "absolute", left: 48, top: y, transform: `scaleX(${w})`, transformOrigin: "left", background: theme.accent, color: "#0B0B0B", fontFamily: "Inter, Arial, sans-serif", fontWeight: 900, fontSize: 30, letterSpacing: 2, padding: "10px 20px", borderRadius: 10, textTransform: "uppercase" }}>
      {text}
    </div>
  );
};
