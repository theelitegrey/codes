import fs from "node:fs";
import path from "node:path";
import { env, envBool, envInt } from "../../core/env.js";
import { commandExists, ensureDir, probe, run, toWav16kMono } from "../../media/ffmpeg.js";
import type { ProviderHealth } from "../voice/VoiceProvider.js";
import type { AvatarCapabilities, AvatarGenerationRequest, AvatarGenerationResult, AvatarResolution, AvatarVideoProvider } from "./AvatarVideoProvider.js";

/**
 * LongCat-Video-Avatar-1.5 (meituan-longcat, MIT-licensed weights).
 *
 * Validated against https://github.com/meituan-longcat/LongCat-Video (README
 * + run_demo_avatar_single_audio_to_video.py) and the Hugging Face model card
 * meituan-longcat/LongCat-Video-Avatar-1.5:
 *
 *  - There is NO hosted inference endpoint (no HF Inference API / serverless
 *    support). Inference is a local `torchrun` job inside the cloned repo.
 *  - Inputs: a JSON file {"prompt", "cond_image", "cond_audio": {"person1": <audio>}}
 *    (`assets/avatar/single_example_1.json`). Audio is loaded with librosa at
 *    16 kHz; vocals are separated first (Kim_Vocal_2.onnx), so speech-only
 *    narration is ideal.
 *  - Modes: --stage_1=ai2v (audio+image→video, what we use for a consistent
 *    presenter) or at2v (audio+text→video).
 *  - v1.5 requires --use_distill (8 steps, cfg 1.0) and --model_type avatar-v1.5;
 *    --use_int8 loads the INT8 DiT for lower VRAM.
 *  - Output: 25 fps; --resolution 480p → 832x480, 720p → 1280x768 (landscape).
 *    One segment = 93 frames (3.72 s); each extra segment (--num_segments)
 *    adds 93-13 = 80 new frames (3.2 s) via video continuation.
 *  - Files are written by save_video_ffmpeg to <output_dir>/ai2v_demo_1.mp4
 *    (or at2v_demo_1.mp4) for the first segment and
 *    <output_dir>/video_continue_<n>.mp4 for the cumulative long video.
 *  - Hardware: README examples use torchrun --nproc_per_node=2 with
 *    --context_parallel_size=2 (multi-GPU context parallel), bf16 + flash-attn 2,
 *    CUDA 12.4. The model card does not publish an exact VRAM figure; INT8 +
 *    480p is the lowest-memory documented configuration.
 *
 * Execution modes (LONGCAT_EXEC_MODE):
 *  - local:   spawn torchrun in LONGCAT_REPO_DIR on this machine.
 *  - ssh:     copy inputs to a GPU host, run the same command there, copy back.
 *  - command: run a user-supplied template (e.g. a job-queue submit script).
 */
export interface LongCatOptions {
  repoDir?: string;
  checkpointDir?: string;
  python?: string;
  nproc?: number;
  resolution?: AvatarResolution;
  useInt8?: boolean;
  execMode?: "local" | "ssh" | "command";
  sshHost?: string;
  sshUser?: string;
  commandTemplate?: string;
  /** Reference image index for long-video consistency (README: 0–24 for consistency, 30 to reduce repetition). */
  refImgIndex?: number;
  maskFrameRange?: number;
}

export const LONGCAT_FPS = 25;
export const LONGCAT_FRAMES_PER_SEGMENT = 93;
export const LONGCAT_COND_FRAMES = 13;

export const LONGCAT_RESOLUTIONS: Record<"480p" | "720p", { width: number; height: number }> = {
  "480p": { width: 832, height: 480 },
  "720p": { width: 1280, height: 768 },
};

/** Number of continuation segments needed to cover `durationSec` (from the demo script's math). */
export function segmentsForDuration(durationSec: number): number {
  const first = LONGCAT_FRAMES_PER_SEGMENT / LONGCAT_FPS; // 3.72 s
  const extra = (LONGCAT_FRAMES_PER_SEGMENT - LONGCAT_COND_FRAMES) / LONGCAT_FPS; // 3.2 s
  if (durationSec <= first) return 1;
  return 1 + Math.ceil((durationSec - first) / extra);
}

export function generatedDuration(numSegments: number): number {
  return LONGCAT_FRAMES_PER_SEGMENT / LONGCAT_FPS + (numSegments - 1) * ((LONGCAT_FRAMES_PER_SEGMENT - LONGCAT_COND_FRAMES) / LONGCAT_FPS);
}

export interface LongCatInputJson {
  prompt: string;
  cond_image: string;
  cond_audio: { person1: string };
}

export class LongCatAvatarProvider implements AvatarVideoProvider {
  readonly name = "longcat";
  private readonly o: Required<Omit<LongCatOptions, "sshHost" | "sshUser" | "commandTemplate">> & Pick<LongCatOptions, "sshHost" | "sshUser" | "commandTemplate">;

  constructor(opts: LongCatOptions = {}) {
    this.o = {
      repoDir: opts.repoDir ?? env("LONGCAT_REPO_DIR", "/opt/LongCat-Video")!,
      checkpointDir: opts.checkpointDir ?? env("LONGCAT_CHECKPOINT_DIR", "/opt/LongCat-Video/weights/LongCat-Video-Avatar-1.5")!,
      python: opts.python ?? env("LONGCAT_PYTHON", "python")!,
      nproc: opts.nproc ?? envInt("LONGCAT_NPROC", 2),
      resolution: opts.resolution ?? ((env("LONGCAT_RESOLUTION", "480p") as AvatarResolution) ?? "480p"),
      useInt8: opts.useInt8 ?? envBool("LONGCAT_USE_INT8", true),
      execMode: opts.execMode ?? ((env("LONGCAT_EXEC_MODE", "local") as "local" | "ssh" | "command") ?? "local"),
      refImgIndex: opts.refImgIndex ?? 10,
      maskFrameRange: opts.maskFrameRange ?? 3,
      sshHost: opts.sshHost ?? env("LONGCAT_SSH_HOST"),
      sshUser: opts.sshUser ?? env("LONGCAT_SSH_USER"),
      commandTemplate: opts.commandTemplate ?? env("LONGCAT_COMMAND_TEMPLATE"),
    };
  }

  capabilities(): AvatarCapabilities {
    return {
      audio_driven: true,
      resolutions: ["480p", "720p"],
      native_aspect_ratios: ["16:9"],
      fps: [LONGCAT_FPS],
      max_duration_sec: 600,
      supports_negative_prompt: false, // hard-coded inside the demo script
      supports_seed: false, // global_seed = 42 inside the demo script
      runtime: this.o.execMode === "local" ? "local_gpu" : "remote_gpu",
    };
  }

  async health(): Promise<ProviderHealth> {
    const info: Record<string, unknown> = { execMode: this.o.execMode, repoDir: this.o.repoDir, checkpointDir: this.o.checkpointDir, nproc: this.o.nproc, resolution: this.o.resolution, int8: this.o.useInt8 };
    if (this.o.execMode === "command") {
      return this.o.commandTemplate ? { ok: true, detail: "custom command template configured", info } : { ok: false, detail: "LONGCAT_EXEC_MODE=command but LONGCAT_COMMAND_TEMPLATE is empty", info };
    }
    if (this.o.execMode === "ssh") {
      if (!this.o.sshHost) return { ok: false, detail: "LONGCAT_EXEC_MODE=ssh but LONGCAT_SSH_HOST is empty", info };
      const r = await run("ssh", [this.sshTarget(), "test", "-f", `${this.o.repoDir}/run_demo_avatar_single_audio_to_video.py`]).catch(() => ({ code: 1, stdout: "", stderr: "ssh missing" }));
      return r.code === 0 ? { ok: true, detail: `LongCat repo present on ${this.sshTarget()}`, info } : { ok: false, detail: `Cannot verify LongCat repo on ${this.sshTarget()}: ${r.stderr.trim()}`, info };
    }
    const script = path.join(this.o.repoDir, "run_demo_avatar_single_audio_to_video.py");
    if (!fs.existsSync(script)) return { ok: false, detail: `LongCat-Video repo not found at ${this.o.repoDir} (clone https://github.com/meituan-longcat/LongCat-Video)`, info };
    if (!fs.existsSync(path.join(this.o.checkpointDir, "whisper-large-v3"))) return { ok: false, detail: `Checkpoint dir ${this.o.checkpointDir} is missing whisper-large-v3 (run: huggingface-cli download meituan-longcat/LongCat-Video-Avatar-1.5 --local-dir ${this.o.checkpointDir})`, info };
    if (!fs.existsSync(path.join(this.o.checkpointDir, "..", "LongCat-Video"))) return { ok: false, detail: `Base model missing: the demo script loads tokenizer/text_encoder/vae from ${path.resolve(this.o.checkpointDir, "..", "LongCat-Video")} (huggingface-cli download meituan-longcat/LongCat-Video --local-dir <that path>)`, info };
    if (!(await commandExists("torchrun"))) return { ok: false, detail: "torchrun not on PATH (activate the longcat-video conda env)", info };
    return { ok: true, detail: "LongCat-Video repo, checkpoints and torchrun found", info };
  }

  private sshTarget(): string {
    return this.o.sshUser ? `${this.o.sshUser}@${this.o.sshHost}` : String(this.o.sshHost);
  }

  /** Builds the documented input JSON. Exposed for tests. */
  static buildInputJson(prompt: string, condImage: string, condAudio: string): LongCatInputJson {
    return { prompt, cond_image: condImage, cond_audio: { person1: condAudio } };
  }

  /** Builds the torchrun argv exactly as documented in the README (ai2v + distill + v1.5). Exposed for tests. */
  static buildArgs(o: { nproc: number; checkpointDir: string; inputJson: string; outputDir: string; resolution: string; numSegments: number; useInt8: boolean; refImgIndex: number; maskFrameRange: number }): string[] {
    const args = [
      `--nproc_per_node=${o.nproc}`,
      "run_demo_avatar_single_audio_to_video.py",
      `--context_parallel_size=${o.nproc}`,
      `--checkpoint_dir=${o.checkpointDir}`,
      "--stage_1=ai2v",
      `--input_json=${o.inputJson}`,
      `--output_dir=${o.outputDir}`,
      `--resolution=${o.resolution}`,
      `--num_segments=${o.numSegments}`,
      `--ref_img_index=${o.refImgIndex}`,
      `--mask_frame_range=${o.maskFrameRange}`,
      "--use_distill",
      "--model_type",
      "avatar-v1.5",
    ];
    if (o.useInt8) args.push("--use_int8");
    return args;
  }

  /** Locate the final output written by save_video_ffmpeg. */
  static findOutput(outputDir: string, numSegments: number): string | undefined {
    const candidates = numSegments > 1 ? [`video_continue_${numSegments}.mp4`, "ai2v_demo_1.mp4"] : ["ai2v_demo_1.mp4"];
    for (const c of candidates) {
      const p = path.join(outputDir, c);
      if (fs.existsSync(p)) return p;
    }
    if (!fs.existsSync(outputDir)) return undefined;
    const mp4s = fs
      .readdirSync(outputDir)
      .filter((f) => f.endsWith(".mp4"))
      .map((f) => ({ f, m: fs.statSync(path.join(outputDir, f)).mtimeMs }))
      .sort((a, b) => b.m - a.m);
    return mp4s[0] ? path.join(outputDir, mp4s[0].f) : undefined;
  }

  async generate(req: AvatarGenerationRequest): Promise<AvatarGenerationResult> {
    const resolution = (req.resolution === "1080p" ? "720p" : req.resolution) ?? this.o.resolution;
    if (resolution !== "480p" && resolution !== "720p") throw new Error(`LongCat supports 480p or 720p, got ${resolution}`);
    const jobDir = path.resolve(req.outDir, "longcat");
    ensureDir(jobDir);
    const outputDir = path.join(jobDir, "out");
    ensureDir(outputDir);

    // Audio: 16 kHz mono WAV; the script pads with silence to the generated length.
    const audio16k = path.join(jobDir, "narration_16k.wav");
    await toWav16kMono(req.audioPath, audio16k);
    const image = path.join(jobDir, `reference${path.extname(req.referenceImage) || ".png"}`);
    fs.copyFileSync(req.referenceImage, image);

    const numSegments = segmentsForDuration(req.durationSec);
    const inputJsonPath = path.join(jobDir, "input.json");
    const log = (l: string) => req.onLog?.(l);

    let localResultPath: string | undefined;
    if (this.o.execMode === "ssh") {
      const remoteDir = `/tmp/shorts-longcat/${path.basename(req.outDir)}-${Date.now()}`;
      const target = this.sshTarget();
      const remoteOut = `${remoteDir}/out`;
      fs.writeFileSync(inputJsonPath, JSON.stringify(LongCatAvatarProvider.buildInputJson(req.prompt, `${remoteDir}/${path.basename(image)}`, `${remoteDir}/${path.basename(audio16k)}`), null, 2));
      let r = await run("ssh", [target, "mkdir", "-p", remoteOut]);
      if (r.code !== 0) throw new Error(`ssh mkdir failed: ${r.stderr}`);
      r = await run("scp", [inputJsonPath, image, audio16k, `${target}:${remoteDir}/`]);
      if (r.code !== 0) throw new Error(`scp upload failed: ${r.stderr}`);
      const args = LongCatAvatarProvider.buildArgs({ nproc: this.o.nproc, checkpointDir: this.o.checkpointDir, inputJson: `${remoteDir}/input.json`, outputDir: remoteOut, resolution, numSegments, useInt8: this.o.useInt8, refImgIndex: this.o.refImgIndex, maskFrameRange: this.o.maskFrameRange });
      const remoteCmd = `cd ${shellQuote(this.o.repoDir)} && torchrun ${args.map(shellQuote).join(" ")}`;
      log(`[longcat/ssh] ${remoteCmd}\n`);
      r = await run("ssh", [target, remoteCmd], { onLine: log });
      if (r.code !== 0) throw new Error(`Remote LongCat run failed (exit ${r.code}): ${r.stderr.slice(-3000)}`);
      const remoteFile = numSegments > 1 ? `video_continue_${numSegments}.mp4` : "ai2v_demo_1.mp4";
      r = await run("scp", [`${target}:${remoteOut}/${remoteFile}`, outputDir + "/"]);
      if (r.code !== 0) throw new Error(`scp download failed: ${r.stderr}`);
      localResultPath = path.join(outputDir, remoteFile);
    } else {
      fs.writeFileSync(inputJsonPath, JSON.stringify(LongCatAvatarProvider.buildInputJson(req.prompt, image, audio16k), null, 2));
      if (this.o.execMode === "command") {
        if (!this.o.commandTemplate) throw new Error("LONGCAT_COMMAND_TEMPLATE is required for LONGCAT_EXEC_MODE=command");
        const cmd = this.o.commandTemplate
          .replaceAll("{input_json}", inputJsonPath)
          .replaceAll("{output_dir}", outputDir)
          .replaceAll("{checkpoint_dir}", this.o.checkpointDir)
          .replaceAll("{resolution}", resolution)
          .replaceAll("{num_segments}", String(numSegments));
        log(`[longcat/command] ${cmd}\n`);
        const r = await run("/bin/sh", ["-c", cmd], { cwd: this.o.repoDir, onLine: log });
        if (r.code !== 0) throw new Error(`LongCat command failed (exit ${r.code}): ${r.stderr.slice(-3000)}`);
      } else {
        const args = LongCatAvatarProvider.buildArgs({ nproc: this.o.nproc, checkpointDir: this.o.checkpointDir, inputJson: inputJsonPath, outputDir, resolution, numSegments, useInt8: this.o.useInt8, refImgIndex: this.o.refImgIndex, maskFrameRange: this.o.maskFrameRange });
        log(`[longcat/local] torchrun ${args.join(" ")}\n`);
        const r = await run("torchrun", args, { cwd: this.o.repoDir, onLine: log });
        if (r.code !== 0) throw new Error(`LongCat torchrun failed (exit ${r.code}): ${r.stderr.slice(-3000)}`);
      }
      localResultPath = LongCatAvatarProvider.findOutput(outputDir, numSegments);
    }

    if (!localResultPath || !fs.existsSync(localResultPath)) throw new Error(`LongCat finished but no mp4 was found in ${outputDir}`);
    const info = await probe(localResultPath);
    return {
      path: localResultPath,
      width: info.width ?? LONGCAT_RESOLUTIONS[resolution].width,
      height: info.height ?? LONGCAT_RESOLUTIONS[resolution].height,
      fps: info.fps ?? LONGCAT_FPS,
      duration_sec: info.duration_sec,
      provider: this.name,
      aspect_ratio: "16:9",
      meta: { num_segments: numSegments, planned_duration: generatedDuration(numSegments), resolution, exec_mode: this.o.execMode, input_json: inputJsonPath },
    };
  }
}

function shellQuote(s: string): string {
  return /^[A-Za-z0-9_\/.=:-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`;
}
