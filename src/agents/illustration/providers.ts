import fs from "node:fs";
import path from "node:path";
import { env } from "../../core/env.js";
import { REPO_ROOT } from "../../core/paths.js";
import { run, commandExists, ensureDir } from "../../media/ffmpeg.js";
import type { RegistryModel } from "./schema.js";

/** A generation request for an image or a short clip. */
export interface GenerationRequest {
  prompt: string;
  negativePrompt: string;
  width: number;
  height: number;
  outPath: string;
  seed?: number;
  durationSec?: number;
  /** Optional reference still (image-to-video). */
  referenceImage?: string;
  onLog?: (l: string) => void;
}

export interface GenerationAdapter {
  readonly name: RegistryModel["adapter"];
  health(): Promise<{ ok: boolean; detail: string }>;
  generate(model: RegistryModel, req: GenerationRequest): Promise<string>;
}

/** Local diffusers via scripts/illustration/diffusers_generate.py (torch + diffusers in ILLUSTRATION_PYTHON). */
export class DiffusersLocalAdapter implements GenerationAdapter {
  readonly name = "diffusers_local" as const;
  private readonly python = env("ILLUSTRATION_PYTHON", "python3")!;
  private readonly script = path.join(REPO_ROOT, "scripts", "illustration", "diffusers_generate.py");
  async health() {
    if (!(await commandExists(this.python))) return { ok: false, detail: `${this.python} not found (set ILLUSTRATION_PYTHON)` };
    const r = await run(this.python, ["-c", "import torch, diffusers; print(torch.__version__, diffusers.__version__, torch.cuda.is_available())"]);
    return r.code === 0 ? { ok: true, detail: `torch/diffusers ${r.stdout.trim()}` } : { ok: false, detail: "torch/diffusers not importable in ILLUSTRATION_PYTHON" };
  }
  static buildArgs(script: string, model: RegistryModel, req: GenerationRequest): string[] {
    const args = [script, "--model", model.id, "--kind", model.kind, "--prompt", req.prompt, "--out", req.outPath, "--width", String(req.width), "--height", String(req.height), "--seed", String(req.seed ?? 42)];
    if (req.negativePrompt) args.push("--negative", req.negativePrompt);
    if (model.id.includes("FLUX.1-schnell")) args.push("--steps", "4", "--guidance", "0");
    if (model.kind === "video") args.push("--frames", String(Math.round((req.durationSec ?? 3) * 16)), "--fps", "16");
    return args;
  }
  async generate(model: RegistryModel, req: GenerationRequest): Promise<string> {
    ensureDir(path.dirname(req.outPath));
    const r = await run(this.python, DiffusersLocalAdapter.buildArgs(this.script, model, req), { onLine: req.onLog });
    if (r.code !== 0 || !fs.existsSync(req.outPath)) throw new Error(`diffusers generation failed: ${r.stdout.slice(-400)} ${r.stderr.slice(-800)}`);
    return req.outPath;
  }
}

/**
 * Hugging Face Inference API (text-to-image). Sends the model id and a
 * Bearer HF_TOKEN. The base URL is configurable because the endpoint moved
 * from api-inference.huggingface.co to router.huggingface.co/hf-inference;
 * confirm against the current HF docs if requests 404.
 */
export class HfInferenceAdapter implements GenerationAdapter {
  readonly name = "hf_inference" as const;
  private readonly token = env("HF_TOKEN");
  private readonly base = env("HF_INFERENCE_BASE_URL", "https://router.huggingface.co/hf-inference")!.replace(/\/+$/, "");
  constructor(private readonly fetchImpl: typeof fetch = fetch) {}
  async health() {
    return this.token ? { ok: true, detail: `HF_TOKEN set, base ${this.base}` } : { ok: false, detail: "HF_TOKEN not set" };
  }
  buildRequest(model: RegistryModel, req: GenerationRequest): { url: string; body: Record<string, unknown> } {
    return { url: `${this.base}/models/${model.id}`, body: { inputs: req.prompt, parameters: { width: req.width, height: req.height, negative_prompt: req.negativePrompt || undefined, seed: req.seed } } };
  }
  async generate(model: RegistryModel, req: GenerationRequest): Promise<string> {
    if (model.kind !== "image") throw new Error("hf_inference adapter supports images only");
    const { url, body } = this.buildRequest(model, req);
    const r = await this.fetchImpl(url, { method: "POST", headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json", Accept: "image/png" }, body: JSON.stringify(body) });
    if (!r.ok) throw new Error(`HF inference ${r.status}: ${(await r.text()).slice(0, 300)}`);
    const buf = Buffer.from(await r.arrayBuffer());
    if (!(r.headers.get("content-type") ?? "").startsWith("image/")) throw new Error(`HF inference returned non-image: ${buf.toString("utf8").slice(0, 200)}`);
    ensureDir(path.dirname(req.outPath));
    fs.writeFileSync(req.outPath, buf);
    return req.outPath;
  }
}

/** LongCat-Video T2V / I2V through scripts/illustration/longcat_generate.py run with torchrun inside LONGCAT_REPO_DIR. */
export class LongCatVideoAdapter implements GenerationAdapter {
  readonly name = "longcat_video" as const;
  private readonly repo = env("LONGCAT_REPO_DIR", "/opt/LongCat-Video")!;
  private readonly ckpt = env("LONGCAT_VIDEO_CHECKPOINT_DIR", path.join(env("LONGCAT_REPO_DIR", "/opt/LongCat-Video")!, "weights", "LongCat-Video"))!;
  private readonly nproc = Number(env("LONGCAT_NPROC", "1"));
  async health() {
    if (!fs.existsSync(path.join(this.repo, "longcat_video"))) return { ok: false, detail: `LongCat-Video repo not at ${this.repo}` };
    if (!fs.existsSync(path.join(this.ckpt, "dit"))) return { ok: false, detail: `LongCat-Video base weights missing at ${this.ckpt}` };
    if (!(await commandExists("torchrun"))) return { ok: false, detail: "torchrun not on PATH" };
    return { ok: true, detail: "LongCat-Video ready" };
  }
  static buildArgs(nproc: number, ckpt: string, req: GenerationRequest, distill = true): string[] {
    const args = [`--nproc_per_node=${nproc}`, "longcat_generate.py", `--checkpoint_dir=${ckpt}`, `--context_parallel_size=${nproc}`, "--prompt", req.prompt, "--out", req.outPath, "--num_frames", "93", "--seed", String(req.seed ?? 42)];
    if (req.referenceImage) args.push("--image", req.referenceImage);
    if (distill) args.push("--distill");
    return args;
  }
  async generate(_model: RegistryModel, req: GenerationRequest): Promise<string> {
    const runner = path.join(this.repo, "longcat_generate.py");
    fs.copyFileSync(path.join(REPO_ROOT, "scripts", "illustration", "longcat_generate.py"), runner);
    ensureDir(path.dirname(req.outPath));
    const r = await run("torchrun", LongCatVideoAdapter.buildArgs(this.nproc, this.ckpt, req), { cwd: this.repo, onLine: req.onLog });
    if (r.code !== 0 || !fs.existsSync(req.outPath)) throw new Error(`LongCat-Video generation failed: ${r.stderr.slice(-1200)}`);
    return req.outPath;
  }
}

export function defaultAdapters(): Record<RegistryModel["adapter"], GenerationAdapter> {
  return { diffusers_local: new DiffusersLocalAdapter(), hf_inference: new HfInferenceAdapter(), longcat_video: new LongCatVideoAdapter() };
}
