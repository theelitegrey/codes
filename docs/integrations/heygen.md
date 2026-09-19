# HeyGen — integration validation (default voice + presenter provider)

Validated on 2026-09-19. HeyGen's documentation hosts (docs.heygen.com,
developers.heygen.com) are blocked from this build environment, so the
surface below was assembled from HeyGen's published OpenAPI mirror
(github.com/tryAGI/HeyGen `heygen.yaml`) and HeyGen's own documentation
pages as indexed by search (Create Video v2, Upload Asset, Video Status,
List Voices v2, Text to Speech `/v3/voices/speech`, Using Audio Files as
Voice, Photo Avatar). **Confirm field names against
developers.heygen.com before the first paid run**; every request body the
providers send is written to disk (`presenter/heygen/request.json`) for that
purpose, and `HEYGEN_TEST_MODE=true` produces free watermarked renders.

| Need | Endpoint | Used by |
|---|---|---|
| Auth | header `X-Api-Key: <key>` on every call | all |
| Voice catalogue | `GET https://api.heygen.com/v2/voices` → `data.voices[]` `{voice_id, name, language, gender, preview_audio, support_pause, emotion_support}` | `shorts voices discover --provider heygen`, "default" voice resolution |
| Text-to-speech | `POST https://api.heygen.com/v3/voices/speech` body `{text, voice_id, input_type: "text"\|"ssml", speed 0.5–2.0, language?, locale?}` → `{audio_url (mono PCM16 WAV 44.1 kHz), duration, word_timestamps[]}` | `HeyGenVoiceProvider` |
| Upload audio / image | `POST https://upload.heygen.com/v1/asset` raw body with `Content-Type: audio/wav` etc. → `data.id`, `data.url` | narration upload |
| Photo → talking photo | `POST https://upload.heygen.com/v1/talking_photo` raw image body → `data.talking_photo_id` | presenter identity from `config/presenter/reference.png` |
| Avatars | `GET https://api.heygen.com/v2/avatars` → `data.avatars[]`, `data.talking_photos[]` | doctor |
| Avatar video from audio | `POST https://api.heygen.com/v2/video/generate` body `{video_inputs:[{character:{type:"avatar",avatar_id,avatar_style}\|{type:"talking_photo",talking_photo_id}, voice:{type:"audio", audio_asset_id\|audio_url}, background:{type:"color",value:"#1DB954"}}], dimension:{width,height}, title?, test?}` → `data.video_id` | `HeyGenAvatarProvider` |
| Status | `GET https://api.heygen.com/v1/video_status.get?video_id=` → `data.status` (`pending\|processing\|completed\|failed`), `data.video_url`, `data.duration` | polling every 10 s |

Script and audio are mutually exclusive in `voice`; exactly one of
`audio_url` / `audio_asset_id` must be given. HeyGen also has a newer v3
video API (`/v3/videos`, `/v3/assets`, `/v3/avatars`) with Avatar IV/V
engines and transparent WebM output; the providers use the v2 generate
endpoint because its body is fully specified in the OpenAPI mirror. Moving
to v3 is a change inside `HeyGenClient` only.

## How the pipeline uses it

Audio Agent → `HeyGenVoiceProvider.synthesize()` per spoken line
(pauses are inserted as silence between lines by the Audio Agent, so no
SSML is needed; `<break>` is passed through when a line contains it and the
voice's `support_pause` is true). Word timestamps from HeyGen are stored on
the audio timeline, and the Captions Agent uses them directly instead of
transcribing.

Presenter Agent → `HeyGenAvatarProvider.generate()` with the FINAL
`narration.wav`: upload → generate with `voice.type: "audio"` → poll →
download. Identity is the profile's `heygen.avatar_id` (studio avatar or
digital twin) or `heygen.talking_photo_id`; if neither is set, the
reference image is uploaded once and the id cached in
`config/presenter/heygen_cache.json`. The scene prompt is not sent
(HeyGen has no prompt-driven scene control); the background is a flat
colour the Composer keys out.

## Limitations

- Paid, hosted service; no per-second lip-sync control beyond the audio.
- Prompted camera/lighting/background from the Presenter Agent do not
  apply; choose them through the HeyGen avatar itself.
- Talking-photo output is a portrait render of the photo; a studio avatar
  or digital twin gives full-body gestures.
- Rate limits and quotas per plan (`GET /v2/user/remaining_quota`).
