import fs from "node:fs";
import path from "node:path";
import { ScriptOutput } from "../script/schema.js";
import { IllustrationAgent, illustrationSummary } from "./index.js";

export async function runIllustrationAgent(opts: { scriptFile: string; out: string; motionFile?: string; textFile?: string; style?: string; notes?: string; generate?: boolean; nonCommercial?: boolean; vram?: number }): Promise<string> {
  const script = ScriptOutput.parse(JSON.parse(fs.readFileSync(opts.scriptFile, "utf8")));
  const motionIds = opts.motionFile ? (JSON.parse(fs.readFileSync(opts.motionFile, "utf8")) as { beats: Array<{ beat_id: string }> }).beats.map((b) => b.beat_id) : [];
  const textIds = opts.textFile ? [...new Set((JSON.parse(fs.readFileSync(opts.textFile, "utf8")) as { elements: Array<{ beat_id: string; level: number }> }).elements.filter((e) => e.level === 1).map((e) => e.beat_id))] : [];
  const dir = path.join(opts.out, "illustration");
  const out = await new IllustrationAgent().run({ script, motion_beat_ids: motionIds, text_beat_ids: textIds, style: opts.style, notes: opts.notes, generate: Boolean(opts.generate), commercial: !opts.nonCommercial, vram_gb: opts.vram }, dir);
  console.log(`\n${illustrationSummary(out)}\nwritten: ${dir}/illustration.json`);
  return dir;
}
