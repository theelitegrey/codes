import type { Scene } from "../src/core/scene.js";
import type { ModePreset } from "../src/presets/schema.js";

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Layout {
  main: Rect;
  presenter: Rect;
  captionY: number;
  overlayY: number;
}

const SIZE_FRACTION: Record<Scene["presenter"]["size"], number> = { small: 0.32, medium: 0.42, large: 0.5, full: 1 };

/**
 * Computes where the main visual and the presenter go for a scene. Default
 * podcast layout: presenter panel in the lower 35–50% of the 9:16 frame,
 * main visual above it, captions on the boundary.
 */
export function layoutFor(scene: Scene, preset: ModePreset, width: number, height: number, presenterAvailable: boolean): Layout {
  const enabled = presenterAvailable && scene.presenter.enabled;
  const frac = scene.presenter.height_fraction ?? SIZE_FRACTION[scene.presenter.size] ?? preset.presenter.height_fraction;
  const safeTop = 120;
  const safeBottom = 140; // keep clear of the Shorts UI (like/comment column and title)

  if (!enabled) {
    const main = { x: 0, y: safeTop, w: width, h: height - safeTop - safeBottom };
    return { main, presenter: { x: 0, y: height, w: width, h: 0 }, captionY: height * 0.72, overlayY: safeTop + 24 };
  }

  const pos = scene.presenter.position;
  if (pos === "center" || scene.presenter.size === "full") {
    const presenter = { x: 0, y: 0, w: width, h: height };
    const main = { x: 60, y: safeTop, w: width - 120, h: Math.round(height * 0.34) };
    return { main, presenter, captionY: height * 0.74, overlayY: safeTop + 24 };
  }
  if (pos === "pip") {
    const pw = Math.round(width * 0.42);
    const ph = Math.round(pw * 1.1);
    const presenter = { x: width - pw - 40, y: height - safeBottom - ph - 20, w: pw, h: ph };
    const main = { x: 0, y: safeTop, w: width, h: height - safeTop - safeBottom };
    return { main, presenter, captionY: height * 0.6, overlayY: safeTop + 24 };
  }
  if (pos === "left" || pos === "right") {
    const pw = Math.round(width * 0.5);
    const presenter = { x: pos === "left" ? 0 : width - pw, y: Math.round(height * 0.5), w: pw, h: Math.round(height * 0.5) - safeBottom };
    const main = { x: 0, y: safeTop, w: width, h: Math.round(height * 0.5) - safeTop };
    return { main, presenter, captionY: height * 0.5 - 20, overlayY: safeTop + 24 };
  }
  // top / bottom (default)
  const ph = Math.round(height * frac);
  if (pos === "top") {
    const presenter = { x: 0, y: 0, w: width, h: ph };
    const main = { x: 0, y: ph, w: width, h: height - ph - safeBottom };
    return { main, presenter, captionY: ph + 60, overlayY: ph + 24 };
  }
  const presenter = { x: 0, y: height - ph, w: width, h: ph };
  const main = { x: 0, y: safeTop, w: width, h: height - ph - safeTop };
  const captionY = preset.captions.position === "center" ? height * 0.5 : preset.captions.position === "top" ? safeTop + 80 : preset.captions.position === "lower_third" ? height - ph + 90 : height - ph - 30;
  return { main, presenter, captionY, overlayY: safeTop + 24 };
}
