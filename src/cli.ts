#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { Command } from "commander";
import { loadDotEnv, env } from "./core/env.js";
import { log } from "./core/log.js";
import { ShortsDirector } from "./director/ShortsDirector.js";
import { PresenterProfileStore } from "./config/presenters.js";
import { VoiceConfigStore } from "./config/voices.js";
import { createVoiceProvider, listVoiceProviders } from "./providers/voice/index.js";
import { createAvatarProvider, listAvatarProviders } from "./providers/avatar/index.js";
import { listModes, getModePreset } from "./presets/modes.js";
import { commandExists } from "./media/ffmpeg.js";
import { ShortMode, type ProjectState } from "./core/project.js";
import { intakeAgent } from "./agents/legacy/intake.js";
import { runScriptAgent } from "./agents/script/run.js";
import { runTextAgent } from "./agents/text/run.js";
import { runAudioAgent } from "./agents/audio/run.js";
import { runMotionAgent } from "./agents/motion/run.js";

loadDotEnv();

const program = new Command();
program.name("shorts").description("Podcast-style Shorts generator (VoiceStudio narration + LongCat-Video-Avatar presenter + Remotion/FFmpeg).").version("0.1.0");

program
  .command("create")
  .description('Create a Short from an instruction, e.g. "Create a 45-second Short explaining NQ liquidity sweeps. Use my default presenter."')
  .argument("<instruction>")
  .option("--mode <mode>", `override mode (${listModes().join("|")})`)
  .option("--presenter <id>", "override presenter profile id")
  .option("--voice <id>", "override voice config id")
  .option("--duration <sec>", "override target duration", (v) => Number(v))
  .option("--no-presenter", "render without the speaking presenter")
  .option("--stop-after <stage>", "script|scenes|audio|presenter|render")
  .option("--resume <project.json>", "resume an existing project")
  .option("--out <dir>", "output root (default SHORTS_OUTPUT_DIR or ./output)")
  .action(async (instruction: string, o) => {
    const director = new ShortsDirector();
    const overrides: Record<string, unknown> = {};
    if (o.mode) overrides.mode = ShortMode.parse(String(o.mode).toUpperCase());
    if (o.presenter) overrides.presenter_id = o.presenter;
    if (o.voice) overrides.voice_id = o.voice;
    if (o.duration) overrides.target_duration_sec = o.duration;
    const project = await director.create(instruction, { overrides, skipPresenter: o.presenter === false, stopAfter: o.stopAfter, resumeFrom: o.resume, outputRoot: o.out });
    printSummary(project);
  });

program
  .command("plan")
  .description("Parse an instruction into a structured request without running anything (no LLM needed).")
  .argument("<instruction>")
  .action(async (instruction: string) => {
    const req = await intakeAgent(null, instruction, { presenters: new PresenterProfileStore(), voices: new VoiceConfigStore() });
    console.log(JSON.stringify(req, null, 2));
  });

const presenters = program.command("presenters").description("Manage presenter profiles (config/presenter/presenter.json)");
presenters.command("list").action(() => {
  const store = new PresenterProfileStore();
  const reg = store.loadRegistry();
  for (const p of Object.values(reg.presenters)) console.log(`${p.id === reg.default ? "*" : " "} ${p.id.padEnd(18)} ${p.label.padEnd(18)} ${p.character_identity}`);
});
presenters.command("prompt").argument("<id>").option("--mode <mode>", "mode hints", "PODCAST_SHORT").action((id: string, o) => {
  const store = new PresenterProfileStore();
  console.log(store.buildAvatarPrompt(store.get(id), getModePreset(ShortMode.parse(o.mode)).presenter.prompt_hints));
});

const voices = program.command("voices").description("Manage voice configs (config/voice/*.json)");
voices.command("list").description("List configured voices").action(() => {
  for (const v of new VoiceConfigStore().list()) console.log(`${v.id.padEnd(16)} ${v.provider.padEnd(12)} voice_id=${v.voice_id.padEnd(10)} ${v.label} — ${v.style}`);
});
voices
  .command("discover")
  .description("List voices the active provider reports (VoiceStudio: GET /v1/audio/voices)")
  .option("--provider <name>", `one of ${listVoiceProviders().join("|")}`)
  .action(async (o) => {
    const p = createVoiceProvider(undefined, o.provider);
    const h = await p.health();
    if (!h.ok) {
      log.error(h.detail);
      process.exit(1);
    }
    for (const v of await p.listVoices()) console.log(`${v.id.padEnd(36)} ${v.name}${v.language ? ` (${v.language})` : ""}${v.engine ? ` [${v.engine}]` : ""}`);
  });
voices
  .command("test")
  .description("Synthesize a sample line with a configured voice")
  .argument("<voice_id>")
  .option("--text <text>", "text to speak", "This is a VoiceStudio narration test for the Shorts pipeline.")
  .option("--out <file>", "output file", "./output/voice-test.wav")
  .action(async (id: string, o) => {
    const cfg = new VoiceConfigStore().get(id);
    const p = createVoiceProvider(cfg);
    const r = await p.synthesize({ text: o.text, voice: cfg, outPath: path.resolve(o.out) });
    console.log(`${r.path} (${r.duration_sec.toFixed(2)}s via ${r.provider})`);
  });

const agent = program.command("agent").description("Run a single agent in isolation");
agent
  .command("script")
  .description("Script Agent: research → hooks → timed beats → review, writes <out>/script/script.json")
  .argument("<topic>")
  .option("--platform <p>", "youtube_shorts|tiktok|instagram_reels|youtube|x", "youtube_shorts")
  .option("--duration <sec>", "target duration", (v) => Number(v), 45)
  .option("--audience <text>", "target audience")
  .option("--category <text>", "content category")
  .option("--brand <text>", "brand / personality")
  .option("--tone <text>", "desired tone")
  .option("--notes <text>", "extra constraints")
  .option("--research <file>", "optional research text file")
  .option("--previous <files...>", "previous successful scripts (files)")
  .option("--no-web", "disable web research")
  .option("--out <dir>", "output folder", "./output/agents")
  .action(async (topic: string, o) => {
    await runScriptAgent({ topic, platform: o.platform, duration_sec: o.duration, audience: o.audience, category: o.category, brand: o.brand, tone: o.tone, notes: o.notes, researchFile: o.research, previousFiles: o.previous, web_research: o.web !== false, out: o.out });
  });

agent
  .command("text")
  .description("Text Agent: script.json → on-screen text plan, writes <out>/text/text.json")
  .argument("<script.json>")
  .option("--platform <p>", "youtube_shorts|tiktok|instagram_reels|youtube|x", "youtube_shorts")
  .option("--brand <text>", "brand / visual personality")
  .option("--tone <text>", "tone")
  .option("--notes <text>", "extra constraints")
  .option("--out <dir>", "output folder", "./output/agents")
  .action(async (scriptFile: string, o) => {
    await runTextAgent({ scriptFile, out: o.out, platform: o.platform, brand: o.brand, tone: o.tone, notes: o.notes });
  });

agent
  .command("audio")
  .description("Audio Agent: script.json → VoiceStudio narration with pauses, music bed, SFX, mastered mix + loudness report in <out>/audio/")
  .argument("<script.json>")
  .option("--platform <p>", "youtube_shorts|tiktok|instagram_reels|youtube|x", "youtube_shorts")
  .option("--audience <text>", "target audience")
  .option("--brand <text>", "brand / personality")
  .option("--tone <text>", "tone")
  .option("--category <c>", "educational|entertainment|news|trading|story|other", "educational")
  .option("--voice <id>", "force a configured voice id instead of letting the agent choose")
  .option("--music <file>", "explicit music bed file")
  .option("--no-music", "disable music")
  .option("--no-sfx", "disable sound effects")
  .option("--notes <text>", "extra constraints")
  .option("--out <dir>", "output folder", "./output/agents")
  .action(async (scriptFile: string, o) => {
    await runAudioAgent({ scriptFile, out: o.out, platform: o.platform, audience: o.audience, brand: o.brand, tone: o.tone, category: o.category, voice: o.voice, music: o.music, noMusic: o.music === false, noSfx: o.sfx === false, notes: o.notes });
  });

agent
  .command("motion")
  .description("Motion Graphics Agent (Claude Fable 5.1): script.json → motion.json built from the Remotion component catalog; --render writes preview mp4s per beat")
  .argument("<script.json>")
  .option("--beats <ids...>", "only these beat ids")
  .option("--style <text>", "visual style brief")
  .option("--notes <text>", "extra constraints")
  .option("--timing <timeline.json>", "Audio Agent timeline to use measured beat times")
  .option("--width <px>", "stage width", (v) => Number(v), 1080)
  .option("--height <px>", "stage height", (v) => Number(v), 1080)
  .option("--render", "render preview mp4 per beat")
  .option("--out <dir>", "output folder", "./output/agents")
  .action(async (scriptFile: string, o) => {
    await runMotionAgent({ scriptFile, out: o.out, beats: o.beats, style: o.style, notes: o.notes, timingFile: o.timing, render: Boolean(o.render), width: o.width, height: o.height });
  });

program.command("modes").description("List composition modes").action(() => {
  for (const m of listModes()) {
    const p = getModePreset(m);
    console.log(`${m.padEnd(14)} ${p.description}`);
  }
});

program
  .command("doctor")
  .description("Check providers, binaries and configuration")
  .action(async () => {
    const rows: Array<[string, boolean, string]> = [];
    rows.push(["ffmpeg", await commandExists(env("FFMPEG_PATH", "ffmpeg")!), env("FFMPEG_PATH", "ffmpeg")!]);
    rows.push(["ffprobe", await commandExists(env("FFPROBE_PATH", "ffprobe")!), env("FFPROBE_PATH", "ffprobe")!]);
    rows.push(["ANTHROPIC_API_KEY", Boolean(env("ANTHROPIC_API_KEY") || env("ANTHROPIC_AUTH_TOKEN")), env("ANTHROPIC_API_KEY") ? "set" : "not set (agents will fail unless `ant auth login` was used)"]);
    for (const name of listVoiceProviders()) {
      const h = await createVoiceProvider(undefined, name).health();
      rows.push([`voice:${name}`, h.ok, h.detail]);
    }
    for (const name of listAvatarProviders()) {
      const h = await createAvatarProvider(name).health();
      rows.push([`avatar:${name}`, h.ok, h.detail]);
    }
    try {
      const store = new PresenterProfileStore();
      const reg = store.loadRegistry();
      const ref = store.referenceImagePath(reg.presenters[reg.default]);
      rows.push(["presenter config", fs.existsSync(ref), `${Object.keys(reg.presenters).length} profiles, default=${reg.default}, reference=${ref}`]);
    } catch (e) {
      rows.push(["presenter config", false, (e as Error).message]);
    }
    rows.push(["voice config", new VoiceConfigStore().list().length > 0, new VoiceConfigStore().list().map((v) => v.id).join(", ")]);
    for (const [name, ok, detail] of rows) console.log(`${ok ? "✔" : "✘"} ${name.padEnd(20)} ${detail}`);
  });

function printSummary(p: ProjectState): void {
  console.log("\n══ RESULT ══");
  console.log(`project:   ${p.id}`);
  if (p.script) console.log(`script:    ${p.script.beats.length} beats`);
  if (p.scenes) console.log(`scenes:    ${p.scenes.length}`);
  if (p.narration) console.log(`narration: ${p.narration.duration_sec.toFixed(1)}s (${p.narration.provider}/${p.narration.voice_id})`);
  if (p.presenter_video) console.log(`presenter: ${p.presenter_video.path}`);
  if (p.retention) console.log(`retention: ${p.retention.score}/100 ${p.retention.approved ? "approved" : "needs work"}`);
  if (p.qa) console.log(`qa:        ${p.qa.passed ? "PASS" : "FAIL"}${p.qa.passed ? "" : " — " + p.qa.checks.filter((c) => !c.passed).map((c) => c.name).join(", ")}`);
  if (p.metadata) console.log(`title:     ${p.metadata.title}\nhashtags:  ${p.metadata.hashtags.join(" ")}`);
  if (p.final_mp4) console.log(`final:     ${p.final_mp4}`);
  const failed = p.stage_log.filter((s) => s.status !== "ok");
  if (failed.length) console.log(`notes:     ${failed.map((s) => `${s.stage}=${s.status}${s.detail ? ` (${s.detail})` : ""}`).join("; ")}`);
}

program.parseAsync(process.argv).catch((e) => {
  log.error((e as Error).stack ?? String(e));
  process.exit(1);
});
