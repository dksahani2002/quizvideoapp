#!/usr/bin/env bash
# Verifies POST /api/story-video/create with devVideoAsset/devAudioAsset (paths under backend/assets/).
# Does not wait for full render (large files may take a long time).
# Requires: curl, MongoDB, repo-root .env, files present under backend/assets/.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

command -v curl >/dev/null 2>&1 || { echo "curl required" >&2; exit 1; }

PORT="${STORY_DEV_SMOKE_PORT:-$((42000 + RANDOM % 7000))}"
export NODE_ENV="${NODE_ENV:-development}"
export PORT

REPO_ROOT="$(cd "$ROOT/.." && pwd)"
# Match api-test.sh: do not `source` .env (URLs/special chars break bash).
if [[ -f "${REPO_ROOT}/.env" ]]; then
  if grep -qE '^APP_ENCRYPTION_KEY=' "${REPO_ROOT}/.env" 2>/dev/null; then
    _v="$(grep -E '^APP_ENCRYPTION_KEY=' "${REPO_ROOT}/.env" | tail -1 | sed 's/^APP_ENCRYPTION_KEY=//' | tr -d '\r')"
    [[ -n "${_v}" ]] && export APP_ENCRYPTION_KEY="${_v}"
  fi
  if grep -qE '^KMS_KEY_ID=' "${REPO_ROOT}/.env" 2>/dev/null; then
    _v="$(grep -E '^KMS_KEY_ID=' "${REPO_ROOT}/.env" | tail -1 | sed 's/^KMS_KEY_ID=//' | tr -d '\r')"
    [[ -n "${_v}" ]] && export KMS_KEY_ID="${_v}"
  fi
fi

if [[ -z "${KMS_KEY_ID:-}" && -z "${APP_ENCRYPTION_KEY:-}" ]]; then
  export APP_ENCRYPTION_KEY="storydev_${RANDOM}_${RANDOM}_${RANDOM}_${RANDOM}_0123456789abcdef0123456789abcdef"
fi

VIDEO_REL="${STORY_DEV_VIDEO_ASSET:-S01E04 When Life Gives You Tangerines [1080p] [Multi Sub].mkv}"
AUDIO_REL="${STORY_DEV_AUDIO_ASSET:-AUDIO-2026-04-09-22-39-06.m4a}"

for f in "$VIDEO_REL" "$AUDIO_REL"; do
  if [[ ! -f "${ROOT}/assets/${f}" ]]; then
    echo "Missing file: backend/assets/${f}" >&2
    echo "Set STORY_DEV_VIDEO_ASSET / STORY_DEV_AUDIO_ASSET or add files under backend/assets/" >&2
    exit 1
  fi
done

cleanup() {
  if [[ -n "${SERVER_PID:-}" ]] && kill -0 "$SERVER_PID" 2>/dev/null; then
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

if [[ -f dist/index.js ]]; then
  node dist/index.js & SERVER_PID=$!
else
  npx --yes tsx src/index.ts & SERVER_PID=$!
fi

BASE="http://127.0.0.1:${PORT}"
for i in $(seq 1 90); do
  if curl -sf "${BASE}/health" >/dev/null 2>&1; then
    echo "Health OK (${i}s)"
    break
  fi
  if [[ "$i" -eq 90 ]]; then
    echo "Server did not become healthy within 90s." >&2
    exit 1
  fi
  sleep 1
done

EMAIL="storydev_$(date +%s)@example.com"
REG=$(curl -sf -X POST "${BASE}/api/auth/register" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"Dev\",\"email\":\"${EMAIL}\",\"password\":\"testpass12345\"}") || {
  echo "POST /api/auth/register failed" >&2
  exit 1
}

TOKEN=$(echo "$REG" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('data',{}).get('token',''))" 2>/dev/null || true)
if [[ -z "$TOKEN" ]]; then
  echo "No token in register response" >&2
  exit 1
fi

OPTS='{"sceneDetectionMode":"ffmpeg","subtitleMode":"sidecar_srt","bgmVolume":0,"exportPreset":"fast","narrationLanguage":"en","ttsProvider":"inherit","pySceneThreshold":27,"ffmpegSceneThreshold":0.32}'

OUT="${TMPDIR:-/tmp}/mcq_story_dev_create_$$.json"
code="$(curl -sS -o "$OUT" -w "%{http_code}" -X POST "${BASE}/api/story-video/create" \
  -H "Authorization: Bearer ${TOKEN}" \
  -F "devVideoAsset=${VIDEO_REL}" \
  -F "devAudioAsset=${AUDIO_REL}" \
  -F "options=${OPTS}")"

if [[ "$code" != "201" ]]; then
  echo "Expected HTTP 201 from POST /api/story-video/create, got ${code}" >&2
  cat "$OUT" >&2
  exit 1
fi

JOB_ID=$(python3 -c "import json; d=json.load(open('$OUT')); print(d.get('data',{}).get('jobId',''))" 2>/dev/null || true)
if [[ -z "$JOB_ID" ]]; then
  echo "No jobId in response:" >&2
  cat "$OUT" >&2
  exit 1
fi

echo "Story job created: $JOB_ID (pipeline will run in background)"
echo "OK — dev assets resolved and job queued"
