import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { HeyGenClient, mimeFor, cleanWordTimestamps, type HeyGenLook } from "../src/providers/heygen/client.js";
import { HeyGenVoiceProvider } from "../src/providers/voice/HeyGenVoiceProvider.js";
import { HeyGenAvatarProvider } from "../src/providers/avatar/HeyGenAvatarProvider.js";
import { createVoiceProvider, listVoiceProviders } from "../src/providers/voice/index.js";
import { createAvatarProvider, listAvatarProviders } from "../src/providers/avatar/index.js";
import { VoiceConfig } from "../src/config/voices.js";
import { run, ffmpegBin } from "../src/media/ffmpeg.js";
import { LineTimingTranscriber } from "../src/agents/captions/transcription.js";

process.env.HEYGEN_POLL_INTERVAL_MS = "20";

const LOOK = (over: Partial<HeyGenLook> = {}): Record<string, unknown> => ({ id: "Bryce_public_5", name: "Bryce in Black t-shirt", avatar_type: "studio_avatar", group_id: "g1", gender: "male", default_voice_id: "v_default", supported_api_engines: ["avatar_iii"], image_width: 1087, image_height: 1080, preferred_orientation: "landscape", status: "completed", preview_image_url: "https://files/p.webp", ...over });

/** Fake v3 API mirroring the shapes HeyGen's own connector documents. */
function fakeHeyGen(wavFile: string, opts: { rejectWebm?: boolean } = {}) {
  const calls: Array<{ method: string; url: string; headers: Record<string, string>; body?: unknown }> = [];
  let polls = 0;
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    let body: unknown = init?.body;
    if (typeof body === "string") body = JSON.parse(body);
    else if (body instanceof Uint8Array) body = `<${body.byteLength} bytes>`;
    calls.push({ method, url, headers: (init?.headers ?? {}) as Record<string, string>, body });
    const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json" } });
    const u = new URL(url);
    if (u.pathname === "/v3/voices") return json({ items: [{ voice_id: "v_en_m", name: "Nikhil", language: "English", gender: "male", support_pause: true, type: "public" }, { voice_id: "v_en_f", name: "Ava", language: "English", gender: "female", support_pause: true, type: "public" }], has_more: false });
    if (u.pathname === "/v3/voices/speech") return json({ audio_url: "https://cdn.example/speech.wav", duration: 1.2, word_timestamps: [{ word: "<start>", start: 0, end: 0 }, { word: "Hello", start: 0.2, end: 0.6 }, { word: "world.", start: 0.7, end: 1.1 }, { word: "<end>", start: 1.2, end: 1.2 }] });
    if (url === "https://cdn.example/speech.wav") return new Response(fs.readFileSync(wavFile), { status: 200 });
    if (u.pathname === "/v3/avatars/looks") return json({ items: [LOOK()] });
    if (u.pathname === "/v3/assets") return json({ asset_id: "asset_123", url: "https://cdn.example/a.wav" });
    if (u.pathname === "/v3/videos" && method === "POST") {
      const b = body as Record<string, unknown>;
      if (opts.rejectWebm && b.output_format === "webm") return json({ error: true, message: "This avatar does not support matting.", error_code: "invalid_parameter" }, 400);
      return json({ video_id: "vid_789", status: "waiting", output_format: b.output_format });
    }
    if (u.pathname.startsWith("/v3/videos/")) {
      polls++;
      return json(polls < 2 ? { status: "processing" } : { status: "completed", video_url: "https://cdn.example/vid.mp4", duration: 1.5 });
    }
    if (url === "https://cdn.example/vid.mp4") return new Response(fs.readFileSync(path.join(path.dirname(wavFile), "vid.mp4")), { status: 200 });
    return json({ error: true, message: `unexpected ${url}` }, 404);
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

describe("HeyGen v3 request shapes", () => {
  it("builds the speech body and enforces the 5000-character limit", () => {
    expect(HeyGenClient.speechBody({ text: "Hi", voiceId: "v1", speed: 1.1, locale: "en-US" })).toEqual({ text: "Hi", voice_id: "v1", input_type: "text", speed: 1.1, locale: "en-US" });
    expect(HeyGenClient.speechBody({ text: "x", voiceId: "v1", ssml: true, speed: 3 })).toMatchObject({ input_type: "ssml", speed: 2 });
    expect(() => HeyGenClient.speechBody({ text: "x".repeat(5001), voiceId: "v1" })).toThrow(/5000 characters/);
  });
  it("drops the <start>/<end> word-timestamp sentinels", () => {
    expect(cleanWordTimestamps([{ word: "<start>", start: 0, end: 0 }, { word: "Hi", start: 0.1, end: 0.3 }, { word: "<end>", start: 1, end: 1 }])).toEqual([{ word: "Hi", start: 0.1, end: 0.3 }]);
    expect(cleanWordTimestamps(undefined)).toBeUndefined();
  });
  it("builds the video body for an avatar and for an animated image", () => {
    const av = HeyGenClient.videoBody({ source: { type: "avatar", avatar_id: "Bryce_public_5" }, audioAssetId: "a1", engine: "avatar_iii", aspectRatio: "1:1", outputFormat: "webm", resolution: "720p", title: "t" });
    expect(av).toEqual({ avatar_id: "Bryce_public_5", audio_asset_id: "a1", engine: { type: "avatar_iii" }, aspect_ratio: "1:1", output_format: "webm", resolution: "720p", title: "t" });
    const img = HeyGenClient.videoBody({ source: { type: "image", asset_id: "img1" }, audioUrl: "https://x/a.wav", aspectRatio: "9:16", outputFormat: "mp4", backgroundColor: "#1DB954" });
    expect(img).toMatchObject({ image: { type: "asset_id", asset_id: "img1" }, audio_url: "https://x/a.wav", background: { type: "color", value: "#1DB954" } });
    expect(() => HeyGenClient.videoBody({ source: { type: "avatar", avatar_id: "a" }, aspectRatio: "1:1" })).toThrow(/exactly one/);
    expect(() => HeyGenClient.videoBody({ source: { type: "avatar", avatar_id: "a" }, audioUrl: "u", script: "s" })).toThrow(/exactly one/);
    expect(() => HeyGenClient.videoBody({ source: { type: "avatar", avatar_id: "a" }, audioUrl: "u", outputFormat: "webm", backgroundColor: "#000" })).toThrow(/webm output removes the background/);
  });
  it("picks an engine the look actually supports", () => {
    const look = { ...LOOK(), supported_api_engines: ["avatar_iii"] } as unknown as HeyGenLook;
    expect(HeyGenAvatarProvider.pickEngine(look)).toBe("avatar_iii");
    expect(HeyGenAvatarProvider.pickEngine({ ...look, supported_api_engines: ["avatar_iii", "avatar_v"] } as HeyGenLook)).toBe("avatar_v");
    expect(() => HeyGenAvatarProvider.pickEngine(look, "avatar_iv")).toThrow(/supports avatar_iii/);
    expect(HeyGenAvatarProvider.pickEngine(undefined)).toBeUndefined();
    expect(mimeFor("a.wav")).toBe("audio/wav");
  });
});

describe("HeyGen providers against the fake v3 API", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "heygen-"));
  const wav = path.join(dir, "speech.wav");

  it("voice: resolves 'default' by trait, converts the audio, returns clean word timings", async () => {
    await run(ffmpegBin(), ["-y", "-f", "lavfi", "-i", "sine=f=440:d=1.2", "-ar", "44100", "-ac", "1", wav]);
    const { fetchImpl, calls } = fakeHeyGen(wav);
    const p = new HeyGenVoiceProvider(new HeyGenClient({ apiKey: "k", fetchImpl }), { transport: "rest" });
    expect((await p.health()).ok).toBe(true);
    const voice = VoiceConfig.parse({ id: "default", label: "d", voice_id: "default", provider: "heygen", speaking_speed: 1.05, traits: { gender: "male" } });
    const r = await p.synthesize({ text: "Hello world.", voice, outPath: path.join(dir, "line.wav") });
    expect(r.voice_id).toBe("v_en_m");
    expect(r.words).toEqual([{ word: "Hello", start: 0.2, end: 0.6 }, { word: "world.", start: 0.7, end: 1.1 }]);
    const speech = calls.find((c) => c.url.includes("/v3/voices/speech"))!;
    expect(speech.headers["X-Api-Key"]).toBe("k");
    expect(speech.body).toMatchObject({ text: "Hello world.", voice_id: "v_en_m", input_type: "text", speed: 1.05 });
    expect(calls.find((c) => c.url.includes("/v3/voices?"))!.url).toContain("engine=starfish");
  }, 30_000);

  it("avatar: uploads narration, creates a webm with the look's engine, polls and downloads", async () => {
    await run(ffmpegBin(), ["-y", "-f", "lavfi", "-i", "color=c=green:s=64x64:r=25:d=1.5", "-pix_fmt", "yuv420p", path.join(dir, "vid.mp4")]);
    const { fetchImpl, calls } = fakeHeyGen(wav);
    const p = new HeyGenAvatarProvider({ client: new HeyGenClient({ apiKey: "k", fetchImpl }), transport: "rest", lookId: "Bryce_public_5" });
    const r = await p.generate({ referenceImage: path.resolve("config/presenter/reference.png"), audioPath: wav, prompt: "ignored", outDir: dir, durationSec: 1.2, aspectRatio: "1:1", resolution: "720p", backgroundColor: "#1DB954" });
    expect(r.meta).toMatchObject({ transport: "rest", video_id: "vid_789", engine: "avatar_iii", alpha: true, audio_asset_id: "asset_123" });
    expect(r.path.endsWith(".webm")).toBe(true);
    const create = calls.find((c) => c.method === "POST" && c.url.endsWith("/v3/videos"))!.body as Record<string, unknown>;
    expect(create).toMatchObject({ avatar_id: "Bryce_public_5", audio_asset_id: "asset_123", engine: { type: "avatar_iii" }, output_format: "webm", aspect_ratio: "1:1" });
    expect(create.background).toBeUndefined();
  }, 30_000);

  it("avatar: falls back to mp4 on a key colour when the avatar has no matting", async () => {
    const { fetchImpl, calls } = fakeHeyGen(wav, { rejectWebm: true });
    const p = new HeyGenAvatarProvider({ client: new HeyGenClient({ apiKey: "k", fetchImpl }), transport: "rest", lookId: "Bryce_public_5" });
    const r = await p.generate({ referenceImage: path.resolve("config/presenter/reference.png"), audioPath: wav, prompt: "", outDir: dir, durationSec: 1.2, aspectRatio: "1:1", backgroundColor: "#1DB954" });
    expect((r.meta as { alpha: boolean }).alpha).toBe(false);
    const posts = calls.filter((c) => c.method === "POST" && c.url.endsWith("/v3/videos")).map((c) => (c.body as Record<string, unknown>).output_format);
    expect(posts).toEqual(["webm", "mp4"]);
    const mp4 = calls.filter((c) => c.method === "POST" && c.url.endsWith("/v3/videos")).pop()!.body as Record<string, unknown>;
    expect(mp4.background).toEqual({ type: "color", value: "#1DB954" });
  }, 30_000);

  it("avatar: animates the profile reference image when no HeyGen avatar is configured", async () => {
    const { fetchImpl, calls } = fakeHeyGen(wav);
    const p = new HeyGenAvatarProvider({ client: new HeyGenClient({ apiKey: "k", fetchImpl }), transport: "rest", cacheFile: path.join(dir, "cache.json") });
    await p.generate({ referenceImage: path.resolve("config/presenter/reference.png"), audioPath: wav, prompt: "", outDir: dir, durationSec: 1.2, aspectRatio: "9:16" });
    const create = calls.find((c) => c.method === "POST" && c.url.endsWith("/v3/videos"))!.body as Record<string, unknown>;
    expect(create.image).toEqual({ type: "asset_id", asset_id: "asset_123" });
    expect(create.aspect_ratio).toBe("9:16");
    expect(fs.existsSync(path.join(dir, "cache.json"))).toBe(true);
  }, 30_000);

  it("is the default provider in both registries and reports unconfigured without a key", async () => {
    expect(listVoiceProviders()[0]).toBe("heygen");
    expect(listAvatarProviders()[0]).toBe("heygen");
    delete process.env.HEYGEN_API_KEY;
    process.env.HEYGEN_TRANSPORT = "rest";
    expect((await createVoiceProvider(undefined, "heygen").health()).detail).toMatch(/HEYGEN_API_KEY/);
    expect((await createAvatarProvider("heygen").health()).detail).toMatch(/HEYGEN_API_KEY/);
    delete process.env.HEYGEN_TRANSPORT;
  });

  it("captions reuse provider word timings from the audio timeline", async () => {
    const t = new LineTimingTranscriber({ duration_sec: 2, beats: [], lines: [{ beat_id: "b", index: 0, text: "Hello world.", start: 0.5, end: 1.6, pause_after_ms: 0, words: [{ text: "Hello", start: 0.5, end: 0.9 }, { text: "world.", start: 1.0, end: 1.6 }] }], sfx: [], music: { file: null, base_gain_db: 0, duck_db: 0 } });
    const r = await t.transcribe();
    expect(r.words.map((w) => w.text)).toEqual(["Hello", "world."]);
    expect((await t.available()).detail).toMatch(/1 with provider word timestamps/);
  });
});
