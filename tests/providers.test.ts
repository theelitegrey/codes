import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { LongCatAvatarProvider, segmentsForDuration, generatedDuration } from "../src/providers/avatar/LongCatAvatarProvider.js";
import { VoiceStudioProvider, normaliseVoices } from "../src/providers/voice/VoiceStudioProvider.js";
import { createVoiceProvider, listVoiceProviders, registerVoiceProvider } from "../src/providers/voice/index.js";
import { createAvatarProvider, listAvatarProviders } from "../src/providers/avatar/index.js";
import { VoiceConfig } from "../src/config/voices.js";

describe("LongCat provider", () => {
  it("computes continuation segments from the demo script's frame math", () => {
    expect(segmentsForDuration(2)).toBe(1);
    expect(segmentsForDuration(3.72)).toBe(1);
    expect(segmentsForDuration(4)).toBe(2);
    expect(segmentsForDuration(45)).toBe(14);
    expect(generatedDuration(14)).toBeGreaterThanOrEqual(45);
    expect(generatedDuration(14) - 45).toBeLessThan(3.2);
  });
  it("builds the documented input JSON", () => {
    expect(LongCatAvatarProvider.buildInputJson("p", "/x/ref.png", "/x/a.wav")).toEqual({ prompt: "p", cond_image: "/x/ref.png", cond_audio: { person1: "/x/a.wav" } });
  });
  it("builds the documented torchrun argv for ai2v + v1.5 + distill + int8", () => {
    const args = LongCatAvatarProvider.buildArgs({ nproc: 2, checkpointDir: "/w/LongCat-Video-Avatar-1.5", inputJson: "/j/in.json", outputDir: "/o", resolution: "480p", numSegments: 5, useInt8: true, refImgIndex: 10, maskFrameRange: 3 });
    expect(args).toEqual([
      "--nproc_per_node=2",
      "run_demo_avatar_single_audio_to_video.py",
      "--context_parallel_size=2",
      "--checkpoint_dir=/w/LongCat-Video-Avatar-1.5",
      "--stage_1=ai2v",
      "--input_json=/j/in.json",
      "--output_dir=/o",
      "--resolution=480p",
      "--num_segments=5",
      "--ref_img_index=10",
      "--mask_frame_range=3",
      "--use_distill",
      "--model_type",
      "avatar-v1.5",
      "--use_int8",
    ]);
  });
  it("finds the cumulative continuation output first", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lc-"));
    fs.writeFileSync(path.join(dir, "ai2v_demo_1.mp4"), "a");
    fs.writeFileSync(path.join(dir, "video_continue_3.mp4"), "b");
    expect(LongCatAvatarProvider.findOutput(dir, 3)).toBe(path.join(dir, "video_continue_3.mp4"));
    expect(LongCatAvatarProvider.findOutput(dir, 1)).toBe(path.join(dir, "ai2v_demo_1.mp4"));
  });
  it("reports unhealthy with actionable detail when the repo is missing", async () => {
    const p = new LongCatAvatarProvider({ repoDir: "/nonexistent", execMode: "local" });
    const h = await p.health();
    expect(h.ok).toBe(false);
    expect(h.detail).toContain("meituan-longcat/LongCat-Video");
    expect(p.capabilities().audio_driven).toBe(true);
  });
});

describe("VoiceStudio provider", () => {
  const voice = VoiceConfig.parse({ id: "t", label: "t", voice_id: "abc123", model: "omnivoice", speaking_speed: 1.1, emotion: "calm", style: "narration", output_format: "wav" });
  it("builds an OpenAI-compatible speech body", () => {
    const body = VoiceStudioProvider.buildSpeechBody({ text: "hi", voice, outPath: "/tmp/x.wav" });
    expect(body).toMatchObject({ model: "omnivoice", input: "hi", voice: "abc123", response_format: "wav", speed: 1.1 });
    expect(body.instructions).toBe("calm; narration");
  });
  it("sends Bearer and PIN headers only when configured", () => {
    expect(new VoiceStudioProvider({ apiKey: "k", pin: "123456" }).headers()).toEqual({ Authorization: "Bearer k", "X-OmniVoice-Pin": "123456" });
    expect(new VoiceStudioProvider({ apiKey: "", pin: "" }).headers()).toEqual({});
  });
  it("normalises the voices payload shapes", () => {
    expect(normaliseVoices({ voices: [{ id: "v1", name: "Morgan", language: "en" }] })).toEqual([{ id: "v1", name: "Morgan", language: "en", engine: undefined, raw: { id: "v1", name: "Morgan", language: "en" } }]);
    expect(normaliseVoices(["default"])[0]).toMatchObject({ id: "default" });
    expect(normaliseVoices({ data: [{ profile_id: "p9", label: "Cloned" }] })[0]).toMatchObject({ id: "p9", name: "Cloned" });
  });
  it("calls the documented endpoints and rejects non-audio responses", async () => {
    const calls: string[] = [];
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? "GET"} ${url}`);
      if (url.endsWith("/health")) return new Response("{}", { status: 200 });
      if (url.endsWith("/v1/audio/voices")) return new Response(JSON.stringify({ voices: [{ id: "default", name: "Default" }] }), { status: 200 });
      return new Response(JSON.stringify({ detail: "model not installed" }), { status: 200, headers: { "content-type": "application/json" } });
    }) as unknown as typeof fetch;
    const p = new VoiceStudioProvider({ baseUrl: "http://localhost:3900/", fetchImpl });
    expect((await p.health()).ok).toBe(true);
    expect((await p.listVoices())[0].id).toBe("default");
    await expect(p.synthesize({ text: "x", voice, outPath: path.join(os.tmpdir(), "vs-test.wav") })).rejects.toThrow(/non-audio/);
    expect(calls).toEqual(["GET http://localhost:3900/health", "GET http://localhost:3900/v1/audio/voices", "POST http://localhost:3900/v1/audio/speech"]);
  });
});

describe("provider registries", () => {
  it("expose the built-ins and accept new providers without touching the director", () => {
    expect(listVoiceProviders()).toEqual(expect.arrayContaining(["voicestudio", "local"]));
    expect(listAvatarProviders()).toEqual(expect.arrayContaining(["longcat", "none"]));
    registerVoiceProvider("future", () => ({ name: "future", health: async () => ({ ok: true, detail: "" }), listVoices: async () => [], synthesize: async () => { throw new Error("n/a"); } }));
    expect(createVoiceProvider(undefined, "future").name).toBe("future");
    expect(createAvatarProvider("none").name).toBe("none");
    expect(() => createAvatarProvider("nope")).toThrow(/Unknown avatar provider/);
  });
});
