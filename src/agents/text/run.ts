import fs from "node:fs";
import path from "node:path";
import { LLM } from "../../providers/llm/llm.js";
import { ScriptOutput } from "../script/schema.js";
import { TextAgent, writeTextArtifacts, textTimeline } from "./index.js";

/** Runs the Text Agent alone on an existing script.json and writes <out>/text/text.json. */
export async function runTextAgent(opts: { scriptFile: string; out: string; platform?: string; brand?: string; tone?: string; notes?: string }): Promise<string> {
  const script = ScriptOutput.parse(JSON.parse(fs.readFileSync(opts.scriptFile, "utf8")));
  const agent = new TextAgent(new LLM());
  const out = await agent.run({ script, platform: opts.platform as never, brand: opts.brand, tone: opts.tone, notes: opts.notes });
  const dir = path.join(opts.out, "text");
  writeTextArtifacts(dir, out);
  console.log(`\n${textTimeline(out)}\n\nsilent beats: ${out.silent_beats.map((s) => s.beat_id).join(", ") || "none"}\nwritten: ${dir}/text.json`);
  return dir;
}
