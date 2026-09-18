import fs from "node:fs";
import path from "node:path";
import { LLM } from "../../providers/llm/llm.js";
import { ScriptAgent, writeScriptArtifacts, timeline, type ScriptAgentInput } from "./index.js";

/** Runs the Script Agent alone and writes its artifacts to <out>/script/. */
export async function runScriptAgent(opts: Partial<ScriptAgentInput> & { topic: string; out: string; researchFile?: string; previousFiles?: string[] }): Promise<string> {
  const { out, researchFile, previousFiles, ...input } = opts;
  if (researchFile) input.research = fs.readFileSync(researchFile, "utf8");
  if (previousFiles?.length) input.previous_scripts = previousFiles.map((f) => fs.readFileSync(f, "utf8"));
  const agent = new ScriptAgent(new LLM());
  const artifacts = await agent.run(input);
  const dir = path.join(out, "script");
  writeScriptArtifacts(dir, artifacts);
  console.log(`\nHook: ${artifacts.script.hook}\n\n${timeline(artifacts.script.beats)}\n\nCTA: ${artifacts.script.cta}\nwritten: ${dir}/script.json`);
  return dir;
}
