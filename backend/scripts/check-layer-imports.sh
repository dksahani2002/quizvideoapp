#!/usr/bin/env bash
# Enforce backend layer import boundaries (capabilities refactor).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/src"
fail=0

check() {
  local label="$1"
  local dir="$2"
  local pattern="$3"
  local hits
  hits="$(rg -n "$pattern" "$dir" --glob '*.ts' 2>/dev/null || true)"
  if [[ -n "$hits" ]]; then
    echo "FAIL [$label]: forbidden imports in $dir"
    echo "$hits"
    echo
    fail=1
  fi
}

check "common→verticals" "$SRC/common" "from ['\"].*/(mcq|story|trailer)/"
check "capabilities→verticals" "$SRC/capabilities" "from ['\"].*/(mcq|story|trailer)/"
check "story→mcq" "$SRC/story" "from ['\"].*/mcq/"
check "trailer→mcq|story" "$SRC/trailer" "from ['\"].*/(mcq|story)/"

# Migration shims should not be imported outside their own folder.
check "openaiStory shim" "$SRC" "from ['\"].*/story/ai/openaiStory"
check "ttsNarration shim" "$SRC" "from ['\"].*/story/narration/ttsNarration"
check "detectFacade shim" "$SRC" "from ['\"].*/story/scene/detectFacade"
check "mcq ttsResolution shim" "$SRC" "from ['\"].*/mcq/videoJob/ttsResolution"
check "trailer→story/render/ffmpeg" "$SRC/trailer" "from ['\"].*/story/render/ffmpeg"

if [[ "$fail" -ne 0 ]]; then
  echo "Layer import check failed."
  exit 1
fi

echo "Layer import check passed."
