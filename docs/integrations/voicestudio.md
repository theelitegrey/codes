# VoiceStudio — integration validation

Validated on 2026-09-18 against https://voicestudio.sh (docs) and its source
repository https://github.com/debpalash/VoiceStudio (`README.md`,
`docs/speech-platform.md`, `docs/api-auth.md`, `docs/mcp.md`,
`docs/install/docker.md`, `skills/voicestudio/SKILL.md`).

> Disambiguation: the PyPI package `voicestudio-cli` belongs to a *different*
> product (aiaudiogen.com, backend port 58391). This integration targets
> voicestudio.sh / debpalash/VoiceStudio (formerly *OmniVoice Studio*).

## What VoiceStudio is

An open-source (AGPL-3.0) **local** voice app: voice cloning, voice design,
dubbing, dictation and TTS. Electron desktop app for macOS/Windows/Linux, plus
a headless **Docker** image (`ghcr.io/debpalash/omnivoice-studio`). All
inference runs on the user's machine; engines include OmniVoice (default),
VoxCPM2, CosyVoice, MLX-audio, KittenTTS, MOSS-TTS-nano. Engine models carry
their own licenses.

## How it can be automated (documented interfaces)

The Python backend exposes an HTTP API on `http://localhost:3900` while the
app (or container) runs:

| Endpoint | Used for |
|---|---|
| `GET /health` | liveness (`shorts doctor`) |
| `GET /openapi.json` | runtime contract discovery |
| `GET /v1/audio/voices` | list voices / engines (`shorts voices discover`) |
| `POST /v1/audio/speech` | OpenAI `CreateSpeechRequest` shape → audio bytes (narration) |
| `POST /v1/audio/transcriptions` | multipart Whisper-style transcription, `verbose_json` → word timings for captions |
| `POST /mcp` | MCP server (not used by this pipeline) |

Request body sent by `VoiceStudioProvider`:

```json
{"model":"tts-1","input":"<narration>","voice":"<profile id | default | KittenTTS preset>","response_format":"wav","speed":1.0,"instructions":"<emotion; style>"}
```

* `model` accepts an engine id (`omnivoice`, `voxcpm2`, `cosyvoice`,
  `mlx-audio`, `kittentts`, `moss-tts-nano`) or the aliases `tts-1` /
  `tts-1-hd` for the active engine.
* `voice` is a saved voice-profile id, `default`, or a KittenTTS preset. OpenAI
  names (`alloy`, …) are accepted but map to defaults. Discover ids with
  `shorts voices discover` and put them in `config/voice/<id>.json`.
* `speed` and `instructions` are part of the OpenAI speech schema; engines
  that do not support them ignore them. Pitch is not in the schema, so
  `pitch_semitones` is applied in post with FFmpeg.
* Per the VoiceStudio skill, the response is verified to be audio before it
  is written (an error body can otherwise be saved as a `.wav`).

## Authentication

* **Loopback is unauthenticated by design** — a script on the same machine
  needs no key.
* Non-loopback (Docker on another host, Tailscale, reverse proxy): the backend
  is started with `OMNIVOICE_API_KEY=…` and clients send
  `Authorization: Bearer <key>` → `VOICESTUDIO_API_KEY` in `.env`.
* LAN "share" mode uses a 6-digit PIN via `X-OmniVoice-Pin` →
  `VOICESTUDIO_PIN` in `.env`.

## Running it

Desktop: install from https://github.com/debpalash/VoiceStudio/releases and
keep the app open (the API sidecar only listens while it runs).

Headless / server:

```bash
export OMNIVOICE_API_KEY="$(python3 -c 'import secrets; print(secrets.token_urlsafe(32))')"
docker run -d --name omnivoice --gpus all \
  -p 127.0.0.1:3900:3900 \
  -e OMNIVOICE_API_KEY="$OMNIVOICE_API_KEY" \
  -v omnivoice-data:/app/omnivoice_data \
  -v ~/.cache/huggingface:/root/.cache/huggingface \
  ghcr.io/debpalash/omnivoice-studio:latest
```

The first run downloads ~2.4 GB of model weights. Images are `linux/amd64`
only.

## Limitations

* Not a cloud service: the pipeline host must reach a running VoiceStudio
  backend. There is no API key for a hosted VoiceStudio TTS.
* Only one ML pipeline is loaded at a time (TTS vs ASR); switching between
  speech generation and transcription incurs a model-swap delay.
* Voice cloning/design use VoiceStudio's native endpoints (discover them via
  `/openapi.json`); this pipeline only consumes existing voice profiles.
* Word-level timestamps depend on the installed ASR engine; when the
  transcription lacks `words`, captions fall back to per-scene estimated
  timings (recorded in `project.json` as `captions.source`).
