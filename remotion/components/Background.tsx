import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import type { Theme } from "../theme.js";

export const Background: React.FC<{ theme: Theme; motion: "none" | "subtle" | "dynamic" }> = ({ theme, motion }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const drift = motion === "none" ? 0 : interpolate(frame, [0, durationInFrames], [0, motion === "dynamic" ? 24 : 8]);
  return (
    <AbsoluteFill style={{ background: `radial-gradient(120% 80% at ${50 + drift * 0.4}% ${30 + drift * 0.3}%, ${theme.bg2} 0%, ${theme.bg} 70%)` }}>
      <AbsoluteFill style={{ backgroundImage: `linear-gradient(${theme.accent}14 1px, transparent 1px), linear-gradient(90deg, ${theme.accent}14 1px, transparent 1px)`, backgroundSize: "90px 90px", opacity: 0.35, transform: `translate(${-drift}px, ${-drift * 0.6}px)` }} />
      {theme.grain && <AbsoluteFill style={{ opacity: 0.08, backgroundImage: "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='120' height='120'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2'/></filter><rect width='120' height='120' filter='url(%23n)' opacity='0.6'/></svg>\")" }} />}
    </AbsoluteFill>
  );
};
