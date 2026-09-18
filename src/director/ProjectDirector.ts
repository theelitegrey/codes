import fs from "node:fs";
import path from "node:path";
import { log } from "../core/log.js";
import { env } from "../core/env.js";
import { LLM } from "../providers/llm/llm.js";
import { Project, type BrandSettings } from "../project/manifest.js";
import { PresenterProfileStore } from "../config/presenters.js";
import { VoiceConfigStore } from "../config/voices.js";
import { parseModeFromText } from "../presets/modes.js";
import { parseDurationFromText } from "../agents/legacy/intake.js";
import { ScriptAgent, writeScriptArtifacts, type ScriptAgentInput } from "../agents/script/index.js";
import { TextAgent, writeTextArtifacts } from "../agents/text/index.js";
import { AudioAgent } from "../agents/audio/index.js";
import { MotionAgent, writeMotionArtifacts } from "../agents/motion/index.js";
import { IllustrationAgent } from "../agents/illustration/index.js";
import { PresenterAgent } from "../agents/presenter/index.js";
import { CaptionsAgent, type CaptionStyleName } from "../agents/captions/index.js";
import { ComposerAgent, type ComposeResult } from "../agents/composer/index.js";

/**
 * Director: turns one instruction into a project and runs the agent DAG
 * through the shared manifest.
 *
 *   SCRIPT → (TEXT ‖ AUDIO ‖ MOTION) → PRESENTER (after AUDIO) → ILLUSTRATION → CAPTIONS → COMPOSER → QA
 */
export interface DirectorAgents {
  script?: ScriptAgent;
  text?: TextAgent;
  audio?: AudioAgent;
  motion?: MotionAgent;
  illustration?: IllustrationAgent;
  presenter?: PresenterAgent;
  captions?: CaptionsAgent;
  composer?: ComposerAgent;
}

export interface DirectorOptions {
  outputRoot?: string;
  brand?: Partial<BrandSettings>;
  scriptInput?: Partial<ScriptAgentInput>;
  /** Stop after this stage. */
  stopAfter?: "script" | "parallel" | "presenter" | "illustration" | "captions" | "compose";
  preview?: boolean;
  generateIllustrations?: boolean;
}

export class ProjectDirector {
  private readonly a: Required<DirectorAgents>;
  constructor(agents: DirectorAgents = {}) {
    const llm = new LLM();
    this.a = {
      script: agents.script ?? new ScriptAgent(llm),
      text: agents.text ?? new TextAgent(llm),
      audio: agents.audio ?? new AudioAgent({ llm }),
      motion: agents.motion ?? new MotionAgent(),
      illustration: agents.illustration ?? new IllustrationAgent(),
      presenter: agents.presenter ?? new PresenterAgent({ llm }),
      captions: agents.captions ?? new CaptionsAgent(),
      composer: agents.composer ?? new ComposerAgent(),
    };
  }

  /** Resolve brand settings from the instruction + config stores. */
  static brandFromInstruction(instruction: string, overrides: Partial<BrandSettings> = {}): Partial<BrandSettings> {
    const presenters = new PresenterProfileStore();
    const voices = new VoiceConfigStore();
    const presenter = presenters.resolveFromText(instruction);
    const voice = voices.resolveFromText(instruction);
    const mode = parseModeFromText(instruction);
    return { presenter_id: presenter?.id ?? presenters.loadRegistry().default, voice_id: voice?.id ?? presenter?.default_voice_id, mode: mode ?? "PODCAST_SHORT", ...overrides };
  }

  async produce(instruction: string, opts: DirectorOptions = {}): Promise<{ project: Project; result?: ComposeResult }> {
    const root = opts.outputRoot ?? path.join(env("SHORTS_OUTPUT_DIR", "./output")!, "projects");
    const brand = ProjectDirector.brandFromInstruction(instruction, opts.brand);
    const project = Project.create(root, instruction, brand);
    log.info(`project ${project.manifest.id} → ${project.dir}`);
    const topic = instruction;
    const duration = parseDurationFromText(instruction) ?? opts.scriptInput?.duration_sec ?? 45;

    // 1. Script
    log.stage("DIRECTOR · script");
    const scriptArt = await this.a.script.run({ topic, duration_sec: duration, ...opts.scriptInput });
    writeScriptArtifacts(project.sub("script"), scriptArt);
    project.set("script", { path: "script/script.json", status: "ok", detail: `${scriptArt.script.beats.length} beats` });
    project.note("script", `hook: ${scriptArt.script.hook}`);
    if (opts.stopAfter === "script") return { project };
    const script = scriptArt.script;

    // 2. Text ‖ Audio ‖ Motion
    log.stage("DIRECTOR · text ‖ audio ‖ motion");
    const [textR, audioR, motionR] = await Promise.allSettled([
      this.a.text.run({ script, brand: project.manifest.brand.style_brief }),
      this.a.audio.run({ script, voice_id: project.manifest.brand.voice_id, category: "educational" }, project.sub("audio")),
      this.a.motion.run({ script, style: project.manifest.brand.style_brief }),
    ]);
    if (textR.status === "fulfilled") {
      writeTextArtifacts(project.sub("text"), textR.value);
      project.set("text", { path: "text/text.json", status: "ok", detail: `${textR.value.elements.length} elements` });
    } else project.set("text", { path: "text/text.json", status: "failed", detail: String(textR.reason) });
    if (audioR.status !== "fulfilled") throw new Error(`Audio Agent failed: ${audioR.reason}`);
    project.set("audio_timeline", { path: "audio/timeline.json", status: "ok" });
    project.set("audio_narration", { path: project.rel(audioR.value.narration_path), status: "ok", detail: `${audioR.value.timeline.duration_sec.toFixed(1)}s` });
    project.set("audio_master", { path: project.rel(audioR.value.master_path), status: audioR.value.report.passed ? "ok" : "ok", detail: audioR.value.report.passed ? "loudness OK" : audioR.value.report.notes.join("; ") });
    if (motionR.status === "fulfilled") {
      // Re-time the motion plan to the measured beats now that audio exists.
      writeMotionArtifacts(project.sub("motion"), motionR.value);
      project.set("motion", { path: "motion/motion.json", status: "ok", detail: `${motionR.value.beats.length} beats` });
    } else project.set("motion", { path: "motion/motion.json", status: "failed", detail: String(motionR.reason) });
    if (opts.stopAfter === "parallel") return { project };

    // 3. Presenter (needs the FINAL narration)
    log.stage("DIRECTOR · presenter");
    const fullframe = motionR.status === "fulfilled" ? motionR.value.beats.filter((b) => b.layers.some((l) => l.kind === "CandlestickChart")).map((b) => b.beat_id) : [];
    try {
      const pres = await this.a.presenter.run({ script, audio_timeline: audioR.value.timeline, narration_path: audioR.value.narration_path, profile_id: project.manifest.brand.presenter_id, mode: project.manifest.brand.mode, fullframe_beat_ids: fullframe.slice(0, 1), background_mode: "auto", generate: true, notes: "" }, project.sub("presenter"));
      fs.writeFileSync(path.join(project.sub("presenter"), "presenter_output.json"), JSON.stringify(pres, null, 2));
      project.set("presenter", { path: "presenter/presenter_output.json", status: pres.status === "generated" ? "ok" : "skipped", detail: pres.detail });
    } catch (e) {
      project.set("presenter", { path: "presenter/presenter_output.json", status: "failed", detail: (e as Error).message });
      log.warn(`presenter failed: ${(e as Error).message}`);
    }
    if (opts.stopAfter === "presenter") return { project };

    // 4. Illustration
    log.stage("DIRECTOR · illustration");
    try {
      const motionIds = motionR.status === "fulfilled" ? motionR.value.beats.map((b) => b.beat_id) : [];
      const textIds = textR.status === "fulfilled" ? [...new Set(textR.value.elements.filter((e) => e.level === 1).map((e) => e.beat_id))] : [];
      await this.a.illustration.run({ script, motion_beat_ids: motionIds, text_beat_ids: textIds, style: project.manifest.brand.style_brief, generate: Boolean(opts.generateIllustrations) }, project.sub("illustration"));
      project.set("illustration", { path: "illustration/illustration.json", status: "ok" });
    } catch (e) {
      project.set("illustration", { path: "illustration/illustration.json", status: "failed", detail: (e as Error).message });
      log.warn(`illustration failed: ${(e as Error).message}`);
    }
    if (opts.stopAfter === "illustration") return { project };

    // 5. Captions
    log.stage("DIRECTOR · captions");
    try {
      await this.a.captions.run({ narration_path: audioR.value.narration_path, audio_timeline: audioR.value.timeline, script, style: project.manifest.brand.caption_style as CaptionStyleName, language: "en", notes: "" }, project.sub("captions"));
      project.set("captions", { path: "captions/captions.json", status: "ok" });
    } catch (e) {
      project.set("captions", { path: "captions/captions.json", status: "failed", detail: (e as Error).message });
      log.warn(`captions failed: ${(e as Error).message}`);
    }
    if (opts.stopAfter === "captions") return { project };

    // 6. Compose + QA
    log.stage("DIRECTOR · compose");
    const result = await this.a.composer.compose(project, { preview: opts.preview });
    project.note("composer", `final ${result.final} QA ${result.qa.passed ? "PASS" : "FAIL"}`);
    return { project, result };
  }
}
