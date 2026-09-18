import { describe, it, expect } from "vitest";
import { PresenterProfileStore } from "../src/config/presenters.js";
import { VoiceConfigStore } from "../src/config/voices.js";
import { parseModeFromText, getModePreset, listModes } from "../src/presets/modes.js";
import { parseDurationFromText, intakeAgent, stripInstructionPhrases } from "../src/agents/legacy/intake.js";

const presenters = new PresenterProfileStore();
const voices = new VoiceConfigStore();

describe("presenter profiles", () => {
  it("loads the registry with a default and four hosts", () => {
    const reg = presenters.loadRegistry();
    expect(reg.default).toBe("default_host");
    expect(Object.keys(reg.presenters)).toEqual(["default_host", "trading_host", "news_host", "educational_host"]);
  });
  it("resolves presenters from natural language", () => {
    expect(presenters.resolveFromText("Use my default presenter.")?.id).toBe("default_host");
    expect(presenters.resolveFromText("Use trading_host.")?.id).toBe("trading_host");
    expect(presenters.resolveFromText("use the news anchor")?.id).toBe("news_host");
    expect(presenters.resolveFromText("no presenter mentioned")).toBeUndefined();
  });
  it("builds a full avatar prompt from the profile and style template", () => {
    const p = presenters.buildAvatarPrompt(presenters.get("default_host"), ["podcast studio"]);
    expect(p).toContain("podcast host");
    expect(p).toContain("podcast studio");
    expect(p).not.toContain("{");
  });
  it("points at an existing reference image", () => {
    const ref = presenters.referenceImagePath(presenters.get("default"));
    expect(ref.endsWith("config/presenter/reference.png")).toBe(true);
  });
});

describe("voice configs", () => {
  it("lists configured voices", () => {
    expect(voices.list().map((v) => v.id).sort()).toEqual(["default", "default_male", "energetic_male", "local_dev"]);
  });
  it("resolves voices from natural language, most specific alias first", () => {
    expect(voices.resolveFromText("Use the default male voice.")?.id).toBe("default_male");
    expect(voices.resolveFromText("Use the energetic male voice.")?.id).toBe("energetic_male");
    expect(voices.resolveFromText("use the default voice")?.id).toBe("default");
    expect(voices.resolveFromText("nothing here")).toBeUndefined();
  });
});

describe("modes", () => {
  it("has all six modes with a 9:16 1080x1920 canvas", () => {
    for (const m of listModes()) {
      const p = getModePreset(m);
      expect(p.width).toBe(1080);
      expect(p.height).toBe(1920);
    }
  });
  it("PODCAST_SHORT keeps the presenter in the lower 35–50%", () => {
    const p = getModePreset("PODCAST_SHORT");
    expect(p.presenter.position).toBe("bottom");
    expect(p.presenter.height_fraction_range).toEqual([0.35, 0.5]);
  });
  it("parses mode names from text", () => {
    expect(parseModeFromText("make it a news short")).toBe("NEWS");
    expect(parseModeFromText("fullscreen please")).toBe("FULLSCREEN");
    expect(parseModeFromText("plain request")).toBeUndefined();
  });
});

describe("intake", () => {
  it("parses durations", () => {
    expect(parseDurationFromText("Create a 45-second Short")).toBe(45);
    expect(parseDurationFromText("a 1 minute short")).toBe(60);
    expect(parseDurationFromText("a 90s short")).toBe(90);
  });
  it("strips instruction phrases", () => {
    expect(stripInstructionPhrases("Create a 45-second Short explaining NQ liquidity sweeps. Use my default presenter.")).toBe("NQ liquidity sweeps");
  });
  it("builds a request without an LLM", async () => {
    const req = await intakeAgent(null, "Create a 45-second Short explaining NQ liquidity sweeps. Use my default presenter. Use the energetic male voice.", { presenters, voices });
    expect(req).toMatchObject({ topic: "NQ liquidity sweeps", target_duration_sec: 45, mode: "PODCAST_SHORT", presenter_id: "default_host", voice_id: "energetic_male" });
  });
  it("falls back to the presenter's default voice", async () => {
    const req = await intakeAgent(null, "Explain the Fed decision. Use trading_host.", { presenters, voices });
    expect(req.voice_id).toBe("default_male");
  });
});
