import fs from "node:fs";
import path from "node:path";
import { LLM } from "../../providers/llm/llm.js";
import { ScriptOutput } from "../script/schema.js";
import { AudioAgent, audioSummary } from "./index.js";

export async function runAudioAgent(opts: { scriptFile: string; out: string; platform?: string; audience?: string; brand?: string; tone?: string; category?: string; voice?: string; music?: string; noMusic?: boolean; noSfx?: boolean; notes?: string }): Promise<string> {
  const script = ScriptOutput.parse(JSON.parse(fs.readFileSync(opts.scriptFile, "utf8")));
  const dir = path.join(opts.out, "audio");
  const agent = new AudioAgent({ llm: new LLM() });
  const a = await agent.run({ script, platform: opts.platform as never, audience: opts.audience, brand: opts.brand, tone: opts.tone, category: opts.category as never, voice_id: opts.voice, music_file: opts.music, music_enabled: !opts.noMusic, sfx_enabled: !opts.noSfx, notes: opts.notes }, dir);
  console.log(`\n${audioSummary(a)}\nwritten: ${dir}/`);
  return dir;
}
