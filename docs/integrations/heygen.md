# HeyGen — integration validation (default voice + presenter provider)

Validated on 2026-09-19 **against the live API** through HeyGen's official
MCP connector, and against HeyGen's published agent skills
(github.com/heygen-com/skills, `heygen-video` v3.2.0).

> **v1 and v2 are deprecated.** HeyGen's own skill says it in those words:
> "v3 only — never call v1 or v2 endpoints", naming `POST /v1/video.generate`,
> `POST /v2/video/generate`, `GET /v2/avatars` and `GET /v1/avatar.list` as
> deprecated. This integration targets v3 only.

## Surfaces

| Surface | When to use | Auth |
|---|---|---|
| **v3 REST** (`HEYGEN_TRANSPORT=rest`, default) | the pipeline running headless | `X-Api-Key` |
| **`heygen` CLI** (`HEYGEN_TRANSPORT=cli`) | hosts that have the CLI; HeyGen's recommended agent surface | `HEYGEN_API_KEY` or `heygen auth login` |
| **MCP** `https://mcp.heygen.com/mcp/v1/` | interactive agents (this is how the shapes below were verified) | OAuth |

Install the CLI with `curl -fsSL https://static.heygen.ai/cli/install.sh | bash`.
Its contract: JSON on stdout, `{error:{code,message,hint}}` on stderr, exit
codes 0 ok · 1 API · 2 usage · 3 auth · 4 timeout, `--wait` to block.

## v3 endpoints this pipeline uses

| Need | Call | Notes |
|---|---|---|
| Voice catalogue | `GET /v3/voices?engine=starfish&type=public&language=&gender=` | `{items:[{voice_id,name,language,gender,support_pause,…}], has_more, next_token}`. **Only starfish voices can drive TTS.** |
| Text to speech | `POST /v3/voices/speech` `{text (≤5000), voice_id, input_type: text\|ssml, language?, locale?, speed 0.5–2.0}` | → `{audio_url (WAV), duration, word_timestamps:[{word,start,end}]}`. Timestamps include `<start>`/`<end>` sentinels — strip them. SSML break tags must be **seconds** (`<break time="0.35s"/>`); ms is rejected. |
| Avatar looks | `GET /v3/avatars/looks?ownership=&avatar_type=&group_id=` | `id` is the `avatar_id` you pass to video creation. Carries `supported_api_engines`, `image_width/height`, `preferred_orientation`, `status`, `default_voice_id`. Look ids are ephemeral — resolve from `group_id` at runtime. |
| Presenter video | `POST /v3/videos` `{avatar_id \| image:{type:url\|asset_id}, audio_url \| audio_asset_id \| script+voice_id, engine:{type}, aspect_ratio, output_format, resolution, background, fit, caption}` | → `{video_id, status, output_format}` |
| Status | `GET /v3/videos/{id}` | → `status`, `video_url`, `duration`, `thumbnail_url`, `gif_url`, `subtitle_url`, `video_page_url` |
| Assets | `POST /v3/assets` (raw body, ≤32 MB) | → `asset_id` |

### Two things that will bite you

1. **`engine.type` must be in the look's `supported_api_engines`.** Public
   studio avatars such as `Bryce_public_5` list only `avatar_iii`, and the
   default Avatar IV is rejected with *"This video avatar does not support
   Avatar IV video generation."* The provider reads the look and picks the
   best supported engine (`avatar_v` > `avatar_iv` > `avatar_iii`).
2. **`output_format: "webm"` returns a real alpha channel** and rejects any
   `background`. This is strictly better than a green screen: the Composer
   skips chroma keying entirely. Not every avatar supports matting, so the
   provider tries webm first and falls back to mp4 on a flat key colour.

## Verified end to end

- `POST /v3/voices/speech` with `0be4826fa6fa4a0ca4f410c9d6f6e589`
  ("Nikhil - Conversational & Easygoing") returned a 10.40 s WAV plus
  word timestamps for every word.
- `POST /v3/videos` with `avatar_id: Bryce_public_5`, that audio as
  `audio_url`, `engine: {type: "avatar_iii"}`, `aspect_ratio: "1:1"`,
  `output_format: "webm"`, `resolution: "720p"` produced a completed
  **10.3967 s transparent webm** — duration matched the narration exactly.

## How the pipeline uses it

Audio Agent → `HeyGenVoiceProvider` per spoken line (pauses are real silence
between lines, so SSML is rarely needed). HeyGen's word timestamps are stored
on the audio timeline, and the Captions Agent uses them directly instead of
transcribing.

Presenter Agent → `HeyGenAvatarProvider` with the FINAL `narration.wav`:
upload as an asset → create the video with `audio_asset_id` → poll →
download. Identity comes from the presenter profile's `heygen.look_id` or
`heygen.group_id`; with neither, the profile's reference image is uploaded
once (cached by content hash) and animated as a photo presenter.

## Limitations

- Paid, hosted. Creator plan credits are consumed per render.
- The Presenter Agent's prompted camera, lighting and background do not
  apply; those come from the chosen HeyGen avatar.
- `motion_prompt` and `expressiveness` are photo-avatar / Avatar V only.
- Look ids change; store `group_id` for stability.
