import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { LLM } from "../../providers/llm/llm.js";
import { log } from "../../core/log.js";
import { PresenterProfileStore, type PresenterProfile } from "../../config/presenters.js";
import { getModePreset } from "../../presets/modes.js";
import { createAvatarProvider } from "../../providers/avatar/index.js";
import type { AvatarVideoProvider, AvatarGenerationRequest } from "../../providers/avatar/AvatarVideoProvider.js";
import { run, ffmpegBin, probe } from "../../media/ffmpeg.js";
import { PresenterAgentInput, PresenterPlan, PresenterOutput, KEY_COLOR, type BeatPresenter } from "./schema.js";

export * from "./schema.js";

const here = path.dirname(fileURLToPath(import.meta.url));
export const PRESENTER_AGENT_ROLE = fs.readFileSync(path.join(here, "role.md"), "utf8");

export interface PresenterDeps {
  llm?: LLM;
  profiles?: PresenterProfileStore;
  avatar?: AvatarVideoProvider;
}

/** Presenter Agent: profile + final narration → shot plan per beat → LongCat presenter video (+ keyed alpha version). */
export class PresenterAgent {
  private readonly llm: LLM;
  private readonly profiles: PresenterProfileStore;
  private readonly avatar: AvatarVideoProvider;

  constructor(deps: PresenterDeps = {}) {
    this.llm = deps.llm ?? new LLM();
    this.profiles = deps.profiles ?? new PresenterProfileStore();
    this.avatar = deps.avatar ?? createAvatarProvider();
  }

  async plan(input: PresenterAgentInput, profile: PresenterProfile): Promise<PresenterPlan> {
    const preset = getModePreset(input.mode as never);
    const bgMode = input.background_mode === "auto" ? profile.background_mode : input.background_mode;
    const beats = input.script.beats.map((b) => {
      const m = input.audio_timeline.beats.find((x) => x.beat_id === b.id);
      return { id: b.id, start: m?.start ?? b.start, end: m?.end ?? b.end, purpose: b.purpose, narration: b.narration, fullframe: input.fullframe_beat_ids.includes(b.id) };
    });
    const plan = await this.llm.structured(
      PresenterPlan,
      `${PRESENTER_AGENT_ROLE}\n\nProduce the presenter plan. profile_id = "${profile.id}". Mode preset "${preset.label}": default position ${preset.presenter.position}, scale range ${preset.presenter.height_fraction_range[0]}–${preset.presenter.height_fraction_range[1]}, hints: ${preset.presenter.prompt_hints.join(", ")}. background_mode must be "${bgMode}"${bgMode === "keyable" ? ` and the prompt must end by asking for a ${KEY_COLOR.name} backdrop with no objects, even lighting and no green light spilling on the subject` : ""}. The shot prompt must keep the profile's identity, clothing, hairstyle and framing exactly and add the delivery style (LongCat rewards rich character/action/scene prompts). Do not put text or subtitles in the prompt.`,
      `Presenter profile:\n${JSON.stringify({ identity: profile.character_identity, appearance: profile.appearance, clothing: profile.clothing, hairstyle: profile.hairstyle, age: profile.age_range, expression: profile.general_expression, framing: profile.camera_framing, lighting: profile.lighting, background: profile.background_style, personality: profile.personality, prompt: profile.presenter_prompt }, null, 2)}\n\nBeats (measured timing):\n${JSON.stringify(beats, null, 2)}\n${input.notes ? `Notes: ${input.notes}` : ""}`
    );
    const problems = lintPresenterPlan(plan, input, preset.presenter.height_fraction_range);
    if (!problems.length) return plan;
    log.warn(`presenter plan has ${problems.length} issue(s); asking for a revision`);
    const fixed = await this.llm.structured(PresenterPlan, `${PRESENTER_AGENT_ROLE}\n\nRevise the plan so every problem is resolved; change nothing else.`, `Problems:\n- ${problems.join("\n- ")}\n\nPlan:\n${JSON.stringify(plan, null, 2)}\n\nBeats:\n${JSON.stringify(beats, null, 2)}`, { effort: "medium" });
    const remaining = lintPresenterPlan(fixed, input, preset.presenter.height_fraction_range);
    if (remaining.length) throw new Error(`Presenter plan still invalid:\n- ${remaining.join("\n- ")}`);
    return fixed;
  }

  async run(raw: PresenterAgentInput, outDir: string): Promise<PresenterOutput> {
    const input = PresenterAgentInput.parse(raw);
    if (!fs.existsSync(input.narration_path)) throw new Error(`Final narration not found at ${input.narration_path}. Run the Audio Agent first — the presenter is generated from the approved narration.`);
    fs.mkdirSync(outDir, { recursive: true });
    const profile = this.profiles.get(input.profile_id);
    log.stage(`PRESENTER AGENT · plan (${profile.id})`);
    const plan = await this.plan(input, profile);
    fs.writeFileSync(path.join(outDir, "presenter.json"), JSON.stringify(plan, null, 2));
    if (!input.generate) return { plan, video: null, status: "planned_only", detail: "plan only (--no-generate)" };

    log.stage(`PRESENTER AGENT · generate (${this.avatar.name})`);
    const h = await this.avatar.health();
    if (!h.ok) {
      log.warn(`avatar provider unavailable: ${h.detail}`);
      return { plan, video: null, status: "provider_unavailable", detail: h.detail };
    }
    const style = this.profiles.loadStyle();
    const caps = this.avatar.capabilities();
    // Prefer a square or portrait source for the lower panel when the provider can produce one.
    const aspect = (["1:1", "9:16", "16:9"] as const).find((a) => caps.native_aspect_ratios.includes(a)) ?? caps.native_aspect_ratios[0] ?? "16:9";
    const resolution = caps.resolutions.includes(style.resolution) ? style.resolution : caps.resolutions[caps.resolutions.length - 1];
    const genReq: AvatarGenerationRequest & { profileHints?: unknown; backgroundColor?: string } = {
      referenceImage: this.profiles.referenceImagePath(profile),
      audioPath: input.narration_path,
      prompt: plan.shot.prompt,
      negativePrompt: style.negative_prompt,
      outDir,
      durationSec: input.audio_timeline.duration_sec,
      resolution,
      aspectRatio: aspect,
      onLog: (l: string) => process.stdout.write(l),
      // Provider-specific extras (ignored by providers that do not use them).
      profileHints: profile.heygen,
      backgroundColor: plan.shot.background_mode === "keyable" ? KEY_COLOR.hex.replace("0x", "#") : undefined,
    };
    const r = await this.avatar.generate(genReq);
    const raw_ = path.join(outDir, `presenter${path.extname(r.path) || ".mp4"}`);
    if (path.resolve(r.path) !== path.resolve(raw_)) fs.copyFileSync(r.path, raw_);
    let keyed: string | null = null;
    const providerAlpha = Boolean((r.meta as { alpha?: boolean } | undefined)?.alpha);
    if (providerAlpha) {
      // The provider delivered a real alpha channel (e.g. HeyGen webm); no keying needed.
      keyed = raw_;
      log.info("presenter arrived with an alpha channel; skipping chroma key");
    } else if (plan.shot.background_mode === "keyable") {
      keyed = path.join(outDir, "presenter_keyed.mov");
      await chromaKeyToAlpha(raw_, keyed);
      log.info(`keyed presenter written: ${keyed}`);
    }
    const out: PresenterOutput = { plan, video: { raw: raw_, keyed, width: r.width, height: r.height, fps: r.fps, duration_sec: r.duration_sec, provider: r.provider }, status: "generated", detail: `${r.provider} ${r.width}x${r.height} @ ${r.fps}fps, ${r.duration_sec.toFixed(1)}s` };
    fs.writeFileSync(path.join(outDir, "presenter_output.json"), JSON.stringify(out, null, 2));
    return out;
  }
}

/** Removes the flat key-colour backdrop and writes a ProRes 4444 file with alpha for the Composer. */
export async function chromaKeyToAlpha(inFile: string, outFile: string, color: string = KEY_COLOR.hex, similarity = 0.12, blend = 0.04): Promise<void> {
  const r = await run(ffmpegBin(), ["-y", "-i", inFile, "-vf", `format=yuv444p,chromakey=${color}:${similarity}:${blend},despill=type=green:mix=0.6:expand=0.2,format=yuva444p10le`, "-c:v", "prores_ks", "-profile:v", "4444", "-pix_fmt", "yuva444p10le", "-an", outFile]);
  if (r.code !== 0) throw new Error(`chroma key failed: ${r.stderr.slice(-1200)}`);
  const info = await probe(outFile);
  if (!info.has_video) throw new Error("keyed output has no video stream");
}

export function lintPresenterPlan(plan: PresenterPlan, input: PresenterAgentInput, scaleRange: [number, number]): string[] {
  const p: string[] = [];
  const beats = input.script.beats;
  const timing = new Map(input.audio_timeline.beats.map((b) => [b.beat_id, b]));
  for (const b of beats) if (!plan.beats.some((x) => x.beat_id === b.id)) p.push(`${b.id}: missing from plan`);
  for (const x of plan.beats) if (!beats.some((b) => b.id === x.beat_id)) p.push(`${x.beat_id}: unknown beat`);
  const first = plan.beats.find((x) => x.beat_id === beats[0].id);
  const last = plan.beats.find((x) => x.beat_id === beats[beats.length - 1].id);
  if (first && !first.presenter_enabled) p.push("the hook beat must show the presenter");
  if (last && !last.presenter_enabled) p.push("the payoff/CTA beat must show the presenter");
  let visible = 0;
  let total = 0;
  for (const x of plan.beats) {
    const t = timing.get(x.beat_id);
    const dur = t ? t.end - t.start : 0;
    total += dur;
    if (x.presenter_enabled) visible += dur;
    if (x.presenter_enabled && x.position === "bottom" && (x.scale < scaleRange[0] - 0.02 || x.scale > scaleRange[1] + 0.02)) p.push(`${x.beat_id}: scale ${x.scale} outside the preset range ${scaleRange[0]}–${scaleRange[1]}`);
    if (!x.presenter_enabled && dur > 0 && dur < 2) p.push(`${x.beat_id}: hiding the presenter for only ${dur.toFixed(1)}s is a flicker`);
  }
  if (total > 0 && visible / total < 0.6) p.push(`presenter visible only ${Math.round((visible / total) * 100)}% of the video (min 60%)`);
  if (input.background_mode !== "auto" && plan.shot.background_mode !== input.background_mode) p.push(`background_mode must be ${input.background_mode}`);
  if (/subtitle|caption|text overlay/i.test(plan.shot.prompt)) p.push("shot prompt must not ask for text or subtitles");
  if (plan.shot.background_mode === "keyable" && !/green/i.test(plan.shot.prompt)) p.push("keyable background requires the prompt to ask for the flat green backdrop");
  return [...new Set(p)];
}

export function presenterSummary(o: PresenterOutput): string {
  const b = (x: BeatPresenter) => `  ${x.beat_id.padEnd(8)} ${x.presenter_enabled ? `${x.position.padEnd(6)} scale ${x.scale.toFixed(2)} ${x.camera.padEnd(12)} ${x.expression.padEnd(9)} ${x.gesture}` : "hidden"}${x.reason ? `  — ${x.reason}` : ""}`;
  return [`profile: ${o.plan.profile_id}  background: ${o.plan.shot.background_mode}  shot: ${o.plan.shot.shot_size}, ${o.plan.shot.camera_angle}`, `prompt: ${o.plan.shot.prompt}`, ...o.plan.beats.map(b), `status: ${o.status}${o.detail ? ` — ${o.detail}` : ""}`, o.video ? `video: ${o.video.raw}${o.video.keyed ? `\nkeyed: ${o.video.keyed}` : ""}` : ""].filter(Boolean).join("\n");
}
