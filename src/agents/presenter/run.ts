import fs from "node:fs";
import path from "node:path";
import { ScriptOutput } from "../script/schema.js";
import { AudioTimeline } from "../audio/schema.js";
import { PresenterAgent, presenterSummary } from "./index.js";

export async function runPresenterAgent(opts: { scriptFile: string; audioDir: string; out: string; profile?: string; mode?: string; background?: "keyable" | "styled" | "auto"; fullframe?: string[]; motionFile?: string; noGenerate?: boolean; notes?: string }): Promise<string> {
  const script = ScriptOutput.parse(JSON.parse(fs.readFileSync(opts.scriptFile, "utf8")));
  const timeline = AudioTimeline.parse(JSON.parse(fs.readFileSync(path.join(opts.audioDir, "timeline.json"), "utf8")));
  const narration = path.join(opts.audioDir, "narration.wav");
  const dir = path.join(opts.out, "presenter");
  const out = await new PresenterAgent().run({ script, audio_timeline: timeline, narration_path: narration, profile_id: opts.profile ?? "default", mode: opts.mode ?? "PODCAST_SHORT", background_mode: opts.background ?? "auto", fullframe_beat_ids: opts.fullframe ?? [], generate: !opts.noGenerate, notes: opts.notes ?? "" }, dir);
  console.log(`\n${presenterSummary(out)}\nwritten: ${dir}/presenter.json`);
  return dir;
}
