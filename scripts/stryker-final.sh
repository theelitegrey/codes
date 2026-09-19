#!/usr/bin/env bash
# Builds the finished Stryker promo. Needs: ffmpeg, curl, and a HeyGen API key.
# No repo checkout and no Node required.
#
#   HEYGEN_API_KEY=sk_... ./stryker-final.sh stryker-graphics.mp4
#
# Downloads the rendered presenter, overlays it on the graphics layer and
# writes stryker-final.mp4.
set -euo pipefail

GRAPHICS="${1:-stryker-graphics.mp4}"
VIDEO_ID="${HEYGEN_VIDEO_ID:-e917123993c30a386a83525c3919f0ac}"
OUT="${2:-stryker-final.mp4}"
PRESENTER="presenter.webm"

[ -f "$GRAPHICS" ] || { echo "missing graphics layer: $GRAPHICS" >&2; exit 1; }
[ -n "${HEYGEN_API_KEY:-}" ] || { echo "set HEYGEN_API_KEY" >&2; exit 1; }

if [ ! -f "$PRESENTER" ]; then
  echo "==> fetching presenter $VIDEO_ID"
  URL=$(curl -fsS -H "X-Api-Key: $HEYGEN_API_KEY" \
        "https://api.heygen.com/v3/videos/$VIDEO_ID" \
        | grep -o '"video_url"[[:space:]]*:[[:space:]]*"[^"]*"' \
        | head -1 | sed 's/.*"video_url"[[:space:]]*:[[:space:]]*"//; s/"$//')
  [ -n "$URL" ] || { echo "no video_url yet — is the video still rendering?" >&2; exit 1; }
  curl -fL --progress-bar -o "$PRESENTER" "$URL"
fi

# Frame geometry: the promo reserves the bottom 46% of 1080x1920 for the
# presenter. HeyGen returns a 1080x1080 square, so scale to COVER that band
# and crop it off the bottom of the scaled frame, which keeps the head.
H=$(ffprobe -v error -select_streams v:0 -show_entries stream=height -of default=noprint_wrappers=1:nokey=1 "$GRAPHICS")
W=$(ffprobe -v error -select_streams v:0 -show_entries stream=width  -of default=noprint_wrappers=1:nokey=1 "$GRAPHICS")
BAND=$(( H * 46 / 100 )); BAND=$(( BAND - BAND % 2 ))
TOP=$(( H - BAND ))

echo "==> compositing ${W}x${H}, presenter band ${BAND}px"
# -c:v libvpx-vp9 on the INPUT is required: VP9 hides alpha in a WebM
# side-channel and the default decoder silently drops it, which would
# composite the presenter as an opaque rectangle.
ffmpeg -hide_banner -y \
  -i "$GRAPHICS" \
  -c:v libvpx-vp9 -i "$PRESENTER" \
  -filter_complex \
    "[1:v]scale=${W}:${BAND}:force_original_aspect_ratio=increase:flags=lanczos,\
     crop=${W}:${BAND}:(iw-${W})/2:ih-${BAND},format=yuva420p[p];\
     [0:v][p]overlay=0:${TOP}:format=auto:shortest=0[v]" \
  -map "[v]" -map 1:a \
  -c:v libx264 -preset slow -crf 18 -pix_fmt yuv420p \
  -c:a aac -b:a 192k -ar 48000 -ac 2 \
  -movflags +faststart "$OUT"

echo "==> $OUT"
ffprobe -v error -show_entries format=duration -show_entries stream=codec_name,width,height -of default=nw=1 "$OUT"
