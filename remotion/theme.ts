import type { ModePreset } from "../src/presets/schema.js";

export interface Theme {
  bg: string;
  bg2: string;
  fg: string;
  muted: string;
  accent: string;
  panel: string;
  grain: boolean;
}

export function themeFor(p: ModePreset): Theme {
  const accent = p.visual.accent_color;
  switch (p.visual.background) {
    case "clean_light":
      return { bg: "#F7F7F5", bg2: "#E9EAF0", fg: "#111318", muted: "#5B6170", accent, panel: "rgba(255,255,255,0.7)", grain: false };
    case "gradient":
      return { bg: "#141A33", bg2: "#3A1C5C", fg: "#FFFFFF", muted: "#C9CBD9", accent, panel: "rgba(255,255,255,0.08)", grain: false };
    case "studio":
      return { bg: "#15161A", bg2: "#2A2C33", fg: "#FFFFFF", muted: "#A9ADB8", accent, panel: "rgba(255,255,255,0.06)", grain: false };
    case "cinematic_grain":
      return { bg: "#0B0A0A", bg2: "#1E1714", fg: "#F3EEE6", muted: "#B8AFA3", accent, panel: "rgba(255,255,255,0.05)", grain: true };
    case "newsroom":
      return { bg: "#0C1730", bg2: "#1A2C55", fg: "#FFFFFF", muted: "#B7C2DE", accent, panel: "rgba(255,255,255,0.08)", grain: false };
    case "terminal":
      return { bg: "#07100E", bg2: "#0E1F1A", fg: "#E8FFF7", muted: "#7FA898", accent, panel: "rgba(34,211,165,0.06)", grain: false };
    case "clean_dark":
    default:
      return { bg: "#0E1016", bg2: "#1B1F2A", fg: "#FFFFFF", muted: "#A0A6B5", accent, panel: "rgba(255,255,255,0.06)", grain: false };
  }
}
