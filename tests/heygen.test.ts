import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { HeyGenClient, mimeFor } from "../src/providers/heygen/client.js";
import { HeyGenVoiceProvider } from "../src/providers/voice/HeyGenVoiceProvider.js";
import { HeyGenAvatarProvider } from "../src/providers/avatar/HeyGenAvatarProvider.js";
import { createVoiceProvider, listVoiceProviders } from "../src/providers/voice/index.js";
import { createAvatarProvider, listAvatarProviders } from "../src/providers/avatar/index.js";
import { VoiceConfig } from "../src/config/voices.js";
import { run, ffmpegBin } from "../src/media/ffmpeg.js";
import { LineTimingTranscriber } from "../src/agents/captions/transcription.js";

// Keep the polling loop fast in tests.
process.env.HEYGEN_POLL_INTERVAL_MS = "20";

/** Records every request and answers like the documented HeyGen API. */
function fakeHeyGen(wavFile: string) {
  const calls: Array<{ method: string; url: string; headers: Record<string, string>; body?: unknown }> = [];
  let statusPolls = 0;
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const method = init?.method ?? "GET";
    let body: unknown = init?.body;
    if (typeof body === "string") body = JSON.parse(body);
    else if (body instanceof Uint8Array) body = `<${body.byteLength} bytes>`;
    calls.push({ method, url, headers, body });
    const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json" } });
    if (url.endsWith("/v2/voices")) return json({ error: null, data: { voices: [{ voice_id: "v_en_m", name: "Ryan", language: "English", gender: "male", support_pause: true }, { voice_id: "v_en_f", name: "Ava", language: "English", gender: "female", support_pause: false }] } });
    if (url.endsWith("/v3/voices/speech")) return json({ data: { audio_url: "https://cdn.example/speech.wav", duration: 1.2, word_timestamps: [{ word: "Hello", start: 0, end: 0.4 }, { word: "world.", start: 0.5, end: 1.1 }], request_id: "r1" } });
    if (url === "https://cdn.example/speech.wav") return new Response(fs.readFileSync(wavFile), { status: 200, headers: { "content-type": "audio/wav" } });
    if (url.endsWith("/v1/asset")) return json({ code: 100, data: { id: "asset_123", url: "https://resource.example/a.wav", file_type: "audio" } });
    if (url.endsWith("/v1/talking_photo")) return json({ code: 100, data: { talking_photo_id: "tp_456" } });
    if (url.endsWith("/v2/avatars")) return json({ error: null, data: { avatars: [{ avatar_id: "Kristin_public" }], talking_photos: [] } });
    if (url.endsWith("/v2/video/generate")) return json({ error: null, data: { video_id: "vid_789" } });
    if (url.includes("/v1/video_status.get")) {
      statusPolls++;
      return json({ code: 100, data: statusPolls < 2 ? { status: "processing" } : { status: "completed", video_url: "https://cdn.example/vid.mp4", duration: 1.5 } });
    }
    if (url === "https://cdn.example/vid.mp4") return new Response(fs.readFileSync(path.join(path.dirname(wavFile), "vid.mp4")), { status: 200 });
    return json({ error: { message: `unexpected ${url}` } }, 404);
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

describe("HeyGen client request shapes", () => {
  it("builds the /v3/voices/speech body", () => {
    expect(HeyGenClient.speechBody({ text: "Hi", voiceId: "v1", speed: 1.1, language: "en" })).toEqual({ text: "Hi", voice_id: "v1", input_type: "text", speed: 1.1, language: "en" });
    expect(HeyGenClient.speechBody({ text: '<break time="500ms"/>Hi', voiceId: "v1", ssml: true, speed: 3 }).speed).toBe(2);
    expect(HeyGenClient.speechBody({ text: "x", voiceId: "v1", ssml: true }).input_type).toBe("ssml");
  });
  it("builds the /v2/video/generate body with audio-driven voice and a colour background", () => {
    const b = HeyGenClient.videoBody({ character: { type: "talking_photo", talking_photo_id: "tp1" }, audioAssetId: "a1", backgroundColor: "#1DB954", width: 1080, height: 1080, title: "t", test: true });
    expect(b).toEqual({ video_inputs: [{ character: { type: "talking_photo", talking_photo_id: "tp1" }, voice: { type: "audio", audio_asset_id: "a1" }, background: { type: "color", value: "#1DB954" } }], dimension: { width: 1080, height: 1080 }, title: "t", test: true });
    const av = HeyGenClient.videoBody({ character: { type: "avatar", avatar_id: "K" }, audioUrl: "https://x/a.wav", backgroundColor: "#000", width: 720, height: 1280 });
    expect((av.video_inputs as Array<Record<string, unknown>>)[0].character).toEqual({ type: "avatar", avatar_id: "K", avatar_style: "normal" });
    expect(() => HeyGenClient.videoBody({ character: { type: "avatar", avatar_id: "K" }, backgroundColor: "#000", width: 1, height: 1 })).toThrow(/exactly one/);
  });
  it("maps aspect to dimensions and mime types", () => {
    expect(HeyGenAvatarProvider.dimensionFor("1:1", "1080p")).toEqual({ width: 1080, height: 1080 });
    expect(HeyGenAvatarProvider.dimensionFor("9:16", "720p")).toEqual({ width: 720, height: 1280 });
    expect(mimeFor("a.wav")).toBe("audio/wav");
    expect(mimeFor("a.png")).toBe("image/png");
  });
});

describe("HeyGen providers end to end against a fake API", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "heygen-"));
  const wav = path.join(dir, "speech.wav");
  it("voice: lists voices, resolves 'default' by trait, downloads and converts, returns word timings", async () => {
    await run(ffmpegBin(), ["-y", "-f", "lavfi", "-i", "sine=f=440:d=1.2", "-ar", "44100", "-ac", "1", wav]);
    const { fetchImpl, calls } = fakeHeyGen(wav);
    const p = new HeyGenVoiceProvider(new HeyGenClient({ apiKey: "k", fetchImpl }));
    expect((await p.health()).ok).toBe(true);
    const voice = VoiceConfig.parse({ id: "default", label: "d", voice_id: "default", provider: "heygen", speaking_speed: 1.05, traits: { gender: "male" } });
    const r = await p.synthesize({ text: "Hello world.", voice, outPath: path.join(dir, "line.wav") });
    expect(r.voice_id).toBe("v_en_m");
    expect(r.words?.map((w) => w.word)).toEqual(["Hello", "world."]);
    expect(r.duration_sec).toBeCloseTo(1.2, 1);
    const speech = calls.find((c) => c.url.endsWith("/v3/voices/speech"))!;
    expect(speech.headers["X-Api-Key"]).toBe("k");
    expect(speech.body).toEqual({ text: "Hello world.", voice_id: "v_en_m", input_type: "text", speed: 1.05, language: "en" });
    expect(fs.existsSync(path.join(dir, "line.wav.words.json"))).toBe(true);
  }, 30_000);
  it("avatar: uploads the reference as a talking photo once, uploads narration, generates, polls, downloads", async () => {
    await run(ffmpegBin(), ["-y", "-f", "lavfi", "-i", "color=c=green:s=64x64:r=25:d=1.5", "-pix_fmt", "yuv420p", path.join(dir, "vid.mp4")]);
    const ref = path.join(dir, "ref.png");
    fs.copyFileSync(path.resolve("config/presenter/reference.png"), ref);
    const { fetchImpl, calls } = fakeHeyGen(wav);
    const cacheFile = path.join(dir, "cache.json");
    const p = new HeyGenAvatarProvider({ client: new HeyGenClient({ apiKey: "k", fetchImpl }), cacheFile, testMode: true });
    expect(p.capabilities().audio_driven).toBe(true);
    const r = await p.generate({ referenceImage: ref, audioPath: wav, prompt: "ignored", outDir: dir, durationSec: 1.2, aspectRatio: "1:1", resolution: "1080p", backgroundColor: "#1DB954" } as never);
    expect(r.provider).toBe("heygen");
    expect(r.meta).toMatchObject({ video_id: "vid_789", character: { type: "talking_photo", talking_photo_id: "tp_456" }, audio_asset_id: "asset_123", test_mode: true });
    expect(fs.existsSync(r.path)).toBe(true);
    const seq = calls.map((c) => `${c.method} ${new URL(c.url).pathname}`);
    expect(seq).toEqual(["POST /v1/talking_photo", "POST /v1/asset", "POST /v2/video/generate", "GET /v1/video_status.get", "GET /v1/video_status.get", "GET /vid.mp4"]);
    const gen = calls.find((c) => c.url.endsWith("/v2/video/generate"))!.body as Record<string, unknown>;
    expect(gen.test).toBe(true);
    expect((gen.video_inputs as Array<Record<string, unknown>>)[0].voice).toEqual({ type: "audio", audio_asset_id: "asset_123" });
    // Second run reuses the cached talking photo (no re-upload).
    const again = fakeHeyGen(wav);
    const p2 = new HeyGenAvatarProvider({ client: new HeyGenClient({ apiKey: "k", fetchImpl: again.fetchImpl }), cacheFile, testMode: true });
    await p2.generate({ referenceImage: ref, audioPath: wav, prompt: "", outDir: dir, durationSec: 1.2, aspectRatio: "1:1" } as never);
    expect(again.calls.some((c) => c.url.endsWith("/v1/talking_photo"))).toBe(false);
  }, 30_000);
  it("is the default provider in both registries and reports unconfigured without a key", async () => {
    expect(listVoiceProviders()[0]).toBe("heygen");
    expect(listAvatarProviders()[0]).toBe("heygen");
    delete process.env.HEYGEN_API_KEY;
    expect((await createVoiceProvider(undefined, "heygen").health()).detail).toMatch(/HEYGEN_API_KEY/);
    expect((await createAvatarProvider("heygen").health()).detail).toMatch(/HEYGEN_API_KEY/);
  });
  it("captions use provider word timings from the audio timeline when present", async () => {
    const t = new LineTimingTranscriber({ duration_sec: 2, beats: [], lines: [{ beat_id: "b", index: 0, text: "Hello world.", start: 0.5, end: 1.6, pause_after_ms: 0, words: [{ text: "Hello", start: 0.5, end: 0.9 }, { text: "world.", start: 1.0, end: 1.6 }] }], sfx: [], music: { file: null, base_gain_db: 0, duck_db: 0 } });
    const r = await t.transcribe();
    expect(r.words).toEqual([{ text: "Hello", start: 0.5, end: 0.9, emphasis: false }, { text: "world.", start: 1.0, end: 1.6, emphasis: false }]);
    expect((await t.available()).detail).toMatch(/1 with provider word timestamps/);
  });
});
