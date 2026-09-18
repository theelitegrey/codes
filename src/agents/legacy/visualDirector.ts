import { z } from "zod";
import { LLM } from "../../providers/llm/llm.js";
import { Scene, SceneList } from "../../core/scene.js";
import type { Script, ShortRequest } from "../../core/project.js";
import type { ModePreset } from "../../presets/modes.js";
import type { PresenterProfile } from "../../config/presenters.js";
import { CHANNEL_BRIEF } from "./prompts.js";

const VisualPlan = z.object({ scenes: SceneList });

/**
 * The Visual Director turns script beats into structured scenes: it decides
 * per scene whether the presenter is visible, its position/size, and what
 * fills the main visual area. Charts are described as data so the renderer
 * can draw them; B-roll/AI visuals carry prompts for asset providers.
 */
export async function visualDirectorAgent(llm: LLM, req: ShortRequest, preset: ModePreset, script: Script, presenter: PresenterProfile, presenterAvailable: boolean): Promise<Scene[]> {
  const [minF, maxF] = preset.presenter.height_fraction_range;
  const plan = await llm.structured(
    VisualPlan,
    `${CHANNEL_BRIEF}\nYou are the Visual Director for a ${preset.label} Short (${preset.description}).
Rules:
- One scene per script beat, same order, narration copied verbatim, duration = beat est_seconds.
- Presenter panel: position "${preset.presenter.position}", size from ${preset.presenter.size}; height_fraction between ${minF} and ${maxF}. ${presenterAvailable ? `Enable the presenter on most scenes but disable it on 1–2 scenes (e.g. a full-screen chart or B-roll moment) so the Short is not visually repetitive. The hook and the CTA scenes should show the presenter.` : "No presenter footage is available: set presenter.enabled=false on every scene and use full-frame visuals."}
- Main visual types: "chart" (provide a complete chart spec with plausible illustrative series of 24–60 points, labels and annotations that match the narration; mark as illustrative in the title if not real data), "headline"/"graphic" (headline + optional subheadline), "broll"/"ai_visual"/"image" (a specific prompt of what to show), "screen_recording" (prompt describing the UI), "none".
- Vary types across consecutive scenes; never use the same type three times in a row.
- text_overlay: 2–6 word on-screen keyword for the beat (may be empty). caption: leave empty (generated from audio later).
- music: a short mood descriptor or empty. sound_effect: "whoosh", "click", "riser", "impact" or empty; use sparingly.`,
    `Topic: ${req.topic}\nPresenter: ${presenter.label} — ${presenter.character_identity}\nBeats:\n${script.beats.map((b, i) => `${i + 1}. [${b.purpose}] (${b.est_seconds.toFixed(1)}s) "${b.narration}" — visual idea: ${b.visual_idea}`).join("\n")}`
  );
  return normaliseScenes(plan.scenes, preset, presenterAvailable);
}

/** Deterministic guard rails applied after the model's plan. */
export function normaliseScenes(scenes: Scene[], preset: ModePreset, presenterAvailable: boolean): Scene[] {
  const [minF, maxF] = preset.presenter.height_fraction_range;
  const out = scenes
    .slice()
    .sort((a, b) => a.scene_id - b.scene_id)
    .map((s, i) => ({ ...s, scene_id: i + 1 }));
  for (const s of out) {
    if (!presenterAvailable) s.presenter = { ...s.presenter, enabled: false };
    const hf = s.presenter.height_fraction ?? preset.presenter.height_fraction;
    s.presenter.height_fraction = Math.min(maxF, Math.max(minF, hf));
    if (s.main_visual.type === "chart" && !s.main_visual.chart) s.main_visual = { ...s.main_visual, type: "headline", headline: s.text_overlay || "" };
    if ((s.main_visual.type === "headline" || s.main_visual.type === "graphic") && !s.main_visual.headline) s.main_visual.headline = s.text_overlay || s.narration.split(/[.,!?]/)[0];
  }
  // Break runs of 3+ identical visual types.
  for (let i = 2; i < out.length; i++) {
    const t = out[i].main_visual.type;
    if (t === out[i - 1].main_visual.type && t === out[i - 2].main_visual.type) {
      out[i].main_visual = { ...out[i].main_visual, type: t === "headline" ? "graphic" : "headline", headline: out[i].main_visual.headline ?? out[i].text_overlay ?? "" };
    }
  }
  // Ensure at least one presenter-free scene when there are 4+ scenes and the presenter is available.
  if (presenterAvailable && out.length >= 4 && out.every((s) => s.presenter.enabled)) {
    const mid = out.slice(1, -1).find((s) => s.main_visual.type === "chart" || s.main_visual.type === "broll") ?? out[Math.floor(out.length / 2)];
    mid.presenter = { ...mid.presenter, enabled: false };
  }
  return out;
}
