#!/usr/bin/env bash
# Generates demo media fixtures under RECORDING_LOCAL_DIR:
#   live-source.mp4, sample-session.mp4, live-<slug>.mp4,
#   simulated-origin/index.m3u8, simulated-origin/<slug>/index.m3u8,
#   covers/<slug>.jpg, covers/ended.jpg
#
# Env:
#   RECORDING_LOCAL_DIR       output root (default: var/recordings)
#   LIVE_SOURCE_VIDEO         single clip copied/stream-copied for every slug
#   LIVE_SOURCE_MAP           per-slug sources: slug=path;slug=path
#   SAMPLE_SESSION_SECONDS    replay length (default: 120)
#   LIVE_SOURCE_SECONDS       synthetic clip length (default: 60)
#
# When no source is supplied, a synthetic testsrc clip is generated.
# Existing room clips are retained when omitted from a later LIVE_SOURCE_MAP.
set -euo pipefail

DIR="${RECORDING_LOCAL_DIR:-var/recordings}"
MAP_FILE="$DIR/.live-source-map"
SAMPLE_SECONDS="${SAMPLE_SESSION_SECONDS:-120}"
SOURCE_SECONDS="${LIVE_SOURCE_SECONDS:-60}"

DEFAULT_SLUGS="headphones-live phones-live decor-live gym-live glow-live"

if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "make-sample-video: ffmpeg not found — install ffmpeg and retry" >&2
  exit 1
fi

mkdir -p "$DIR/covers" "$DIR/simulated-origin"

generate_mp4() {
  local out="$1" duration="$2" _label="${3:-Demo}"
  ffmpeg -hide_banner -loglevel error -y \
    -f lavfi -i "testsrc=size=1280x720:rate=25:duration=${duration}" \
    -f lavfi -i "sine=frequency=440:duration=${duration}" \
    -t "$duration" \
    -c:v libx264 -preset ultrafast -pix_fmt yuv420p -c:a aac -movflags +faststart \
    "$out"
}

copy_or_generate() {
  local src="$1" out="$2" label="$3"
  if [[ -n "$src" && -f "$src" ]]; then
    ffmpeg -hide_banner -loglevel error -y -i "$src" -c copy -movflags +faststart "$out"
  else
    generate_mp4 "$out" "$SOURCE_SECONDS" "$label"
  fi
}

make_hls() {
  local input="$1" outdir="$2"
  mkdir -p "$outdir"
  rm -f "$outdir"/*.ts "$outdir"/index.m3u8
  ffmpeg -hide_banner -loglevel error -y -i "$input" \
    -c:v libx264 -preset ultrafast -pix_fmt yuv420p -c:a aac \
    -hls_time 4 -hls_playlist_type vod \
    -hls_segment_filename "$outdir/seg_%03d.ts" \
    "$outdir/index.m3u8"
}

extract_cover() {
  local input="$1" out="$2"
  ffmpeg -hide_banner -loglevel error -y -ss 2 -i "$input" -frames:v 1 -q:v 3 "$out"
}

slug_source_for() {
  local slug="$1"
  local pair slug_part path_part
  if [[ -n "${LIVE_SOURCE_MAP:-}" ]]; then
    IFS=';' read -ra PAIRS <<< "$LIVE_SOURCE_MAP"
    for pair in "${PAIRS[@]}"; do
      pair="${pair#"${pair%%[![:space:]]*}"}"
      pair="${pair%"${pair##*[![:space:]]}"}"
      [[ -z "$pair" ]] && continue
      slug_part="${pair%%=*}"
      path_part="${pair#*=}"
      slug_part="${slug_part#"${slug_part%%[![:space:]]*}"}"
      slug_part="${slug_part%"${slug_part##*[![:space:]]}"}"
      path_part="${path_part#"${path_part%%[![:space:]]*}"}"
      path_part="${path_part%"${path_part##*[![:space:]]}"}"
      if [[ "$slug_part" == "$slug" ]]; then
        printf '%s' "$path_part"
        return 0
      fi
    done
  elif [[ -f "$MAP_FILE" ]]; then
    while IFS='=' read -r slug_part path_part; do
      [[ -z "$slug_part" || -z "$path_part" ]] && continue
      if [[ "$slug_part" == "$slug" ]]; then
        printf '%s' "$path_part"
        return 0
      fi
    done < "$MAP_FILE"
  fi
  return 1
}

if [[ -n "${LIVE_SOURCE_MAP:-}" ]]; then
  : > "$MAP_FILE"
  IFS=';' read -ra PAIRS <<< "$LIVE_SOURCE_MAP"
  for pair in "${PAIRS[@]}"; do
    pair="${pair#"${pair%%[![:space:]]*}"}"
    pair="${pair%"${pair##*[![:space:]]}"}"
    [[ -z "$pair" ]] && continue
    slug_part="${pair%%=*}"
    path_part="${pair#*=}"
    slug_part="${slug_part#"${slug_part%%[![:space:]]*}"}"
    slug_part="${slug_part%"${slug_part##*[![:space:]]}"}"
    path_part="${path_part#"${path_part%%[![:space:]]*}"}"
    path_part="${path_part%"${path_part##*[![:space:]]}"}"
    [[ -n "$slug_part" && -n "$path_part" ]] && printf '%s=%s\n' "$slug_part" "$path_part" >> "$MAP_FILE"
  done
fi

GLOBAL_SOURCE="${LIVE_SOURCE_VIDEO:-}"

echo "make-sample-video: writing fixtures to $DIR"

copy_or_generate "$GLOBAL_SOURCE" "$DIR/live-source.mp4" "Live source"

if [[ -n "$GLOBAL_SOURCE" && -f "$GLOBAL_SOURCE" ]]; then
  ffmpeg -hide_banner -loglevel error -y -i "$GLOBAL_SOURCE" -t "$SAMPLE_SECONDS" \
    -c copy -movflags +faststart "$DIR/sample-session.mp4" 2>/dev/null \
    || copy_or_generate "$GLOBAL_SOURCE" "$DIR/sample-session.mp4" "Sample session"
else
  generate_mp4 "$DIR/sample-session.mp4" "$SAMPLE_SECONDS" "Sample session"
fi

make_hls "$DIR/live-source.mp4" "$DIR/simulated-origin"

for slug in $DEFAULT_SLUGS; do
  slug_src=""
  if slug_src="$(slug_source_for "$slug")"; then
    :
  else
    slug_src="$GLOBAL_SOURCE"
  fi

  live_out="$DIR/live-${slug}.mp4"
  if [[ -n "${LIVE_SOURCE_MAP:-}" || -n "${LIVE_SOURCE_VIDEO:-}" || ! -f "$live_out" ]]; then
    copy_or_generate "$slug_src" "$live_out" "$slug"
    make_hls "$live_out" "$DIR/simulated-origin/${slug}"
    if [[ "$slug" != "glow-live" ]]; then
      extract_cover "$live_out" "$DIR/covers/${slug}.jpg"
    fi
  else
    echo "make-sample-video: retaining existing live-${slug}.mp4"
    if [[ ! -f "$DIR/simulated-origin/${slug}/index.m3u8" && -f "$live_out" ]]; then
      make_hls "$live_out" "$DIR/simulated-origin/${slug}"
    fi
    if [[ "$slug" != "glow-live" && ! -f "$DIR/covers/${slug}.jpg" && -f "$live_out" ]]; then
      extract_cover "$live_out" "$DIR/covers/${slug}.jpg"
    fi
  fi
done

extract_cover "$DIR/sample-session.mp4" "$DIR/covers/ended.jpg"

echo "make-sample-video: done"
