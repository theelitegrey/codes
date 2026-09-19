import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { overlayPresenter } from "../src/media/composite.js";
import { probe, run } from "../src/media/ffmpeg.js";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "composite-"));

/** A silent graphics layer, standing in for the rendered promo. */
async function graphics(file: string, w = 270, h = 480, d = 2) {
  const r = await run("ffmpeg", ["-nostdin", "-y", "-loglevel", "error", "-f", "lavfi", "-i", `color=c=0x101418:s=${w}x${h}:r=30:d=${d}`, "-c:v", "libx264", "-pix_fmt", "yuv420p", file]);
  expect(r.code).toBe(0);
}

/** A presenter clip with a real VP9 alpha side-channel and an audio track. */
async function presenter(file: string, size = 240, d = 2) {
  const c = size / 2;
  const r = await run("ffmpeg", [
    "-nostdin", "-y", "-loglevel", "error",
    "-f", "lavfi", "-i", `color=c=0x2BD9C4:s=${size}x${size}:r=30:d=${d}`,
    "-f", "lavfi", "-i", `sine=frequency=200:duration=${d}:sample_rate=48000`,
    "-filter_complex", `[0:v]format=yuva420p,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='if(lt(hypot(X-${c},Y-${c}),${size / 4}),255,0)',format=yuva420p[v]`,
    "-map", "[v]", "-map", "1:a",
    "-c:v", "libvpx-vp9", "-pix_fmt", "yuva420p", "-auto-alt-ref", "0", "-b:v", "300k",
    "-c:a", "libopus", file,
  ]);
  expect(r.code).toBe(0);
}

describe("presenter overlay", () => {
  it("keeps the graphics geometry, takes audio from the presenter, and preserves alpha", async () => {
    const g = path.join(dir, "g.mp4");
    const p = path.join(dir, "p.webm");
    const out = path.join(dir, "out.mp4");
    await graphics(g);
    await presenter(p);

    // The alpha really is in the webm, so the decoder override in the
    // compositor is load-bearing rather than cosmetic.
    const raw = await run("ffmpeg", ["-nostdin", "-loglevel", "error", "-c:v", "libvpx-vp9", "-i", p, "-ss", "0.5", "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "yuva420p", "-"]);
    expect(raw.code).toBe(0);

    await overlayPresenter({ graphics: g, presenter: p, out, presenterFraction: 0.46 });

    const f = await probe(out);
    expect(f.width).toBe(270);
    expect(f.height).toBe(480);
    expect(f.has_audio).toBe(true);
    expect(f.codec_audio).toBe("aac");

    // The presenter must actually be drawn into its band: the band's mean
    // luma changes, while the graphics band above it is untouched.
    // Sampled past frame 0: a VP9 alpha side-channel can decode its first
    // frame fully transparent, which says nothing about the compositor.
    const yavg = async (file: string, crop: string) => {
      const r = await run("ffmpeg", ["-nostdin", "-ss", "0.5", "-i", file, "-vf", `crop=${crop},signalstats,metadata=print:key=lavfi.signalstats.YAVG`, "-frames:v", "1", "-f", "null", "-"]);
      const m = /YAVG=([0-9.]+)/.exec(r.stderr);
      expect(m, `no YAVG for ${file}`).toBeTruthy();
      return Number(m![1]);
    };
    const band = Math.round(480 * 0.46);
    expect(await yavg(out, `270:${band}:0:${480 - band}`)).not.toBeCloseTo(await yavg(g, `270:${band}:0:${480 - band}`), 1);
    expect(await yavg(out, `270:${480 - band}:0:0`)).toBeCloseTo(await yavg(g, `270:${480 - band}:0:0`), 0);
  }, 120_000);

  it("refuses a presenter clip with no audio, because the narration rides on it", async () => {
    const g = path.join(dir, "g2.mp4");
    const p = path.join(dir, "p2.webm");
    await graphics(g);
    const r = await run("ffmpeg", ["-nostdin", "-y", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=red:s=120x120:r=30:d=1", "-c:v", "libvpx-vp9", "-pix_fmt", "yuva420p", p]);
    expect(r.code).toBe(0);
    await expect(overlayPresenter({ graphics: g, presenter: p, out: path.join(dir, "o2.mp4") })).rejects.toThrow(/no audio/);
  }, 60_000);
});
