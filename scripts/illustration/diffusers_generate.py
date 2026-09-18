#!/usr/bin/env python
"""Text-to-image / text-to-video via Hugging Face diffusers.

Used by the Illustration Agent's `diffusers_local` adapter. Requires a Python
environment with torch + diffusers (+ accelerate). Image models use
AutoPipelineForText2Image; video models use the pipeline class named in
--pipeline (default WanPipeline) and export_to_video.

  python diffusers_generate.py --model black-forest-labs/FLUX.1-schnell --prompt "..." --out img.png --width 1024 --height 1024 --steps 4
  python diffusers_generate.py --model Wan-AI/Wan2.1-T2V-1.3B --kind video --prompt "..." --out clip.mp4 --frames 49 --fps 16
"""
import argparse, json, sys

def main():
    p = argparse.ArgumentParser()
    p.add_argument("--model", required=True)
    p.add_argument("--kind", choices=["image", "video"], default="image")
    p.add_argument("--prompt", required=True)
    p.add_argument("--negative", default="")
    p.add_argument("--out", required=True)
    p.add_argument("--width", type=int, default=1024)
    p.add_argument("--height", type=int, default=1024)
    p.add_argument("--steps", type=int, default=None)
    p.add_argument("--guidance", type=float, default=None)
    p.add_argument("--seed", type=int, default=42)
    p.add_argument("--frames", type=int, default=49)
    p.add_argument("--fps", type=int, default=16)
    p.add_argument("--pipeline", default="WanPipeline")
    p.add_argument("--dtype", default="bfloat16")
    a = p.parse_args()

    import torch
    dtype = getattr(torch, a.dtype)
    device = "cuda" if torch.cuda.is_available() else "cpu"
    gen = torch.Generator(device=device).manual_seed(a.seed)
    kwargs = {}
    if a.steps is not None: kwargs["num_inference_steps"] = a.steps
    if a.guidance is not None: kwargs["guidance_scale"] = a.guidance
    if a.negative: kwargs["negative_prompt"] = a.negative

    if a.kind == "image":
        from diffusers import AutoPipelineForText2Image
        pipe = AutoPipelineForText2Image.from_pretrained(a.model, torch_dtype=dtype).to(device)
        img = pipe(prompt=a.prompt, width=a.width, height=a.height, generator=gen, **kwargs).images[0]
        img.save(a.out)
    else:
        import diffusers
        from diffusers.utils import export_to_video
        cls = getattr(diffusers, a.pipeline)
        pipe = cls.from_pretrained(a.model, torch_dtype=dtype).to(device)
        frames = pipe(prompt=a.prompt, width=a.width, height=a.height, num_frames=a.frames, generator=gen, **kwargs).frames[0]
        export_to_video(frames, a.out, fps=a.fps)
    print(json.dumps({"ok": True, "out": a.out}))

if __name__ == "__main__":
    try:
        main()
    except Exception as e:  # report as JSON so the Node side can show it
        print(json.dumps({"ok": False, "error": f"{type(e).__name__}: {e}"}))
        sys.exit(1)
