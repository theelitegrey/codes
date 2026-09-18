import React from "react";
import { AbsoluteFill, OffthreadVideo, interpolate, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import type { ShortProps } from "../props.js";
import type { Theme } from "../theme.js";

interface Props {
  presenter: NonNullable<ShortProps["presenter"]>;
  theme: Theme;
  /** Panel rectangle in composition pixels. */
  rect: { x: number; y: number; w: number; h: number };
  /** Frame at which the presenter becomes visible / hidden (for slide-in/out). */
  visibleFrom: number;
  visibleTo: number;
  /** Scene-level subtle motion. */
  motion: "none" | "subtle" | "dynamic";
}

/**
 * The speaking presenter. The avatar video is landscape (LongCat outputs
 * 832x480 / 1280x768); we crop it to the panel using object-fit cover with a
 * face-weighted focal point, feather the top edge into the scene, add a soft
 * vignette and a mild colour grade so it reads as part of the composition
 * rather than a pasted cutout. Playback stays in sync with the narration
 * because the avatar was generated from that same audio (frame offset 0).
 */
export const Presenter: React.FC<Props> = ({ presenter, theme, rect, visibleFrom, visibleTo, motion }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const inDur = Math.round(fps * 0.35);
  const enter = interpolate(frame, [visibleFrom, visibleFrom + inDur], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const exit = interpolate(frame, [visibleTo - inDur, visibleTo], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const vis = Math.min(enter, exit);
  if (vis <= 0) return null;
  const breathe = motion === "none" ? 1 : 1 + Math.sin(frame / (fps * 2.2)) * (motion === "dynamic" ? 0.012 : 0.006);
  const focal = presenter.crop === "face_weighted" ? "50% 22%" : "50% 50%";
  const feather = presenter.feather_px;
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <div
        style={{
          position: "absolute",
          left: rect.x,
          top: rect.y + (1 - vis) * 80,
          width: rect.w,
          height: rect.h,
          opacity: vis,
          overflow: "hidden",
          WebkitMaskImage: `linear-gradient(180deg, transparent 0px, black ${feather}px, black calc(100% - ${Math.round(feather / 3)}px), black 100%)`,
          maskImage: `linear-gradient(180deg, transparent 0px, black ${feather}px, black 100%)`,
        }}
      >
        <OffthreadVideo
          src={staticFile(presenter.src)}
          muted
          style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: focal, transform: `scale(${breathe})`, transformOrigin: "50% 30%", filter: presenter.color_grade ? "contrast(1.04) saturate(1.05) brightness(0.98)" : undefined }}
        />
        {presenter.vignette && <div style={{ position: "absolute", inset: 0, background: `radial-gradient(120% 90% at 50% 40%, transparent 55%, ${theme.bg}CC 100%)` }} />}
        <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 4, background: theme.accent, opacity: 0.6 }} />
      </div>
    </AbsoluteFill>
  );
};
