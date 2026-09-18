import fs from "node:fs";
import path from "node:path";
import { log } from "../core/log.js";
import { env } from "../core/env.js";
import type { ProjectState, ShortRequest } from "../core/project.js";
import type { Scene } from "../core/scene.js";
import { getModePreset } from "../presets/modes.js";
import { PresenterProfileStore } from "../config/presenters.js";
import { VoiceConfigStore } from "../config/voices.js";
import type { VoiceProvider } from "../providers/voice/VoiceProvider.js";
import type { AvatarVideoProvider } from "../providers/avatar/AvatarVideoProvider.js";
import type { VisualAssetProvider } from "../providers/visuals/VisualAssetProvider.js";
import { LLM } from "../providers/llm/llm.js";
import { researchAgent } from "../agents/research.js";
import { hookAgent } from "../agents/hooks.js";
import { scriptAgent } from "../agents/script.js";
import { factCheckAgent } from "../agents/factCheck.js";
import { visualDirectorAgent } from "../agents/visualDirector.js";
import { retentionAgent, applyRetentionAdjustments } from "../agents/retention.js";
import { metadataAgent } from "../agents/metadata.js";
import { concatAudio, ensureDir, postProcessAudio, finalizeMp4 } from "../media/ffmpeg.js";
import { estimateCaptionTrack, captionTrackFromTranscription, toSrt, fillSceneCaptions } from "../media/captions.js";
import { renderShort } from "../media/render.js";
import { technicalQA } from "./qa.js";
import type { ShortProps } from "../../remotion/props.js";

/**
 * Dependencies the pipeline needs. Only generic interfaces – the pipeline
 * (and the Shorts Director above it) never import LongCat or VoiceStudio.
 */
export interface PipelineDeps {
  llm: LLM;
  voice: VoiceProvider;
  avatar: AvatarVideoProvider;
  visuals: VisualAssetProvider;
  presenters: PresenterProfileStore;
  voices: VoiceConfigStore;
}

export interface PipelineOptions {
  outputRoot?: string;
  /** Skip the avatar stage even if a provider is configured (renders presenter-less). */
  skipPresenter?: boolean;
  /** Stop after a stage (for debugging): "script" | "scenes" | "audio" | "presenter" | "render". */
  stopAfter?: "script" | "scenes" | "audio" | "presenter" | "render";
  /** Resume from an existing project.json. */
  resumeFrom?: string;
}

export async function runPipeline(request: ShortRequest, deps: PipelineDeps, opts: PipelineOptions = {}): Promise<ProjectState> {
  const outputRoot = opts.outputRoot ?? env("SHORTS_OUTPUT_DIR", "./output")!;
  let project: ProjectState;
  if (opts.resumeFrom) {
    project = JSON.parse(fs.readFileSync(opts.resumeFrom, "utf8")) as ProjectState;
    log.info(`resuming project ${project.id}`);
  } else {
    const id = `${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}-${slug(request.topic)}`;
    project = { id, created_at: new Date().toISOString(), request, stage_log: [] };
  }
  const dir = path.resolve(outputRoot, project.id);
  ensureDir(dir);
  const save = () => fs.writeFileSync(path.join(dir, "project.json"), JSON.stringify(project, null, 2));
  const mark = (stage: string, status: "ok" | "skipped" | "failed", detail?: string) => {
    project.stage_log.push({ stage, status, detail, at: new Date().toISOString() });
    save();
  };
  save();

  const preset = getModePreset(request.mode);
  const presenterProfile = deps.presenters.get(request.presenter_id);
  const voiceConfig = deps.voices.get(request.voice_id);
  const presenterWanted = !opts.skipPresenter && deps.avatar.name !== "none";

  // ---- 1. Research ----
  if (!project.research) {
    log.stage("RESEARCH");
    project.research = await researchAgent(deps.llm, request);
    mark("research", "ok", `${project.research?.key_facts.length ?? 0} facts`);
  }
  // ---- 2. Hooks ----
  if (!project.hooks) {
    log.stage("HOOKS");
    project.hooks = await hookAgent(deps.llm, request, project.research!);
    mark("hooks", "ok", project.hooks.hooks[project.hooks.selected_index]?.text);
  }
  // ---- 3. Script ----
  if (!project.script) {
    log.stage("SCRIPT");
    project.script = await scriptAgent(deps.llm, request, project.research!, project.hooks);
    mark("script", "ok", `${project.script.beats.length} beats, ~${project.script.estimated_total_seconds}s`);
  }
  // ---- 4. Fact check ----
  if (!project.fact_check) {
    log.stage("FACT CHECK");
    project.fact_check = await factCheckAgent(deps.llm, project.script, project.research!);
    if (project.fact_check.verdict === "revise" && project.fact_check.revised_script) {
      log.warn(`fact check requested revisions (${project.fact_check.issues.length} issues); using revised script`);
      project.script = project.fact_check.revised_script;
    }
    mark("fact_check", "ok", project.fact_check.verdict);
  }
  if (opts.stopAfter === "script") return project;

  // ---- 5. Visual Director ----
  if (!project.scenes) {
    log.stage("VISUAL DIRECTOR");
    project.scenes = await visualDirectorAgent(deps.llm, request, preset, project.script, presenterProfile, presenterWanted);
    mark("visual_director", "ok", `${project.scenes.length} scenes`);
  }
  if (opts.stopAfter === "scenes") return project;

  // ---- 6/7. Voice → narration audio (runs in parallel with visual asset resolution) ----
  const audioDir = path.join(dir, "audio");
  ensureDir(audioDir);
  const narrationTask = (async () => {
    if (project.narration) return;
    log.stage(`VOICE (${deps.voice.name} / ${voiceConfig.id})`);
    const h = await deps.voice.health();
    if (!h.ok) throw new Error(`Voice provider unavailable: ${h.detail}`);
    const segments: NonNullable<ProjectState["narration"]>["segments"] = [];
    for (const s of project.scenes!) {
      const raw = path.join(audioDir, `scene_${String(s.scene_id).padStart(2, "0")}.${voiceConfig.output_format}`);
      const r = await deps.voice.synthesize({ text: s.narration, voice: voiceConfig, outPath: raw });
      segments.push({ scene_id: s.scene_id, path: raw, duration_sec: r.duration_sec });
      log.info(`scene ${s.scene_id}: ${r.duration_sec.toFixed(2)}s`);
    }
    const joined = path.join(audioDir, "narration_raw.wav");
    const { offsets, total } = await concatAudio(segments.map((s) => s.path), joined, 0.25);
    const finalAudio = path.join(audioDir, "narration.wav");
    await postProcessAudio(joined, finalAudio, { pitchSemitones: voiceConfig.pitch_semitones, gainDb: voiceConfig.gain_db, loudnorm: true });
    // Lock scene timing to the measured audio.
    project.scenes = project.scenes!.map((s, i) => ({ ...s, start_time: offsets[i], duration: segments[i].duration_sec + (i < segments.length - 1 ? 0.25 : 0) }));
    project.narration = { audio_path: finalAudio, duration_sec: total, provider: deps.voice.name, voice_id: voiceConfig.id, segments };
    mark("voice", "ok", `${total.toFixed(1)}s narration`);
  })();

  const assetsDir = path.join(dir, "assets");
  ensureDir(assetsDir);
  const assets: ShortProps["assets"] = {};
  const visualsTask = (async () => {
    log.stage(`VISUALS (${deps.visuals.name})`);
    for (const s of project.scenes!) {
      const needsAsset = ["broll", "image", "ai_visual", "screen_recording"].includes(s.main_visual.type) || s.main_visual.asset;
      if (!needsAsset) continue;
      const r = await deps.visuals.resolve({ sceneId: s.scene_id, visual: s.main_visual, durationSec: s.duration, outDir: assetsDir, width: preset.width, height: Math.round(preset.height * 0.55) });
      if (r.path && r.kind !== "none") {
        const dest = path.join(assetsDir, `scene_${s.scene_id}${path.extname(r.path)}`);
        if (path.resolve(r.path) !== path.resolve(dest)) fs.copyFileSync(r.path, dest);
        assets[String(s.scene_id)] = { src: path.relative(dir, dest), kind: r.kind };
      } else {
        log.info(`scene ${s.scene_id}: no ${s.main_visual.type} asset available, renderer will use a generated graphic`);
      }
    }
    mark("visuals", "ok", `${Object.keys(assets).length} assets`);
  })();

  await Promise.all([narrationTask, visualsTask]);
  if (opts.stopAfter === "audio") return project;

  // ---- 8. Speaking presenter (must wait for the final approved narration audio) ----
  if (presenterWanted && !project.presenter_video) {
    log.stage(`PRESENTER (${deps.avatar.name} / ${presenterProfile.id})`);
    const h = await deps.avatar.health();
    if (!h.ok) {
      log.warn(`avatar provider unavailable: ${h.detail}. Rendering without presenter.`);
      mark("presenter", "skipped", h.detail);
      project.scenes = project.scenes!.map((s) => ({ ...s, presenter: { ...s.presenter, enabled: false } }));
    } else {
      const prompt = deps.presenters.buildAvatarPrompt(presenterProfile, preset.presenter.prompt_hints);
      const style = deps.presenters.loadStyle();
      const r = await deps.avatar.generate({
        referenceImage: deps.presenters.referenceImagePath(presenterProfile),
        audioPath: project.narration!.audio_path,
        prompt,
        negativePrompt: style.negative_prompt,
        outDir: dir,
        durationSec: project.narration!.duration_sec,
        resolution: style.resolution,
        aspectRatio: "16:9",
        onLog: (l) => process.stdout.write(l),
      });
      const dest = path.join(dir, "presenter.mp4");
      fs.copyFileSync(r.path, dest);
      project.presenter_video = { path: dest, width: r.width, height: r.height, fps: r.fps, duration_sec: r.duration_sec, provider: r.provider };
      mark("presenter", "ok", `${r.duration_sec.toFixed(1)}s ${r.width}x${r.height}`);
    }
  } else if (!presenterWanted) {
    project.scenes = project.scenes!.map((s) => ({ ...s, presenter: { ...s.presenter, enabled: false } }));
  }
  if (opts.stopAfter === "presenter") return project;

  // ---- 9. Captions ----
  if (!project.captions) {
    log.stage("CAPTIONS");
    const estimated = estimateCaptionTrack(project.scenes!);
    let track = estimated;
    if (deps.voice.transcribe) {
      try {
        const t = await deps.voice.transcribe(project.narration!.audio_path, request.language);
        track = captionTrackFromTranscription(t, estimated);
      } catch (e) {
        log.warn(`transcription unavailable, using estimated timings: ${(e as Error).message}`);
      }
    }
    project.captions = track;
    project.scenes = fillSceneCaptions(project.scenes!);
    fs.writeFileSync(path.join(dir, "captions.srt"), toSrt(track));
    mark("captions", "ok", `${track.words.length} words (${track.source})`);
  }

  // ---- 10. Retention review ----
  if (!project.retention) {
    log.stage("RETENTION REVIEW");
    project.retention = await retentionAgent(deps.llm, project.scenes!, project.narration!.duration_sec);
    project.scenes = applyRetentionAdjustments(project.scenes!, project.retention);
    mark("retention", "ok", `score ${project.retention.score}, approved=${project.retention.approved}`);
  }

  // ---- 11. Metadata (independent of render; run alongside) ----
  const metadataTask = project.metadata ? Promise.resolve() : metadataAgent(deps.llm, request, project.script!).then((m) => { project.metadata = m; mark("metadata", "ok", m.title); });

  // ---- 12. Render (Remotion) + finalize (FFmpeg) ----
  if (!project.final_mp4) {
    log.stage("RENDER");
    const style = deps.presenters.loadStyle();
    const props: ShortProps = {
      preset,
      topic: request.topic,
      scenes: project.scenes!,
      narration: { src: path.relative(dir, project.narration!.audio_path), duration_sec: project.narration!.duration_sec },
      presenter: project.presenter_video
        ? { src: path.relative(dir, project.presenter_video.path), width: project.presenter_video.width, height: project.presenter_video.height, fps: project.presenter_video.fps, duration_sec: project.presenter_video.duration_sec, crop: style.crop, feather_px: style.blend.feather_px, vignette: style.blend.vignette, color_grade: style.blend.color_grade }
        : undefined,
      assets,
      captions: project.captions!,
      music: preset.audio.music ? { src: preset.audio.music, volume_db: preset.audio.music_volume_db } : undefined,
    };
    fs.writeFileSync(path.join(dir, "render-props.json"), JSON.stringify(props, null, 2));
    const rendered = await renderShort(props, dir, path.join(dir, "render.mp4"));
    const finalPath = path.join(dir, "final.mp4");
    await finalizeMp4(rendered, finalPath, { width: preset.width, height: preset.height, fps: preset.fps });
    project.final_mp4 = finalPath;
    mark("render", "ok", finalPath);
  }
  await metadataTask;
  if (opts.stopAfter === "render") return project;

  // ---- 13. QA ----
  log.stage("QA");
  project.qa = await technicalQA(project.final_mp4, preset, project);
  mark("qa", project.qa.passed ? "ok" : "failed", project.qa.checks.filter((c) => !c.passed).map((c) => `${c.name}: ${c.detail}`).join("; ") || "all checks passed");
  if (project.metadata) fs.writeFileSync(path.join(dir, "metadata.json"), JSON.stringify(project.metadata, null, 2));
  save();
  return project;
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "short";
}

export function sceneSummary(scenes: Scene[]): string {
  return scenes.map((s) => `#${s.scene_id} ${s.duration.toFixed(1)}s presenter=${s.presenter.enabled ? `${s.presenter.position}/${s.presenter.size}` : "off"} visual=${s.main_visual.type}`).join("\n");
}
