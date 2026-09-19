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

## Downloading the presenter and compositing

One command, on any machine that can reach HeyGen:

```bash
npx tsx scripts/stryker-finalize.ts e917123993c30a386a83525c3919f0ac
# or: npx tsx scripts/stryker-finalize.ts            # uses HEYGEN_VIDEO_ID
# or: npx tsx scripts/stryker-finalize.ts ./richard.webm   # already downloaded
```

It polls the video to `completed`, downloads the webm with `HEYGEN_API_KEY`,
and writes `output/stryker/stryker-final.mp4`.

### How the overlay works

`overlayPresenter` in `src/media/composite.ts` scales the square HeyGen clip to
*cover* the reserved band, crops the band off the bottom of the scaled frame so
the head survives, anchors it to the bottom edge, and maps the master audio
from the presenter clip. Two details are load-bearing:

- **The decoder must be forced.** VP9 stores alpha in a WebM `BlockAdditional`
  side-channel, flagged as `alpha_mode=1`. ffprobe still reports the stream as
  `yuv420p`, and the native decoder discards the alpha, so the input needs
  `-c:v libvpx-vp9` for `yuva420p` to come out.
- **The first frame can decode fully transparent.** Sample any verification
  frame past frame 0.

`tests/composite.test.ts` covers both, plus the refusal to composite a
presenter clip with no audio.

## Known limitation

HeyGen's CDN hosts (`resource2.heygen.ai`, `files2.heygen.ai`) and
`api.heygen.com` are blocked by this sandbox's egress policy, so the presenter
webm cannot be fetched from inside it. The compositor itself is verified here
against a synthetic VP9 alpha clip of the same geometry.

## Placeholders to confirm

`config/brand/stryker.json` carries provisional brand values: palette, the
`//` chevron mark, and `strykertradingacademy.com`. Replace them with the real
brand tokens before publishing.
