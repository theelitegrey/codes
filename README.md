# Shorts Director

Automated, podcast-style YouTube Shorts: a persistent AI presenter speaks in
the lower part of a 9:16 frame while charts, headlines, B-roll and graphics
fill the upper part. One instruction produces a finished MP4 plus title,
description, caption and hashtags.

```
"Create a 45-second Short explaining NQ liquidity sweeps. Use my default presenter."
```

```
┌─────────────────────────┐
│   MAIN VISUAL /         │   ← chart · B-roll · headline · graphic · AI visual
│   CHART / B-ROLL        │
│─────────────────────────│   ← dynamic captions on the boundary
│   👤 SPEAKING           │
│      PRESENTER          │   ← LongCat-Video-Avatar-1.5, lip-synced to the narration
└─────────────────────────┘
```

## Agent architecture (current)

Eight single-task agents write into a shared project manifest; the Director
runs the DAG and the Composer merges everything on one master timeline.

```
USER → DIRECTOR → SCRIPT → (TEXT ‖ AUDIO ‖ MOTION) → PRESENTER → ILLUSTRATION → CAPTIONS → COMPOSER → QA → FINAL MP4
                                     │                    ▲
                                VoiceStudio           LongCat (from the FINAL narration)
```

| Agent | Model / tech | Command |
|---|---|---|
| Script | Claude (research, hooks, timed beats, review) | `shorts agent script "<topic>"` |
| Text | Claude (on-screen text hierarchy, chains, safe areas) | `shorts agent text script.json` |
| Audio | Claude + **HeyGen TTS** (default; VoiceStudio/local alternatives) + FFmpeg (pauses, ducked music, SFX, loudness master) | `shorts agent audio script.json` |
| Motion Graphics | Claude Fable 5.1 + Remotion component library | `shorts agent motion script.json --render` |
| Illustration | Claude Fable 5.1 + model registry (diffusers / HF Inference / LongCat-Video) | `shorts agent illustration script.json` |
| Presenter | **HeyGen avatar / talking photo** (default; LongCat alternative), driven by the final narration, keyed alpha | `shorts agent presenter script.json --audio out/audio` |
| Captions | Claude Fable 5.1 + whisper.cpp / VoiceStudio timings | `shorts agent captions --audio out/audio --script script.json` |
| Composer | Claude Fable 5.1 + Remotion + FFmpeg (master timeline, layout, QA) | `shorts agent compose <projectDir>` |
| Director | runs all of the above into `output/projects/<id>/` | `shorts produce "<instruction>"` |

Project layout: `project.json` (manifest) plus `script/ text/ audio/ motion/
illustration/ presenter/ captions/ composition/ renders/ qa/`. The Composer
reads only the manifest; agents never call each other. Every agent's role
spec lives in `src/agents/<name>/role.md`.

End-to-end with no external services: `npm run e2e:project` (stub LLMs,
espeak narration, synthetic keyed host) renders `output/e2e-projects/<id>/renders/final.mp4`.

## Legacy pipeline

```
USER IDEA → SHORTS DIRECTOR → RESEARCH → HOOKS → SCRIPT → FACT CHECK → VISUAL DIRECTOR
        ┌──────────────────────────────┴───────────────────────────────┐
        │ VOICE PROVIDER (VoiceStudio) → NARRATION AUDIO                │  ← run in parallel
        │ VISUAL ASSETS (charts / B-roll / graphics)                    │
        └──────────────────────────────┬───────────────────────────────┘
                     AVATAR PROVIDER (LongCat) ← waits for the FINAL narration audio
                                       ↓
             REMOTION + FFMPEG → CAPTIONS → RETENTION REVIEW → QA → FINAL MP4 + METADATA
```

Every stage writes into `output/<project>/project.json`, so a run can be
resumed (`--resume`) or stopped early (`--stop-after script|scenes|audio|presenter|render`).

## Provider architecture

Agents and the Shorts Director talk only to generic interfaces:

```
VoiceProvider                     AvatarVideoProvider              VisualAssetProvider
└── VoiceStudioProvider (default) └── LongCatAvatarProvider (default) └── LocalLibraryVisualProvider
└── LocalTTSProvider (espeak/say) └── NoAvatarProvider                 └── (register your own)
└── (register your own)           └── (register your own)
```

Swap an implementation with `registerVoiceProvider()` /
`registerAvatarProvider()` / `registerVisualProvider()` or the
`VOICE_PROVIDER` / `AVATAR_PROVIDER` / `VISUAL_PROVIDER` env vars — nothing in
`src/director` or `src/agents` imports LongCat or VoiceStudio.

Source map:

| Path | Purpose |
|---|---|
| `src/director/ShortsDirector.ts` | master orchestrator (intake → pipeline) |
| `src/pipeline/runPipeline.ts` | stage ordering, parallelism, persistence |
| `src/agents/*` | research (web search), hooks, script, fact check, visual director, retention, metadata, intake |
| `src/providers/voice/*` | `VoiceProvider`, VoiceStudio, local TTS, registry |
| `src/providers/avatar/*` | `AvatarVideoProvider`, LongCat, registry |
| `src/providers/visuals/*` | `VisualAssetProvider`, local library, registry |
| `src/providers/llm/llm.ts` | Anthropic SDK wrapper (structured outputs + web search) |
| `src/core/scene.ts` | structured scene model (presenter block, main visual, chart spec, captions) |
| `src/presets/*` | `PODCAST_SHORT`, `FULLSCREEN`, `NEWS`, `TRADING`, `EDUCATIONAL`, `CINEMATIC` |
| `config/presenter/` | `presenter.json` (profiles), `reference.png`, `style.json` |
| `config/voice/` | one JSON per voice (`default`, `default_male`, `energetic_male`, `local_dev`) |
| `remotion/` | the 9:16 composition: background, main visual, blended presenter panel, captions |
| `docs/integrations/` | validation reports for LongCat and VoiceStudio |

## Scene model

```json
{
  "scene_id": 2,
  "duration": 5.2,
  "start_time": 3.9,
  "narration": "Price runs above the old high, grabs the resting stops, then reverses.",
  "presenter": { "enabled": true, "position": "bottom", "size": "medium", "height_fraction": 0.42 },
  "main_visual": { "type": "chart", "chart": { "kind": "candlestick", "series": [[100,101.5,98.5,100.8], ...], "annotations": [{ "index": 20, "label": "sweep", "level": 108 }] } },
  "text_overlay": "STOP HUNT",
  "caption": "",
  "music": "",
  "sound_effect": "whoosh"
}
```

The Visual Director chooses per scene whether the presenter is visible, where
(`bottom | top | left | right | center | pip`) and how large (`small | medium |
large | full`, or an explicit `height_fraction` inside the preset's range —
0.35–0.5 for `PODCAST_SHORT`). Guard rails break runs of identical visuals and
guarantee at least one presenter-free scene, so a Short alternates e.g.
presenter + headline → presenter + chart → full-screen chart → presenter +
B-roll → presenter + CTA.

## Presenter consistency

`config/presenter/presenter.json` holds named profiles (`default_host`,
`trading_host`, `news_host`, `educational_host`) with identity, appearance,
clothing, hairstyle, age range, expression, framing, lighting, background,
prompt fragment and reference images. `style.json` holds the channel-wide
prompt template, avatar resolution and blend settings. The same profile and
reference image are reused for every video.

* "Use my default presenter." / "Use trading_host." / "use the news anchor" are
  resolved by `PresenterProfileStore.resolveFromText()`.
* Replace `config/presenter/reference.png` (a generated placeholder) with a
  real portrait: medium shot, chest-up, facing camera, even lighting. Add
  more profiles by adding entries to `presenter.json`.
* `shorts presenters prompt trading_host --mode TRADING` prints the exact
  prompt sent to the avatar model.

## Voice

`config/voice/<id>.json` — voice id (a VoiceStudio profile id or `default`),
engine/model, style, speaking speed, pitch (applied in post), emotion,
language, output format. No voice is hard-coded.

* "Use the default male voice." / "Use the energetic male voice." are resolved
  by `VoiceConfigStore.resolveFromText()`; otherwise the presenter's
  `default_voice_id` is used.
* `shorts voices discover` lists what the running VoiceStudio reports
  (`GET /v1/audio/voices`) so you can copy a real profile id into a config.
* `shorts voices test energetic_male` renders a sample line.

## Modes

`shorts modes` — `PODCAST_SHORT` (default), `FULLSCREEN`, `NEWS`, `TRADING`,
`EDUCATIONAL`, `CINEMATIC`. Say "news mode" in the instruction or pass
`--mode NEWS`. Presets can be overridden per mode by dropping a
`config/presets/<MODE>.json`.

## Setup

```bash
npm install
cp .env.example .env        # fill in ANTHROPIC_API_KEY (or `ant auth login`), VoiceStudio / LongCat settings
npm run doctor              # checks ffmpeg, LLM credentials, VoiceStudio, LongCat, configs
```

Requirements:

* Node ≥ 20, FFmpeg/ffprobe on PATH.
* **VoiceStudio** running locally (desktop app or Docker) — see
  `docs/integrations/voicestudio.md`.
* **LongCat-Video-Avatar-1.5** checkout + weights on a CUDA GPU box (local,
  over SSH, or via a custom command) — see
  `docs/integrations/longcat-video-avatar.md`. Without it, the pipeline
  renders presenter-less Shorts (`--no-presenter` or `AVATAR_PROVIDER=none`).
* Optional `REMOTION_BROWSER_EXECUTABLE` to reuse a system
  `chrome-headless-shell`; otherwise Remotion downloads one.

## Usage

```bash
npm run shorts -- create "Create a 45-second Short explaining NQ liquidity sweeps. Use my default presenter."
npm run shorts -- create "Make a 1 minute news mode Short about the Fed decision. Use trading_host. Use the energetic male voice."
npm run shorts -- create "..." --stop-after scenes        # inspect the scene plan first
npm run shorts -- create "..." --resume output/<id>/project.json
npm run shorts -- plan "..."                              # parse only, no LLM
```

Output folder: `final.mp4`, `presenter.mp4`, `audio/narration.wav`,
`captions.srt`, `metadata.json`, `render-props.json`, `project.json` (full
state incl. research, script, fact-check issues, scenes, retention score, QA).

## Verifying without external services

```bash
npm test                     # 30 unit tests (config resolution, LongCat argv/JSON, VoiceStudio request/auth, scenes, layout, captions)
REMOTION_BROWSER_EXECUTABLE=/path/to/chrome-headless-shell npm run e2e:fixture
```

`e2e:fixture` runs the entire pipeline with a stubbed LLM, `espeak-ng`
narration and a synthetic presenter clip, producing a real 1080×1920 MP4 that
passes technical QA — it validates timing, captions, the Remotion
composition, FFmpeg finalize and QA end to end.

## Integration status (validated 2026-09-18)

| Service | Interface used | Automation | Key / license |
|---|---|---|---|
| HeyGen (default) | `/v3/voices/speech`, `/v2/voices`, `upload /v1/asset`, `upload /v1/talking_photo`, `/v2/video/generate` (audio-driven), `/v1/video_status.get` | hosted API | `HEYGEN_API_KEY`; paid plan, `HEYGEN_TEST_MODE` for watermarked tests |
| LongCat-Video-Avatar-1.5 | `torchrun run_demo_avatar_single_audio_to_video.py --stage_1=ai2v --use_distill --model_type avatar-v1.5 [--use_int8]` with the documented input JSON | local GPU / SSH / custom command — **no hosted API exists** | none; weights MIT |
| VoiceStudio | `GET /health`, `GET /v1/audio/voices`, `POST /v1/audio/speech`, `POST /v1/audio/transcriptions` on `localhost:3900` | local desktop app or Docker | `OMNIVOICE_API_KEY` only for non-loopback (`VOICESTUDIO_API_KEY`); app AGPL-3.0, engine models have own licenses |
| Claude (agents) | Anthropic SDK, structured outputs, `web_search` server tool | API | `ANTHROPIC_API_KEY` |

Details and limitations: `docs/integrations/`.
