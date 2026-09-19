import path from "node:path";
import { ensureDir, probe, run } from "./ffmpeg.js";

export interface PresenterOverlayOptions {
  /** Silent motion-graphics layer, 1080x1920. */
  graphics: string;
  /** Presenter clip with an alpha channel (HeyGen webm) — also supplies the audio. */
  presenter: string;
  out: string;
  /** Fraction of frame height reserved for the presenter, matching the promo layout. */
  presenterFraction?: number;
  /** Horizontal crop centre of the presenter source, 0..1. */
  focusX?: number;
  /** Extra scale applied after fitting, so the subject can be pushed past the band edges. */
  zoom?: number;
  crf?: number;
  onLine?: (l: string) => void;
}

/**
 * Overlays an alpha presenter clip onto the promo's reserved lower band and
 * takes the master audio from the presenter clip.
 *
 * The presenter is scaled so it covers the band (cover, not contain), cropped
 * to the band, and anchored to the bottom edge. Anything the crop drops is
 * chosen with `focusX`, because HeyGen returns the subject centred in a square
 * frame while the band is much wider than it is tall.
 */
export async function overlayPresenter(o: PresenterOverlayOptions): Promise<string> {
  const g = await probe(o.graphics);
  const p = await probe(o.presenter);
  if (!g.width || !g.height) throw new Error(`cannot read dimensions of ${o.graphics}`);
  if (!p.width || !p.height) throw new Error(`cannot read dimensions of ${o.presenter}`);
  if (!p.has_audio) throw new Error(`${o.presenter} carries no audio track; the narration must come from the presenter clip`);

  const W = g.width;
  const H = g.height;
  const fraction = o.presenterFraction ?? 0.46;
  const bandH = Math.round(H * fraction);
  const zoom = o.zoom ?? 1;
  const focusX = Math.min(1, Math.max(0, o.focusX ?? 0.5));

  // Cover the band, then crop back to it.
  const scale = Math.max(W / p.width, bandH / p.height) * zoom;
  const sw = Math.round((p.width * scale) / 2) * 2;
  const sh = Math.round((p.height * scale) / 2) * 2;
  const cropX = Math.round(Math.min(Math.max(0, (sw - W) * focusX), Math.max(0, sw - W)));
  // Keep the head: crop the band off the TOP of the scaled clip, not the middle.
  const cropY = Math.max(0, sh - bandH);

  const filter = [
    `[1:v]scale=${sw}:${sh}:flags=lanczos,crop=${W}:${Math.min(bandH, sh)}:${cropX}:${cropY},format=yuva420p[p]`,
    `[0:v][p]overlay=0:${H - Math.min(bandH, sh)}:format=auto:shortest=0[v]`,
  ].join(";");

  ensureDir(path.dirname(o.out));
  await run(
    "ffmpeg",
    [
      "-nostdin", "-y",
      "-i", o.graphics,
      "-c:v", "libvpx-vp9", "-i", o.presenter,
      "-filter_complex", filter,
      "-map", "[v]", "-map", "1:a",
      "-c:v", "libx264", "-preset", "slow", "-crf", String(o.crf ?? 18),
      "-pix_fmt", "yuv420p", "-profile:v", "high", "-level", "4.2",
      "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2",
      "-movflags", "+faststart",
      o.out,
    ],
    { onLine: o.onLine },
  );
  return o.out;
}
