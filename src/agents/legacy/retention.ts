import { LLM } from "../../providers/llm/llm.js";
import { RetentionReview } from "../../core/project.js";
import type { Scene } from "../../core/scene.js";
import { CHANNEL_BRIEF } from "./prompts.js";

export async function retentionAgent(llm: LLM, scenes: Scene[], totalDuration: number): Promise<RetentionReview> {
  return llm.structured(
    RetentionReview,
    `${CHANNEL_BRIEF}\nYou are the retention reviewer. Predict where viewers swipe away: weak hook, slow middle, visual monotony, unclear payoff, late CTA. Score 0–100. The narration audio is already recorded, so only propose non-audio adjustments (text overlays, presenter on/off, main visual type, headline copy). Approve when score ≥ 70 and no high-impact drop points remain.`,
    `Total duration: ${totalDuration.toFixed(1)}s\nScenes:\n${scenes.map((s) => `#${s.scene_id} [${s.duration.toFixed(1)}s] presenter=${s.presenter.enabled ? `${s.presenter.position}/${s.presenter.size}` : "off"} visual=${s.main_visual.type}${s.main_visual.headline ? ` "${s.main_visual.headline}"` : ""} overlay="${s.text_overlay}" narration="${s.narration}"`).join("\n")}`,
    { effort: "medium" }
  );
}

export function applyRetentionAdjustments(scenes: Scene[], review: RetentionReview): Scene[] {
  return scenes.map((s) => {
    const adj = review.scene_adjustments.find((a) => a.scene_id === s.scene_id);
    if (!adj) return s;
    const next: Scene = { ...s, presenter: { ...s.presenter }, main_visual: { ...s.main_visual } };
    if (adj.text_overlay !== undefined) next.text_overlay = adj.text_overlay;
    if (adj.presenter_enabled !== undefined) next.presenter.enabled = adj.presenter_enabled;
    if (adj.headline !== undefined) next.main_visual.headline = adj.headline;
    if (adj.main_visual_type !== undefined && adj.main_visual_type !== "chart") next.main_visual.type = adj.main_visual_type;
    return next;
  });
}
