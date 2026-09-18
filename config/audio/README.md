# Audio library

Drop royalty-free music beds into `music/` and sound effects into `sfx/`, then
describe them in `library.json`:

```json
{
  "music": [
    { "file": "music/dark-minimal-tech.mp3", "genre": "minimal electronic", "mood": "focused", "tags": ["trading", "dark", "pulse"], "bpm": 96, "license": "CC0" }
  ],
  "sfx": [
    { "file": "sfx/whoosh-soft.wav", "type": "whoosh", "tags": ["soft"] }
  ]
}
```

The Audio Agent picks music by genre/mood/tag overlap with its plan and ducks
it under narration. If no music matches, the mix has no bed (nothing is
generated). SFX types the agent may request: whoosh, hit, click, rise,
impact, notification, chart_movement, transition — any type missing from the
library is synthesised procedurally with FFmpeg so cues never vanish.
Set `SHORTS_AUDIO_DIR` to use a library outside the repo.
