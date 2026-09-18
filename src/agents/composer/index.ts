import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { LLM } from "../../providers/llm/llm.js";
import { log } from "../../core/log.js";
import { env } from "../../core/env.js";
import { Project } from "../../project/manifest.js";
import { renderComposition } from "../../media/render.js";
import { run, ffmpegBin, probe } from "../../media/ffmpeg.js";
import { ScriptOutput } from "../script/schema.js";
import { TextOutput } from "../text/schema.js";
import { AudioTimeline } from "../audio/schema.js";
import { MotionPlan } from "../../../remotion/motion/schema.js";
import { IllustrationOutput } from "../illustration/schema.js";
import { PresenterOutput } from "../presenter/schema.js";
import { CaptionsOutput } from "../captions/schema.js";
import { MasterTimeline } from "../../../remotion/composition/schema.js";
import { ComposerInputs, ComposerOverrides, RenderSpec } from "./schema.js";
import { buildTimeline } from "./layout.js";
import { composerQA, type QAReport } from "./qa.js";

export * from "./schema.js";
export { buildTimeline, remapBeat, themeForMode } from "./layout.js";
export { composerQA } from "./qa.js";

const here = path.dirname(fileURLToPath(import.meta.url));
export const COMPOSER_AGENT_ROLE = fs.readFileSync(path.join(here, "role.md"), "utf8");
export const COMPOSER_AGENT_MODEL = env("SHORTS_COMPOSER_MODEL", "claude-fable-5-1")!;

export interface ComposeResult {
  timeline: MasterTimeline;
  preview?: string;
  final: string;
  qa: QAReport;
}

export interface ComposerDeps {
  llm?: LLM;
  /** Skip the LLM review pass (deterministic layout only). */
  review?: boolean;
}

/** Composer: gathers artifacts from the project manifest, builds the master timeline, reviews, renders, muxes, QA. */
export class ComposerAgent {
  private readonly llm: LLM;
  private readonly review: boolean;
  constructor(deps: ComposerDeps = {}) {
    this.llm = deps.llm ?? new LLM({ model: COMPOSER_AGENT_MODEL, effort: "high" });
    this.review = deps.review ?? true;
  }

  /** Read every agent artifact the manifest points at. */
  gather(project: Project): ComposerInputs {
    const read = <T>(key: string, parse: (j: unknown) => T, required: boolean): T | null => {
      const a = project.get(key);
      if (!a || a.status !== "ok") {
        if (required) throw new Error(`Composer needs "${key}" (status ${a?.status ?? "missing"})`);
        return null;
      }
      return parse(JSON.parse(fs.readFileSync(path.resolve(project.dir, a.path), "utf8")));
    };
    const script = read("script", (j) => ScriptOutput.parse(j), true)!;
    const audio_timeline = read("audio_timeline", (j) => AudioTimeline.parse(j), true)!;
    const master = project.require("audio_master");
    return ComposerInputs.parse({
      script,
      text: read("text", (j) => TextOutput.parse(j), false),
      audio_timeline,
      master_audio: project.rel(path.resolve(project.dir, master)),
      motion: read("motion", (j) => MotionPlan.parse(j), false),
      illustration: read("illustration", (j) => IllustrationOutput.parse(j), false),
      presenter: read("presenter", (j) => PresenterOutput.parse(j), false),
      captions: read("captions", (j) => CaptionsOutput.parse(j), false),
      brand: project.manifest.brand,
    });
  }

  async buildWithReview(project: Project, inputs: ComposerInputs, spec: RenderSpec): Promise<MasterTimeline> {
    const presenterVideo = inputs.presenter?.video;
    const presenterSrc = presenterVideo ? { src: project.rel(path.resolve(project.dir, presenterVideo.keyed ?? presenterVideo.raw)), alpha: Boolean(presenterVideo.keyed), width: presenterVideo.width, height: presenterVideo.height } : undefined;
    const illustrationSrc: Record<string, { src: string; kind: "image" | "video" }> = {};
    for (const a of inputs.illustration?.assets ?? []) if (a.path && (a.status === "generated" || a.status === "library") && a.kind !== "none") illustrationSrc[a.beat_id] = { src: project.rel(path.resolve(project.dir, a.path)), kind: a.kind };
    const base = { width: spec.width, height: spec.height, fps: spec.fps, presenterSrc, illustrationSrc };
    let timeline = buildTimeline(inputs, base);
    if (!this.review) return timeline;
    log.stage("COMPOSER · review");
    const summary = timeline.scenes.map((s) => ({ beat_id: s.beat_id, start: +s.start.toFixed(2), end: +s.end.toFixed(2), transition: s.transition_in, layers: s.layers.map((l) => `${l.type}${l.type === "text" ? `(${l.element.id} L${l.element.level} "${l.element.text}")` : l.type === "motion" ? `(${l.beat.layers.map((x) => x.kind).join("+")})` : ""}`), caption_slot: s.caption_rect ? (s.caption_rect.y < spec.height * 0.2 ? "top_third" : s.caption_rect.y > spec.height * 0.7 ? "lower_third" : s.layers.some((l) => l.type === "presenter" && l.rect.y > s.caption_rect!.y) ? "above_presenter" : "center") : null, presenter: s.layers.find((l) => l.type === "presenter") ? { scale: +((s.layers.find((l) => l.type === "presenter")!.rect.h / spec.height).toFixed(2)) } : null, reserved: s.reserved.map((r) => r.owner) }));
    const overrides = await this.llm.structured(
      ComposerOverrides,
      `${COMPOSER_AGENT_ROLE}\n\nReview the engine's default layout and return overrides only where they improve the read. Return an entry per scene (empty override = keep). Keep presenter_scale within ±0.08 of the current scale; presenter_hidden only where the Presenter Agent already allows it (never on the first or last scene). Prefer few, deliberate changes.`,
      `Mode: ${inputs.brand.mode}. Presenter plan: ${inputs.presenter ? JSON.stringify(inputs.presenter.plan.beats.map((b) => ({ beat_id: b.beat_id, enabled: b.presenter_enabled, scale: b.scale }))) : "none"}\n\nDefault layout:\n${JSON.stringify(summary, null, 2)}`,
      { effort: "medium" }
    );
    const problems = lintOverrides(overrides, inputs);
    if (problems.length) log.warn(`ignoring invalid composer overrides: ${problems.join("; ")}`);
    const safe: ComposerOverrides = { scenes: overrides.scenes.filter((o) => !problems.some((p) => p.startsWith(o.beat_id + ":"))) };
    timeline = buildTimeline(inputs, { ...base, overrides: safe });
    return timeline;
  }

  async compose(project: Project, opts: { spec?: Partial<RenderSpec>; preview?: boolean; skipRender?: boolean } = {}): Promise<ComposeResult> {
    const spec = RenderSpec.parse({ platform: project.manifest.brand.platform, fps: project.manifest.brand.fps, ...opts.spec });
    log.stage("COMPOSER · gather");
    const inputs = this.gather(project);
    log.stage("COMPOSER · master timeline");
    const timeline = await this.buildWithReview(project, inputs, spec);
    const compDir = project.sub("composition");
    fs.writeFileSync(path.join(compDir, "timeline.json"), JSON.stringify(timeline, null, 2));
    fs.writeFileSync(path.join(compDir, "events.txt"), timeline.events.map((e) => `${e.t.toFixed(2).padStart(7)}  ${e.kind.padEnd(12)} ${e.detail}`).join("\n"));
    project.set("timeline", { path: project.rel(path.join(compDir, "timeline.json")), status: "ok" });
    const renders = project.sub("renders");
    const final = path.join(renders, "final.mp4");
    let preview: string | undefined;
    if (opts.skipRender) return { timeline, final, qa: { passed: false, checks: [{ name: "render", passed: false, detail: "skipped" }] } };

    if (opts.preview) {
      log.stage("COMPOSER · preview render");
      const raw = path.join(renders, "preview_raw.mp4");
      await renderComposition("ComposedShort", { timeline }, project.dir, raw, { concurrency: undefined });
      preview = path.join(renders, "preview.mp4");
      await encode(raw, preview, { ...spec, preview: true }, path.resolve(project.dir, timeline.audio_src));
      project.set("preview", { path: project.rel(preview), status: "ok" });
    }
    log.stage("COMPOSER · final render");
    const raw = path.join(renders, "final_raw.mp4");
    await renderComposition("ComposedShort", { timeline }, project.dir, raw);
    await encode(raw, final, spec, path.resolve(project.dir, timeline.audio_src));
    project.set("final", { path: project.rel(final), status: "ok" });

    log.stage("COMPOSER · QA");
    const qa = await composerQA(final, timeline, spec, inputs.audio_timeline.duration_sec);
    fs.writeFileSync(path.join(project.sub("qa"), "report.json"), JSON.stringify(qa, null, 2));
    project.set("qa", { path: project.rel(path.join(project.sub("qa"), "report.json")), status: qa.passed ? "ok" : "failed", detail: qa.checks.filter((c) => !c.passed).map((c) => `${c.name}: ${c.detail}`).join("; ") });
    return { timeline, preview, final, qa };
  }
}

/** Mux the master audio, encode H.264/AAC in bt709 with faststart. Preview = half size + fast preset. */
export async function encode(rawVideo: string, outFile: string, spec: RenderSpec, audio: string): Promise<void> {
  const w = spec.preview ? spec.width / 2 : spec.width;
  const h = spec.preview ? spec.height / 2 : spec.height;
  const args = ["-y", "-i", rawVideo];
  if (fs.existsSync(audio)) args.push("-i", audio);
  args.push("-map", "0:v:0");
  if (fs.existsSync(audio)) args.push("-map", "1:a:0");
  args.push(
    "-vf", `scale=${w}:${h}:flags=lanczos,fps=${spec.fps},format=yuv420p`,
    "-c:v", "libx264", "-profile:v", "high", "-preset", spec.preview ? "veryfast" : "medium", "-crf", String(spec.preview ? 26 : spec.crf),
    "-color_primaries", "bt709", "-color_trc", "bt709", "-colorspace", "bt709",
    "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-shortest", "-movflags", "+faststart", outFile
  );
  const r = await run(ffmpegBin(), args);
  if (r.code !== 0) throw new Error(`encode failed: ${r.stderr.slice(-1500)}`);
  const info = await probe(outFile);
  if (!info.has_video) throw new Error("encoded file has no video");
}

export function lintOverrides(o: ComposerOverrides, inputs: ComposerInputs): string[] {
  const p: string[] = [];
  const first = inputs.script.beats[0].id;
  const last = inputs.script.beats[inputs.script.beats.length - 1].id;
  for (const s of o.scenes) {
    const pb = inputs.presenter?.plan.beats.find((b) => b.beat_id === s.beat_id);
    if (!inputs.script.beats.some((b) => b.id === s.beat_id)) p.push(`${s.beat_id}: unknown beat`);
    if (s.presenter_hidden && (s.beat_id === first || s.beat_id === last)) p.push(`${s.beat_id}: cannot hide the presenter on the first/last scene`);
    if (s.presenter_scale !== undefined && pb && Math.abs(s.presenter_scale - pb.scale) > 0.08) p.push(`${s.beat_id}: presenter_scale ${s.presenter_scale} is more than 0.08 from the plan (${pb.scale})`);
    if (s.drop_text_ids.some((id) => inputs.text?.elements.find((e) => e.id === id)?.level === 1)) p.push(`${s.beat_id}: cannot drop a level-1 headline`);
  }
  return p;
}
