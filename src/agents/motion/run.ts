import fs from "node:fs";
import path from "node:path";
import { ScriptOutput } from "../script/schema.js";
import { MotionAgent, MotionPlan, motionSummary, writeMotionArtifacts } from "./index.js";
import { renderComposition } from "../../media/render.js";
import { log } from "../../core/log.js";

export async function runMotionAgent(opts: { scriptFile: string; out: string; beats?: string[]; style?: string; notes?: string; timingFile?: string; render?: boolean; width?: number; height?: number }): Promise<string> {
  const script = ScriptOutput.parse(JSON.parse(fs.readFileSync(opts.scriptFile, "utf8")));
  const timing = opts.timingFile ? (JSON.parse(fs.readFileSync(opts.timingFile, "utf8")) as { beats: Array<{ beat_id: string; start: number; end: number }> }).beats : [];
  const plan = await new MotionAgent().run({ script, beat_ids: opts.beats ?? [], style: opts.style, notes: opts.notes, timing, width: opts.width, height: opts.height });
  const dir = path.join(opts.out, "motion");
  writeMotionArtifacts(dir, plan);
  console.log(`\n${motionSummary(plan)}\nwritten: ${dir}/motion.json`);
  if (opts.render) await renderMotionPreview(plan, dir);
  return dir;
}

/** Renders every beat of a plan to <dir>/preview_<beat>.mp4 (silent) for review. */
export async function renderMotionPreview(plan: MotionPlan, dir: string, beatIds?: string[]): Promise<string[]> {
  const files: string[] = [];
  for (const b of plan.beats) {
    if (beatIds?.length && !beatIds.includes(b.beat_id)) continue;
    const out = path.join(dir, `preview_${b.beat_id}.mp4`);
    log.info(`rendering preview ${b.beat_id}`);
    await renderComposition("MotionPreview", { plan, from: b.start, to: b.end }, dir, out);
    files.push(out);
  }
  return files;
}
