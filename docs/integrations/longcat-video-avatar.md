# LongCat-Video-Avatar-1.5 — integration validation

Validated on 2026-09-18 against the public sources below. Nothing in the
provider uses an undocumented interface.

| Source | What was checked |
|---|---|
| https://huggingface.co/meituan-longcat/LongCat-Video-Avatar-1.5 | model card, weights layout, license (MIT) |
| https://github.com/meituan-longcat/LongCat-Video (README, `run_demo_avatar_single_audio_to_video.py`, `assets/avatar/single_example_1.json`) | install, exact inference commands, argument names, input JSON, output naming, fps/resolution math |

## What the model is

An open-weight, audio-driven human video model (Meituan LongCat team,
released 2026-05-21). v1.5 uses **Whisper-large-v3** as the audio encoder for
lip sync, supports **Audio-Text-to-Video (AT2V)**, **Audio-Image-to-Video
(AI2V)** and **video continuation**, single- or multi-stream audio, and ships a
DMD-distilled variant that runs in **8 steps**.

## Inference method (the only documented one)

There is **no hosted inference endpoint**: the Hugging Face repo hosts
weights only (no Inference API / serverless support), and the model is not
available through the `transformers`/`diffusers` pipelines. Inference is a
`torchrun` job inside the cloned GitHub repo:

```bash
git clone --single-branch --branch main https://github.com/meituan-longcat/LongCat-Video
cd LongCat-Video
conda create -n longcat-video python=3.10 && conda activate longcat-video
pip install torch==2.6.0+cu124 torchvision==0.21.0+cu124 torchaudio==2.6.0 --index-url https://download.pytorch.org/whl/cu124
pip install ninja psutil packaging flash_attn==2.7.4.post1
pip install -r requirements.txt
conda install -c conda-forge librosa ffmpeg
pip install -r requirements_avatar.txt

pip install "huggingface_hub[cli]"
huggingface-cli download meituan-longcat/LongCat-Video          --local-dir ./weights/LongCat-Video
huggingface-cli download meituan-longcat/LongCat-Video-Avatar-1.5 --local-dir ./weights/LongCat-Video-Avatar-1.5
```

> The avatar demo script loads the tokenizer, text encoder, VAE from
> `<checkpoint_dir>/../LongCat-Video`, so the base model must be downloaded
> next to the avatar checkpoint.

Documented command for the presenter use case (audio + reference image → video,
distilled, INT8):

```bash
torchrun --nproc_per_node=2 run_demo_avatar_single_audio_to_video.py \
  --context_parallel_size=2 \
  --checkpoint_dir=./weights/LongCat-Video-Avatar-1.5 \
  --stage_1=ai2v --input_json=assets/avatar/single_example_1.json \
  --num_segments=5 --ref_img_index=10 --mask_frame_range=3 \
  --use_distill --model_type avatar-v1.5 --use_int8
```

`LongCatAvatarProvider` builds exactly this argv (`buildArgs()`), adds
`--output_dir` and `--resolution`, and computes `--num_segments` from the
narration length.

## Inputs

`--input_json` points at:

```json
{
  "prompt": "A western man stands on stage ... speaking ...",
  "cond_image": "assets/avatar/single/man.png",
  "cond_audio": { "person1": "assets/avatar/single/man.mp3" }
}
```

* `cond_image` — the reference character image (used for `ai2v`).
* `cond_audio.person1` — narration; the script loads it with librosa at
  16 kHz and first runs a vocal separator (`Kim_Vocal_2.onnx`), so clean
  speech is ideal. The provider converts narration to 16 kHz mono WAV.
* `prompt` — the README recommends long descriptive prompts (appearance,
  action, scene). The presenter profile + `config/presenter/style.json`
  template produce this prompt.
* Negative prompt and seed are hard-coded inside the demo script (not
  configurable without editing it); the provider reports
  `supports_negative_prompt=false`, `supports_seed=false`.

## Outputs

* 25 fps (`save_fps = 25` for `avatar-v1.5`).
* `--resolution 480p` → **832×480**, `720p` → **1280×768** — always landscape.
  The 9:16 presenter panel is produced by the compositor (face-weighted crop,
  feathered top edge, vignette, colour grade), not by the model.
* One segment = 93 frames (3.72 s). Each extra `--num_segments` adds 80 new
  frames (3.2 s) through video continuation. For a 45 s narration the
  provider requests 14 segments (≈45.3 s) and the compositor trims.
* Files: `<output_dir>/ai2v_demo_1.mp4` (first segment) and
  `<output_dir>/video_continue_<n>.mp4` (cumulative). The provider picks
  `video_continue_<num_segments>.mp4` when `num_segments > 1`.

## Hardware

* The README's examples use `torchrun --nproc_per_node=2` with
  `--context_parallel_size=2` (context-parallel multi-GPU), bf16 weights,
  FlashAttention-2, CUDA 12.4. `--nproc_per_node=1 --context_parallel_size=1`
  is accepted by the script for single-GPU runs.
* `--use_int8` loads the INT8-quantised DiT for reduced VRAM; combined with
  `480p` it is the lowest-memory documented configuration.
* The model card does not publish an exact VRAM figure. Expect a data-centre
  class GPU (the base LongCat-Video is a 13.6B-parameter DiT); plan for
  minutes per Short.

## License

Model weights: **MIT License** (README "License Agreement"; the model card
notes that nothing in it alters the MIT terms). Downstream users are
responsible for applicable law (likeness/consent, content safety).

## How the pipeline uses it

```
narration.wav (final, approved) + config/presenter/reference.png + prompt
        │
        ▼  LongCatAvatarProvider.generate()
  <project>/longcat/input.json  → torchrun … --stage_1=ai2v --num_segments=N
        │
        ▼
  <project>/presenter.mp4 (832x480 @25fps)  → Remotion compositor (lower 35–50% of 1080×1920)
```

The avatar stage runs only after voice generation finished and the audio was
post-processed; it is never generated independently of the narration.

## Execution modes

| `LONGCAT_EXEC_MODE` | Behaviour |
|---|---|
| `local` (default) | spawn `torchrun` in `LONGCAT_REPO_DIR` on this machine |
| `ssh` | `scp` the input JSON, image and audio to `LONGCAT_SSH_HOST`, run the same command there, `scp` the result back |
| `command` | run `LONGCAT_COMMAND_TEMPLATE` with `{input_json} {output_dir} {checkpoint_dir} {resolution} {num_segments}` placeholders (job queues, Slurm, containers) |

`shorts doctor` verifies the repo, checkpoints, base model and `torchrun`.

## Known limitations

* No cloud API — a GPU box is required. This repository ships the adapter and
  a fully documented command; it cannot run in an environment without the
  weights (this code was validated with a synthetic stand-in provider).
* The demo script writes fixed file names; the provider uses a fresh
  `out/` directory per job to avoid clobbering.
* Multi-person (`run_demo_avatar_multi_audio_to_video.py`) is not wired; a
  single presenter is all the Short needs.
