import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { LLM } from "../src/providers/llm/llm.js";
import { PresenterAgent, PresenterPlan, lintPresenterPlan, chromaKeyToAlpha, KEY_COLOR } from "../src/agents/presenter/index.js";
import { PresenterProfileStore } from "../src/config/presenters.js";
import { run, ffmpegBin, probe } from "../src/media/ffmpeg.js";
import type { AvatarVideoProvider, AvatarGenerationRequest, AvatarGenerationResult, AvatarCapabilities } from "../src/providers/avatar/AvatarVideoProvider.js";
import type { AudioTimeline } from "../src/agents/audio/schema.js";
import type { ScriptOutput } from "../src/agents/script/schema.js";

const script: ScriptOutput = {
  duration: 12, hook: "h", cta: "c", sources: [], review: { changes_made: [], remaining_risks: [] },
  beats: [
    { id: "beat_01", start: 0, end: 4, narration: "Hook.", purpose: "hook", visual_intent: "x", claim_kinds: [] },
    { id: "beat_02", start: 4, end: 9, narration: "Chart moment.", purpose: "explanation", visual_intent: "full chart", claim_kinds: [] },
    { id: "beat_03", start: 9, end: 12, narration: "CTA.", purpose: "cta", visual_intent: "x", claim_kinds: [] },
  ],
};
const timeline: AudioTimeline = { duration_sec: 11.5, beats: [{ beat_id: "beat_01", planned_start: 0, planned_end: 4, start: 0, end: 3.8, tempo_applied: 1 }, { beat_id: "beat_02", planned_start: 4, planned_end: 9, start: 3.8, end: 7.6, tempo_applied: 1 }, { beat_id: "beat_03", planned_start: 9, planned_end: 12, start: 7.6, end: 11.5, tempo_applied: 1 }], lines: [], sfx: [], music: { file: null, base_gain_db: 0, duck_db: 0 } };
const shot = { camera_angle: "eye level, straight on", shot_size: "medium" as const, body_position: "seated, leaning slightly forward", gesture_style: "natural hand gestures", eye_contact: "direct", clothing: "dark charcoal t-shirt under an open black overshirt", background: "flat uniform bright green backdrop", lighting: "soft key light front-left, subtle rim", personality: "engaged, direct", background_mode: "keyable" as const, prompt: "A confident male podcast host in his early thirties ... speaking to camera with natural hand gestures, soft key light, in front of a flat uniform bright green backdrop with no objects and even lighting." };
const plan: PresenterPlan = { profile_id: "default_host", shot, beats: [
  { beat_id: "beat_01", presenter_enabled: true, position: "bottom", scale: 0.45, camera: "medium", expression: "confident", gesture: "natural_hand_gesture", eye_contact: "direct", background: "transparent_or_keyable", reason: "hook" },
  { beat_id: "beat_02", presenter_enabled: false, position: "bottom", scale: 0.42, camera: "medium", expression: "neutral", gesture: "still", eye_contact: "direct", background: "transparent_or_keyable", reason: "full-frame chart" },
  { beat_id: "beat_03", presenter_enabled: true, position: "bottom", scale: 0.5, camera: "medium_close", expression: "warm", gesture: "subtle_hand_gesture", eye_contact: "direct", background: "transparent_or_keyable", reason: "cta" },
] };
const baseInput = { script, audio_timeline: timeline, narration_path: "/tmp/none.wav", profile_id: "default_host", mode: "PODCAST_SHORT", fullframe_beat_ids: ["beat_02"], background_mode: "auto" as const, generate: true, notes: "" };

describe("presenter plan lint", () => {
  it("accepts a plan that keeps the host on for hook and CTA", () => {
    expect(lintPresenterPlan(plan, baseInput, [0.35, 0.5])).toEqual([]);
  });
  it("rejects hidden hook, flicker, low visibility and wrong scale", () => {
    const bad: PresenterPlan = { ...plan, beats: [{ ...plan.beats[0], presenter_enabled: false }, { ...plan.beats[1], scale: 0.9, presenter_enabled: true }, { ...plan.beats[2], presenter_enabled: false }], shot: { ...shot, prompt: "host with subtitles on a blue wall" } };
    const p = lintPresenterPlan(bad, baseInput, [0.35, 0.5]).join("\n");
    expect(p).toMatch(/hook beat must show/);
    expect(p).toMatch(/CTA beat must show/);
    expect(p).toMatch(/scale 0.9 outside/);
    expect(p).toMatch(/must not ask for text/);
    expect(p).toMatch(/flat green backdrop/);
    const flicker: PresenterPlan = { ...plan, beats: plan.beats.map((b) => (b.beat_id === "beat_02" ? b : b)) };
    const short: AudioTimeline = { ...timeline, beats: timeline.beats.map((b) => (b.beat_id === "beat_02" ? { ...b, start: 3.8, end: 5 } : b)) };
    expect(lintPresenterPlan(flicker, { ...baseInput, audio_timeline: short }, [0.35, 0.5]).join("\n")).toMatch(/flicker/);
  });
});

/** Fake LongCat: a green-backdrop clip with a moving "face" so keying can be verified. */
class GreenAvatar implements AvatarVideoProvider {
  readonly name = "fake-green";
  capabilities(): AvatarCapabilities { return { audio_driven: true, resolutions: ["480p"], native_aspect_ratios: ["16:9"], fps: [25], max_duration_sec: 600, supports_negative_prompt: false, supports_seed: false, runtime: "local_gpu" }; }
  async health() { return { ok: true, detail: "fake" }; }
  async generate(req: AvatarGenerationRequest): Promise<AvatarGenerationResult> {
    const out = path.join(req.outDir, "green.mp4");
    const r = await run(ffmpegBin(), ["-y", "-f", "lavfi", "-i", `color=c=${KEY_COLOR.hex.replace("0x", "#")}:s=832x480:r=25:d=${Math.ceil(req.durationSec)}`, "-vf", "drawbox=x=316:y=80:w=200:h=260:color=tan@1:t=fill,drawbox=x=380:y=140:w=20:h=20:color=black@1:t=fill", "-pix_fmt", "yuv420p", "-c:v", "libx264", out]);
    if (r.code !== 0) throw new Error(r.stderr);
    const info = await probe(out);
    return { path: out, width: 832, height: 480, fps: 25, duration_sec: info.duration_sec, provider: this.name, aspect_ratio: "16:9" };
  }
}

describe("Presenter Agent", () => {
  class Stub extends LLM {
    constructor() { super({ model: "stub", client: {} as never }); }
    override async structured<S extends z.ZodType>(): Promise<z.infer<S>> { return plan as z.infer<S>; }
  }
  it("refuses to run without the final narration", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pres-"));
    await expect(new PresenterAgent({ llm: new Stub(), avatar: new GreenAvatar() }).run(baseInput, dir)).rejects.toThrow(/Run the Audio Agent first/);
  });
  it("plans, generates from the narration, and keys the green backdrop to alpha", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pres-"));
    const narration = path.join(dir, "narration.wav");
    await run(ffmpegBin(), ["-y", "-f", "lavfi", "-i", "sine=f=220:d=11.5", "-ar", "48000", narration]);
    const out = await new PresenterAgent({ llm: new Stub(), avatar: new GreenAvatar(), profiles: new PresenterProfileStore() }).run({ ...baseInput, narration_path: narration }, dir);
    expect(out.status).toBe("generated");
    expect(out.plan.beats.filter((b) => b.presenter_enabled).length).toBe(2);
    expect(out.video?.keyed).toMatch(/presenter_keyed\.mov$/);
    const info = await run(ffmpegBin().replace(/ffmpeg$/, "ffprobe"), ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=codec_name,pix_fmt", "-of", "csv=p=0", out.video!.keyed!]);
    expect(info.stdout).toMatch(/prores/);
    expect(info.stdout).toMatch(/yuva444p/);
    // Sample alpha: background pixel must be transparent, face pixel opaque.
    const r = await run(ffmpegBin(), ["-y", "-i", out.video!.keyed!, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgba", path.join(dir, "frame.rgba")]);
    expect(r.code).toBe(0);
    const buf = fs.readFileSync(path.join(dir, "frame.rgba"));
    const alphaAt = (x: number, y: number) => buf[(y * 832 + x) * 4 + 3];
    expect(alphaAt(20, 20)).toBeLessThan(20);
    expect(alphaAt(416, 210)).toBeGreaterThan(230);
    expect(fs.existsSync(path.join(dir, "presenter.json"))).toBe(true);
  }, 60_000);
});

describe("chromaKeyToAlpha", () => {
  it("fails loudly on a missing input", async () => {
    await expect(chromaKeyToAlpha("/nonexistent.mp4", "/tmp/x.mov")).rejects.toThrow(/chroma key failed/);
  });
});
