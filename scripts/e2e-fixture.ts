/**
 * End-to-end run with stubbed LLM + fake avatar + local TTS. Exercises every
 * pipeline stage (voice, timing, captions, Remotion render, ffmpeg finalize,
 * QA) without external services. Usage: npx tsx scripts/e2e-fixture.ts
 */
import { loadDotEnv } from "../src/core/env.js";
import { ShortsDirector } from "../src/director/ShortsDirector.js";
import { LocalTTSProvider } from "../src/providers/voice/LocalTTSProvider.js";
import { FakeLLM, FakeAvatarProvider } from "../tests/fixtures/fakes.js";

loadDotEnv();
const director = new ShortsDirector({ llm: new FakeLLM(), avatar: new FakeAvatarProvider(), voice: new LocalTTSProvider() });
const project = await director.create("Create a 20-second Short explaining NQ liquidity sweeps. Use my default presenter. Use the local voice.", { outputRoot: "./output/e2e" });
console.log(JSON.stringify({ final: project.final_mp4, qa: project.qa, scenes: project.scenes?.map((s) => ({ id: s.scene_id, start: s.start_time, dur: s.duration, presenter: s.presenter.enabled, visual: s.main_visual.type })) }, null, 2));
