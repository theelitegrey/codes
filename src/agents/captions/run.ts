import fs from "node:fs";
import path from "node:path";
import { ScriptOutput } from "../script/schema.js";
import { AudioTimeline } from "../audio/schema.js";
import { CaptionsAgent, captionsSummary, type CaptionStyleName } from "./index.js";

export async function runCaptionsAgent(opts: { audioDir: string; out: string; scriptFile?: string; style?: string; mode?: "verbatim" | "condensed"; language?: string; notes?: string }): Promise<string> {
  const timeline = AudioTimeline.parse(JSON.parse(fs.readFileSync(path.join(opts.audioDir, "timeline.json"), "utf8")));
  const script = opts.scriptFile ? ScriptOutput.parse(JSON.parse(fs.readFileSync(opts.scriptFile, "utf8"))) : undefined;
  const dir = path.join(opts.out, "captions");
  const out = await new CaptionsAgent().run({ narration_path: path.join(opts.audioDir, "narration.wav"), audio_timeline: timeline, script, style: (opts.style as CaptionStyleName) ?? "Podcast", mode: opts.mode, language: opts.language ?? "en", notes: opts.notes ?? "" }, dir);
  console.log(`\n${captionsSummary(out)}\nwritten: ${dir}/captions.json`);
  return dir;
}
