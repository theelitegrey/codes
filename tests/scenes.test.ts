import { describe, it, expect } from "vitest";
import { Scene, SceneList } from "../src/core/scene.js";
import { normaliseScenes } from "../src/agents/legacy/visualDirector.js";
import { getModePreset } from "../src/presets/modes.js";
import { layoutFor } from "../remotion/layout.js";
import { estimateCaptionTrack, toSrt } from "../src/media/captions.js";
import { applyRetentionAdjustments } from "../src/agents/legacy/retention.js";

const base = (id: number, type: Scene["main_visual"]["type"], enabled = true): Scene =>
  Scene.parse({ scene_id: id, duration: 4, narration: `Scene ${id} narration words here.`, presenter: { enabled, position: "bottom", size: "medium" }, main_visual: { type, headline: type === "headline" ? "H" : undefined } });

describe("scene schema", () => {
  it("accepts the documented scene shape with defaults", () => {
    const s = Scene.parse({ scene_id: 1, duration: 5, narration: "...", presenter: { enabled: true, position: "bottom", size: "medium" }, main_visual: { type: "chart", asset: "chart_01.mp4" }, text_overlay: "...", caption: "...", music: "...", sound_effect: "..." });
    expect(s.main_visual.motion).toBe("slow_zoom");
    expect(SceneList.safeParse([]).success).toBe(false);
  });
});

describe("visual director guard rails", () => {
  const preset = getModePreset("PODCAST_SHORT");
  it("clamps presenter height to the preset range and breaks visual monotony", () => {
    const scenes = [base(1, "headline"), base(2, "headline"), base(3, "headline"), base(4, "headline"), base(5, "headline")];
    scenes[0].presenter.height_fraction = 0.9;
    const out = normaliseScenes(scenes, preset, true);
    expect(out[0].presenter.height_fraction).toBe(0.5);
    expect(out.map((s) => s.main_visual.type)).not.toEqual(["headline", "headline", "headline", "headline", "headline"]);
    expect(out.some((s) => !s.presenter.enabled)).toBe(true);
  });
  it("disables the presenter everywhere when no footage is available", () => {
    const out = normaliseScenes([base(1, "chart"), base(2, "broll")], preset, false);
    expect(out.every((s) => !s.presenter.enabled)).toBe(true);
    expect(out[0].main_visual.type).toBe("headline"); // chart without spec degrades to headline
  });
});

describe("layout", () => {
  const preset = getModePreset("PODCAST_SHORT");
  it("puts the presenter in the lower part of the 9:16 frame and the main visual above", () => {
    const s = base(1, "chart");
    s.presenter.height_fraction = 0.45;
    const l = layoutFor(s, preset, 1080, 1920, true);
    expect(l.presenter.y).toBe(1920 - Math.round(1920 * 0.45));
    expect(l.presenter.h).toBe(Math.round(1920 * 0.45));
    expect(l.main.y + l.main.h).toBeLessThanOrEqual(l.presenter.y);
    expect(l.captionY).toBeLessThan(l.presenter.y);
  });
  it("gives the main visual the whole frame when the presenter is off", () => {
    const l = layoutFor(base(1, "chart", false), preset, 1080, 1920, true);
    expect(l.presenter.h).toBe(0);
    expect(l.main.h).toBeGreaterThan(1500);
  });
});

describe("captions", () => {
  it("estimates word timings within each scene's audio window and emits SRT", () => {
    const scenes = [{ ...base(1, "headline"), start_time: 0, duration: 2 }, { ...base(2, "chart"), start_time: 2, duration: 3 }];
    const track = estimateCaptionTrack(scenes);
    expect(track.source).toBe("estimated");
    expect(track.words[0].start).toBe(0);
    const last = track.words[track.words.length - 1];
    expect(last.end).toBeCloseTo(5, 5);
    expect(toSrt(track)).toMatch(/^1\n00:00:00,000 --> /);
  });
});

describe("retention adjustments", () => {
  it("applies only non-audio tweaks", () => {
    const out = applyRetentionAdjustments([base(1, "headline")], { score: 80, predicted_drop_points: [], pacing_notes: "", approved: true, scene_adjustments: [{ scene_id: 1, text_overlay: "NEW", presenter_enabled: false }] });
    expect(out[0].text_overlay).toBe("NEW");
    expect(out[0].presenter.enabled).toBe(false);
    expect(out[0].narration).toBe("Scene 1 narration words here.");
  });
});
