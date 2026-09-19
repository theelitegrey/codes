/**
 * Downloads the HeyGen presenter clip and composites the finished Stryker promo.
 *
 *   npx tsx scripts/stryker-finalize.ts                  # uses HEYGEN_VIDEO_ID from .env
 *   npx tsx scripts/stryker-finalize.ts <video_id>
 *   npx tsx scripts/stryker-finalize.ts ./richard.webm   # skip the download
 *
 * Needs HEYGEN_API_KEY and network access to HeyGen. Renders the graphics
 * layer first if it is missing.
 */
import fs from "node:fs";
import path from "node:path";
import { loadDotEnv } from "../src/core/env.js";
import { HeyGenClient } from "../src/providers/heygen/client.js";
import { overlayPresenter } from "../src/media/composite.js";
import { probe } from "../src/media/ffmpeg.js";

loadDotEnv();

const out = path.resolve("output/stryker");
const graphics = path.join(out, "stryker-graphics.mp4");
const final = path.join(out, "stryker-final.mp4");
const arg = process.argv[2];

async function presenterFile(): Promise<string> {
  if (arg && fs.existsSync(arg)) return path.resolve(arg);

  const videoId = arg ?? process.env.HEYGEN_VIDEO_ID;
  if (!videoId) throw new Error("pass a HeyGen video id or a local presenter file, or set HEYGEN_VIDEO_ID");

  const key = process.env.HEYGEN_API_KEY;
  if (!key) throw new Error("HEYGEN_API_KEY is not set — see .env.example");

  const client = new HeyGenClient({ apiKey: key });
  console.log(`[finalize] polling HeyGen video ${videoId}`);
  const status = await client.waitForVideo(videoId, { onStatus: (s) => console.log(`[finalize] status: ${s}`) });
  if (!status.video_url) throw new Error(`HeyGen video ${videoId} completed without a video_url`);

  const ext = status.video_url.includes(".webm") ? "webm" : "mp4";
  const dest = path.join(out, `presenter.${ext}`);
  console.log(`[finalize] downloading presenter → ${dest}`);
  await client.download(status.video_url, dest);
  return dest;
}

async function main() {
  if (!fs.existsSync(graphics)) {
    console.log("[finalize] graphics layer missing — rendering it first");
    await import("./stryker-promo.js" as string).catch(() => {
      throw new Error("run `npx tsx scripts/stryker-promo.ts` first to render the graphics layer");
    });
  }

  const presenter = await presenterFile();
  const p = await probe(presenter);
  console.log(`[finalize] presenter ${p.width}x${p.height} ${p.duration_sec.toFixed(2)}s codec=${p.codec_video} audio=${p.codec_audio ?? "none"}`);
  if (p.codec_video !== "vp8" && p.codec_video !== "vp9") {
    console.warn(`[finalize] warning: ${p.codec_video} is unlikely to carry an alpha channel — request output_format "webm" from HeyGen`);
  }

  await overlayPresenter({
    graphics,
    presenter,
    out: final,
    presenterFraction: 0.46,
    focusX: 0.5,
    zoom: 1.04,
    onLine: (l) => { if (/frame=|error|Error/.test(l)) process.stdout.write(`\r[ffmpeg] ${l.trim().slice(0, 110)}   `); },
  });

  const f = await probe(final);
  console.log(`\n[finalize] ${final}`);
  console.log(`[finalize] ${f.width}x${f.height} @ ${f.fps?.toFixed(0)}fps, ${f.duration_sec.toFixed(2)}s, audio ${f.codec_audio} ${f.audio_sample_rate}Hz`);
}

main().catch((e) => { console.error(`[finalize] ${e instanceof Error ? e.message : String(e)}`); process.exit(1); });
