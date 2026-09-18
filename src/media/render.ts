import path from "node:path";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import { REMOTION_ENTRY } from "../core/paths.js";
import { log } from "../core/log.js";
import { env } from "../core/env.js";
import type { ShortProps } from "../../remotion/props.js";

/**
 * Renders the Short composition with Remotion. `publicDir` is the project
 * folder so props can reference media by relative path via staticFile().
 */
export async function renderShort(props: ShortProps, projectDir: string, outFile: string, opts: { concurrency?: number; onProgress?: (p: number) => void } = {}): Promise<string> {
  return renderComposition("Short", props as unknown as Record<string, unknown>, projectDir, outFile, opts);
}

/** Render any registered composition with the given input props. */
export async function renderComposition(id: string, props: Record<string, unknown>, projectDir: string, outFile: string, opts: { concurrency?: number; onProgress?: (p: number) => void } = {}): Promise<string> {
  log.info("bundling Remotion project");
  const serveUrl = await bundle({ entryPoint: REMOTION_ENTRY, publicDir: projectDir, webpackOverride: (c) => ({
      ...c,
      // Sources use NodeNext-style ".js" specifiers; map them to the .ts/.tsx files.
      resolve: { ...c.resolve, extensionAlias: { ".js": [".ts", ".tsx", ".js"], ".mjs": [".mts", ".mjs"] } },
    }) });
  // Optional: reuse a system Chromium instead of letting Remotion download its headless shell.
  const browserExecutable = env("REMOTION_BROWSER_EXECUTABLE") ?? null;
  const composition = await selectComposition({ serveUrl, id, inputProps: props, browserExecutable });
  log.info(`rendering ${composition.width}x${composition.height} @ ${composition.fps}fps, ${composition.durationInFrames} frames`);
  let last = -1;
  await renderMedia({
    composition,
    serveUrl,
    browserExecutable,
    codec: "h264",
    outputLocation: outFile,
    inputProps: props,
    concurrency: opts.concurrency ?? null,
    crf: 18,
    pixelFormat: "yuv420p",
    audioCodec: "aac",
    onProgress: ({ progress }) => {
      const pct = Math.floor(progress * 100);
      if (pct !== last && pct % 10 === 0) {
        last = pct;
        log.info(`render ${pct}%`);
      }
      opts.onProgress?.(progress);
    },
  });
  return path.resolve(outFile);
}
