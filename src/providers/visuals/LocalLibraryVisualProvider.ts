import fs from "node:fs";
import path from "node:path";
import { env } from "../../core/env.js";
import type { VisualAssetProvider, VisualAssetRequest, VisualAssetResult } from "./VisualAssetProvider.js";

/**
 * Picks B-roll / images from a local library folder (SHORTS_ASSET_DIR) by
 * keyword overlap between the visual prompt and file names. When nothing
 * matches, returns `none` and the renderer draws a generated graphic. This is
 * the default because no image/video generation API is configured; plug a
 * generative provider in via registerVisualProvider().
 */
export class LocalLibraryVisualProvider implements VisualAssetProvider {
  readonly name = "local_library";
  constructor(private readonly dir: string | undefined = env("SHORTS_ASSET_DIR")) {}

  async resolve(req: VisualAssetRequest): Promise<VisualAssetResult> {
    if (req.visual.asset && fs.existsSync(req.visual.asset)) {
      return { path: path.resolve(req.visual.asset), kind: isVideo(req.visual.asset) ? "video" : "image", provider: this.name };
    }
    if (!this.dir || !fs.existsSync(this.dir)) return { kind: "none", provider: this.name };
    const words = new Set((req.visual.prompt ?? "").toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 3));
    let best: { file: string; score: number } | undefined;
    for (const f of walk(this.dir)) {
      if (!/\.(mp4|mov|webm|png|jpg|jpeg)$/i.test(f)) continue;
      const toks = path.basename(f).toLowerCase().split(/[^a-z0-9]+/);
      const score = toks.filter((t) => words.has(t)).length;
      if (score > 0 && (!best || score > best.score)) best = { file: f, score };
    }
    if (!best) return { kind: "none", provider: this.name };
    return { path: best.file, kind: isVideo(best.file) ? "video" : "image", provider: this.name };
  }
}

function isVideo(f: string): boolean {
  return /\.(mp4|mov|webm)$/i.test(f);
}

function* walk(dir: string): Generator<string> {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else yield p;
  }
}
