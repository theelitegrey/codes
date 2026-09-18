/**
 * Full Director run with stubbed LLMs, espeak narration and a synthetic
 * green-backdrop presenter. Produces a real project folder + final.mp4.
 * Usage: REMOTION_BROWSER_EXECUTABLE=... npx tsx scripts/e2e-project.ts
 */
import path from "node:path";
import fs from "node:fs";
import { loadDotEnv } from "../src/core/env.js";
import { ProjectDirector } from "../src/director/ProjectDirector.js";
import { ScriptAgent } from "../src/agents/script/index.js";
import { TextAgent } from "../src/agents/text/index.js";
import { AudioAgent, AudioLibrary } from "../src/agents/audio/index.js";
import { MotionAgent } from "../src/agents/motion/index.js";
import { IllustrationAgent } from "../src/agents/illustration/index.js";
import { PresenterAgent } from "../src/agents/presenter/index.js";
import { CaptionsAgent, LineTimingTranscriber } from "../src/agents/captions/index.js";
import { ComposerAgent } from "../src/agents/composer/index.js";
import { LocalTTSProvider } from "../src/providers/voice/LocalTTSProvider.js";
import { StubLLM, FIXTURE_SCRIPT } from "../tests/fixtures/agentStubs.js";
import { run, ffmpegBin, probe } from "../src/media/ffmpeg.js";
import { KEY_COLOR } from "../src/agents/presenter/schema.js";
import type { AvatarVideoProvider, AvatarGenerationRequest, AvatarGenerationResult, AvatarCapabilities } from "../src/providers/avatar/AvatarVideoProvider.js";
import type { Transcriber } from "../src/agents/captions/transcription.js";

loadDotEnv();

class GreenAvatar implements AvatarVideoProvider {
  readonly name = "fake-green";
  capabilities(): AvatarCapabilities { return { audio_driven: true, resolutions: ["480p"], native_aspect_ratios: ["16:9"], fps: [25], max_duration_sec: 600, supports_negative_prompt: false, supports_seed: false, runtime: "local_gpu" }; }
  async health() { return { ok: true, detail: "fake" }; }
  async generate(req: AvatarGenerationRequest): Promise<AvatarGenerationResult> {
    const out = path.join(req.outDir, "green.mp4");
    // A "host": head, torso, and a mouth that opens/closes so lip-sync timing is visible.
    const d = Math.ceil(req.durationSec) + 1;
    const r = await run(ffmpegBin(), ["-y", "-f", "lavfi", "-i", `color=c=${KEY_COLOR.hex.replace("0x", "#")}:s=832x480:r=25:d=${d}`, "-vf", "drawbox=x=296:y=300:w=240:h=200:color=0x2A2C33@1:t=fill,drawbox=x=336:y=70:w=160:h=210:color=0xC4A484@1:t=fill,drawbox=x=380:y=130:w=16:h=16:color=black@1:t=fill,drawbox=x=436:y=130:w=16:h=16:color=black@1:t=fill,drawbox=x=392:y=210:w=48:h='12+10*abs(sin(t*9))':color=0x5A2A2A@1:t=fill", "-pix_fmt", "yuv420p", "-c:v", "libx264", out]);
    if (r.code !== 0) throw new Error(r.stderr);
    const info = await probe(out);
    return { path: out, width: 832, height: 480, fps: 25, duration_sec: info.duration_sec, provider: this.name, aspect_ratio: "16:9" };
  }
}

const llm = new StubLLM();
// Condensed caption pages must reference the spoken word indices of the fixture narration (48 words).
const words = FIXTURE_SCRIPT.beats.flatMap((b) => b.narration.split(/\s+/));
const page = (from: number, to: number, lines: string[], emphasis: string | null = null) => ({ from_word: from, to_word: to, lines, emphasis_word: emphasis });
const idx = (w: string, after = 0) => words.findIndex((x, i) => i >= after && x.replace(/[^a-z]/gi, "").toLowerCase() === w);
llm.condensedPages = { pages: [
  page(0, idx("ignored"), ["That wick", "you ignored?"], "wick"),
  page(idx("ignored") + 1, idx("move"), ["The whole move"], "whole"),
  page(idx("move") + 1, idx("high"), ["Price takes", "the high"], "high"),
  page(idx("high") + 1, idx("stops"), ["Grabs the stops"], "stops"),
  page(idx("stops") + 1, idx("hard"), ["And reverses"], "reverses"),
  page(idx("hard") + 1, idx("wick", idx("hard")), ["Long wick"], null),
  page(idx("wick", idx("hard")) + 1, idx("level"), ["Fast reclaim"], "reclaim"),
  page(idx("level") + 1, idx("sweep", idx("level")), ["No reclaim,", "no sweep"], "no"),
  page(idx("sweep", idx("level")) + 1, words.length - 1, ["Wait for", "the reclaim"], "reclaim"),
] };

const director = new ProjectDirector({
  script: new ScriptAgent(llm),
  text: new TextAgent(llm),
  audio: new AudioAgent({ llm, library: new AudioLibrary("/nonexistent"), voiceProvider: () => new LocalTTSProvider() }),
  motion: new MotionAgent(llm),
  illustration: new IllustrationAgent({ llm, adapters: {} }),
  presenter: new PresenterAgent({ llm, avatar: new GreenAvatar() }),
  captions: new CaptionsAgent({ llm, transcribers: [] as Transcriber[] }),
  composer: new ComposerAgent({ llm }),
});
// Captions: use the line-timing fallback (created per run from the audio timeline).
(director as unknown as { a: { captions: CaptionsAgent } }).a.captions = new (class extends CaptionsAgent {
  override async run(input: Parameters<CaptionsAgent["run"]>[0], outDir: string) {
    return new CaptionsAgent({ llm, transcribers: [new LineTimingTranscriber(input.audio_timeline)] }).run(input, outDir);
  }
})({ llm });

const { project, result } = await director.produce("Create a 20-second Short explaining NQ liquidity sweeps. Use my default presenter. Use the local voice.", { outputRoot: "./output/e2e-projects", brand: { caption_style: "Podcast", voice_id: "local_dev" }, scriptInput: { web_research: false }, preview: false });
console.log(JSON.stringify({ dir: project.dir, final: result?.final, qa: result?.qa, artifacts: Object.fromEntries(Object.entries(project.manifest.artifacts).map(([k, v]) => [k, v.status])) }, null, 2));
fs.writeFileSync(path.join(project.dir, "e2e.txt"), result?.timeline.events.map((e) => `${e.t.toFixed(2)} ${e.kind} ${e.detail}`).join("\n") ?? "");
