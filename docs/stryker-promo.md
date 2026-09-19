# Stryker Trading Academy — promo build

9:16, 1080x1920, 30fps, 41.23s. Built from a HeyGen narration and a Remotion
motion-graphics layer, merged locally with ffmpeg.

## Assets

| Asset | Value |
| --- | --- |
| Avatar | Richard — `67a8908d5bee4c63993abc0e9534639e` |
| Voice | Kofi — `85ab3497a6db4b74b4454b6cfc4e7c3a`, speed 1.05 |
| Narration | 40.6204s, 117 word timestamps, stored in `data/stryker/narration.json` |
| Presenter video | HeyGen video `e917123993c30a386a83525c3919f0ac`, avatar_iv, 1:1, webm with alpha, 1080p |

The presenter video carries the Kofi narration on its own audio track, so the
graphics layer is rendered silent and the audio comes from the webm at merge time.

## Rendering the graphics layer

```bash
REMOTION_BROWSER_EXECUTABLE=/path/to/chrome npx tsx scripts/stryker-promo.ts
# -> output/stryker/stryker-graphics.mp4
```

Pass a presenter file as the first argument to composite inside Remotion
instead (the file must live under `public/`):

```bash
npx tsx scripts/stryker-promo.ts richard.webm   # -> output/stryker/stryker-final.mp4
```

## Merging locally

Download the presenter webm from the HeyGen video page, then:

```bash
ffmpeg -i stryker-graphics.mp4 -c:v libvpx-vp9 -i richard.webm \
  -filter_complex "[1:v]scale=1080:-1,format=yuva420p[p];[0:v][p]overlay=(W-w)/2:H-h:shortest=0[v]" \
  -map "[v]" -map 1:a -c:v libx264 -preset slow -crf 18 -pix_fmt yuv420p \
  -c:a aac -b:a 192k -movflags +faststart stryker-final.mp4
```

The overlay anchors the presenter to the bottom edge; the lower 46% of the
frame is reserved for them and carries a branded floor glow.

## Known limitation

HeyGen's CDN hosts (`resource2.heygen.ai`, `files2.heygen.ai`) are blocked by
the sandbox egress policy, so the presenter webm cannot be fetched here. The
merge above is the one manual step.

## Placeholders to confirm

`config/brand/stryker.json` carries provisional brand values: palette, the
`//` chevron mark, and `strykertradingacademy.com`. Replace them with the real
brand tokens before publishing.
