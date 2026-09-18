#!/usr/bin/env python
"""Parametrised LongCat-Video text-to-video / image-to-video runner.

The repository's run_demo_text_to_video.py / run_demo_image_to_video.py
hard-code the prompt and image. This script mirrors their pipeline usage
(LongCatVideoPipeline.generate_t2v / generate_i2v, distilled cfg_step_lora)
but takes arguments. Copy or symlink it into the LongCat-Video checkout and run
with torchrun from that directory, e.g.

  torchrun --nproc_per_node=1 longcat_generate.py --checkpoint_dir=./weights/LongCat-Video \
      --prompt "..." --out clip.mp4 [--image ref.png] [--distill] [--seed 42]
"""
import os, argparse, datetime, json
import numpy as np
import torch
import torch.distributed as dist
from transformers import AutoTokenizer, UMT5EncoderModel
from torchvision.io import write_video
from diffusers.utils import load_image
from longcat_video.pipeline_longcat_video import LongCatVideoPipeline
from longcat_video.modules.scheduling_flow_match_euler_discrete import FlowMatchEulerDiscreteScheduler
from longcat_video.modules.autoencoder_kl_wan import AutoencoderKLWan
from longcat_video.modules.longcat_video_dit import LongCatVideoTransformer3DModel
from longcat_video.context_parallel import context_parallel_util
from longcat_video.context_parallel.context_parallel_util import init_context_parallel

NEGATIVE = "Bright tones, overexposed, static, blurred details, subtitles, style, works, paintings, images, static, overall gray, worst quality, low quality, JPEG compression residue, ugly, incomplete, extra fingers, poorly drawn hands, poorly drawn faces, deformed, disfigured, misshapen limbs, fused fingers, still picture, messy background, three legs, many people in the background, walking backwards"

def main():
    p = argparse.ArgumentParser()
    p.add_argument("--checkpoint_dir", required=True)
    p.add_argument("--prompt", required=True)
    p.add_argument("--negative", default=NEGATIVE)
    p.add_argument("--image", default=None, help="reference image → image-to-video")
    p.add_argument("--out", required=True)
    p.add_argument("--context_parallel_size", type=int, default=1)
    p.add_argument("--distill", action="store_true", help="use cfg_step_lora, 16 steps, cfg 1.0")
    p.add_argument("--num_frames", type=int, default=93)
    p.add_argument("--seed", type=int, default=42)
    p.add_argument("--enable_compile", action="store_true")
    a = p.parse_args()

    rank = int(os.environ["RANK"]); num_gpus = torch.cuda.device_count(); local_rank = rank % num_gpus
    torch.cuda.set_device(local_rank)
    dist.init_process_group(backend="nccl", timeout=datetime.timedelta(seconds=3600 * 24))
    init_context_parallel(context_parallel_size=a.context_parallel_size, global_rank=dist.get_rank(), world_size=dist.get_world_size())
    cp_split_hw = context_parallel_util.get_optimal_split(context_parallel_util.get_cp_size())

    cd = a.checkpoint_dir
    tokenizer = AutoTokenizer.from_pretrained(cd, subfolder="tokenizer", torch_dtype=torch.bfloat16)
    text_encoder = UMT5EncoderModel.from_pretrained(cd, subfolder="text_encoder", torch_dtype=torch.bfloat16)
    vae = AutoencoderKLWan.from_pretrained(cd, subfolder="vae", torch_dtype=torch.bfloat16)
    scheduler = FlowMatchEulerDiscreteScheduler.from_pretrained(cd, subfolder="scheduler", torch_dtype=torch.bfloat16)
    dit = LongCatVideoTransformer3DModel.from_pretrained(cd, subfolder="dit", cp_split_hw=cp_split_hw, torch_dtype=torch.bfloat16)
    if a.enable_compile:
        dit = torch.compile(dit)
    pipe = LongCatVideoPipeline(tokenizer=tokenizer, text_encoder=text_encoder, vae=vae, scheduler=scheduler, dit=dit)
    pipe.to(local_rank)
    gen = torch.Generator(device=local_rank).manual_seed(a.seed + dist.get_rank())

    kwargs = dict(prompt=a.prompt, num_frames=a.num_frames, generator=gen)
    if a.distill:
        pipe.dit.load_lora(os.path.join(cd, "lora/cfg_step_lora.safetensors"), "cfg_step_lora")
        pipe.dit.enable_loras(["cfg_step_lora"])
        kwargs.update(num_inference_steps=16, use_distill=True, guidance_scale=1.0)
    else:
        kwargs.update(negative_prompt=a.negative, num_inference_steps=50, guidance_scale=4.0)

    if a.image:
        out = pipe.generate_i2v(image=load_image(a.image), **kwargs)[0]
    else:
        out = pipe.generate_t2v(height=480, width=832, **kwargs)[0]
    if a.distill:
        pipe.dit.disable_all_loras()

    if local_rank == 0:
        t = torch.from_numpy(np.array(out))
        t = (t * 255).clamp(0, 255).to(torch.uint8)
        write_video(a.out, t, fps=15, video_codec="libx264", options={"crf": "18"})
        print(json.dumps({"ok": True, "out": a.out, "fps": 15, "frames": a.num_frames}))

if __name__ == "__main__":
    main()
