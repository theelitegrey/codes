import { Project } from "../../project/manifest.js";
import { ComposerAgent } from "./index.js";

export async function runComposer(opts: { projectDir: string; preview?: boolean; fps?: 30 | 60; noReview?: boolean }): Promise<void> {
  const project = Project.open(opts.projectDir);
  const composer = new ComposerAgent({ review: !opts.noReview });
  const r = await composer.compose(project, { preview: opts.preview, spec: opts.fps ? { fps: opts.fps } : undefined });
  console.log(`\nscenes: ${r.timeline.scenes.length}  duration: ${r.timeline.duration.toFixed(1)}s\n${r.timeline.events.slice(0, 40).map((e) => `${e.t.toFixed(2).padStart(7)}  ${e.kind.padEnd(12)} ${e.detail}`).join("\n")}\n\nQA ${r.qa.passed ? "PASS" : "FAIL"}\n${r.qa.checks.map((c) => `  ${c.passed ? "✔" : "✘"} ${c.name}: ${c.detail}`).join("\n")}\nfinal: ${r.final}${r.preview ? `\npreview: ${r.preview}` : ""}`);
}
