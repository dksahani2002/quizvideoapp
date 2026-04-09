!/usr/bin/env bash
# Post-deploy / local smoke test: health → register → TTS preview (system voice).
# Requires: curl, MongoDB reachable per .env, Node deps installed.
# Usage: ./scripts/smoke.sh   or   SMOKE_PORT=40123 ./scripts/smoke.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

command -v curl >/dev/null 2>&1 || { echo "curl required" >&2; exit 1; }

PORT="${SMOKE_PORT:-$((40000 + RANDOM % 9000))}"
export NODE_ENV="${NODE_ENV:-development}"
export PORT

# Ensure per-user settings encryption works in dev smoke runs.
# (In production, use KMS_KEY_ID or set APP_ENCRYPTION_KEY explicitly.)
if [[ -z "${KMS_KEY_ID:-}" && -z "${APP_ENCRYPTION_KEY:-}" ]]; then
  export APP_ENCRYPTION_KEY="smoke_${RANDOM}_${RANDOM}_${RANDOM}_${RANDOM}_0123456789abcdef0123456789abcdef"
fi

cleanup() {
  if [[ -n "${SERVER_PID:-}" ]] && kill -0 "$SERVER_PID" 2>/dev/null; then
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

if [[ -f dist/index.js ]]; then
  echo "Starting server: node dist/index.js (PORT=$PORT)"
  node dist/index.js & SERVER_PID=$!
else
  echo "Starting server: tsx src/index.ts (PORT=$PORT)"
  ./node_modules/.bin/tsx src/index.ts & SERVER_PID=$!
fi

# Give the process a moment to spawn before probing.
sleep 0.2

HEALTHY=0
for i in $(seq 1 90); do
  if curl -sf "http://127.0.0.1:${PORT}/health" >/dev/null 2>&1; then
    echo "Health OK (${i}s)"
    HEALTHY=1
    break
  fi
  sleep 1
done

if [[ "$HEALTHY" != "1" ]]; then
  echo "Server did not become healthy within 90s." >&2
  exit 1
fi

HEALTH_JSON=$(curl -sf "http://127.0.0.1:${PORT}/health") || {
  echo "GET /health failed" >&2
  exit 1
}
echo "$HEALTH_JSON"
if ! echo "$HEALTH_JSON" | grep -q '"database"'; then
  echo "Warning: /health JSON missing database field (old server on this port?)" >&2
fi

EMAIL="smoke_$(date +%s)@example.com"
REG=$(curl -sf -X POST "http://127.0.0.1:${PORT}/api/auth/register" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"Smoke\",\"email\":\"${EMAIL}\",\"password\":\"testpass12345\"}") || {
  echo "POST /api/auth/register failed" >&2
  exit 1
}

TOKEN=$(echo "$REG" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('data',{}).get('token',''))" 2>/dev/null || true)
if [[ -z "$TOKEN" ]]; then
  echo "No token in register response: $REG" >&2
  exit 1
fi

OUT="${TMPDIR:-/tmp}/mcq_smoke_preview_$$.mp3"
BYTES=0
rm -f "$OUT" 2>/dev/null || true

echo "Test: PUT /api/settings (minimal)"
OPENAI_KEY="${SMOKE_OPENAI_API_KEY:-${OPENAI_API_KEY:-}}"
EL_KEY="${SMOKE_ELEVENLABS_API_KEY:-${ELEVENLABS_API_KEY:-}}"

SETTINGS_PAYLOAD='{"tts":{"provider":"system","voice":"Alex"},"openai":{"apiUrl":"https://api.openai.com/v1"}}'
if [[ -n "${OPENAI_KEY:-}" ]]; then
  SETTINGS_PAYLOAD=$(python3 - <<PY
import json
print(json.dumps({"tts":{"provider":"openai","voice":"alloy"},"openai":{"apiUrl":"https://api.openai.com/v1","apiKey":"${OPENAI_KEY}"}}))
PY
)
elif [[ -n "${EL_KEY:-}" ]]; then
  SETTINGS_PAYLOAD=$(python3 - <<PY
import json
print(json.dumps({"tts":{"provider":"elevenlabs","voice":""},"openai":{"apiUrl":"https://api.openai.com/v1"},"elevenlabs":{"apiKey":"${EL_KEY}","modelId":"eleven_turbo_v2_5","voiceId":"21m00Tcm4TlvDq8ikWAM","voiceName":"Rachel"}}))
PY
)
fi

SETTINGS=$(curl -sf -X PUT "http://127.0.0.1:${PORT}/api/settings" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d "${SETTINGS_PAYLOAD}") || {
  echo "PUT /api/settings failed" >&2
  exit 1
}
if ! echo "$SETTINGS" | grep -q '"success"[[:space:]]*:[[:space:]]*true'; then
  echo "PUT /api/settings did not return success: $SETTINGS" >&2
  exit 1
fi

if [[ -z "${OPENAI_KEY:-}" && -z "${EL_KEY:-}" ]]; then
  echo "Skip: media generation (set SMOKE_OPENAI_API_KEY or SMOKE_ELEVENLABS_API_KEY to fully exercise video/stream)"
  echo "Smoke OK — basic API + settings OK"
  exit 0
fi

echo "Test: POST /api/tts/preview"
if [[ -n "${OPENAI_KEY:-}" ]]; then
  HTTP=$(curl -sS -o "$OUT" -w "%{http_code}" -X POST "http://127.0.0.1:${PORT}/api/tts/preview" \
    -H "Authorization: Bearer ${TOKEN}" \
    -H "Content-Type: application/json" \
    -d '{"ttsProvider":"openai","ttsVoice":"alloy","ttsModel":"tts-1"}')
else
  HTTP=$(curl -sS -o "$OUT" -w "%{http_code}" -X POST "http://127.0.0.1:${PORT}/api/tts/preview" \
    -H "Authorization: Bearer ${TOKEN}" \
    -H "Content-Type: application/json" \
    -d '{"ttsProvider":"elevenlabs","ttsVoice":"21m00Tcm4TlvDq8ikWAM","elevenlabsModelId":"eleven_turbo_v2_5"}')
fi

if [[ "$HTTP" != "200" ]]; then
  echo "POST /api/tts/preview failed: HTTP $HTTP" >&2
  head -c 500 "$OUT" 2>/dev/null || true
  echo >&2
  exit 1
fi

BYTES=$(wc -c < "$OUT" | tr -d ' ')
rm -f "$OUT" 2>/dev/null || true

echo "Test: POST /api/videos/generate (manual, 1 question)"
GEN=$(curl -sf -X POST "http://127.0.0.1:${PORT}/api/videos/generate" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "topic":"Smoke Test",
    "questionCount":1,
    "mcqSource":"manual",
    "ttsProvider":"'"$( [[ -n "${OPENAI_KEY:-}" ]] && echo openai || echo elevenlabs )"'",
    "manualQuizzes":[
      {"question":"2+2=?","options":["3","4","5","22"],"answerIndex":1}
    ]
  }') || {
  echo "POST /api/videos/generate failed" >&2
  exit 1
}

JOB_ID=$(echo "$GEN" | python3 -c "import sys,json; d=json.load(sys.stdin); print((d.get('data') or [{}])[0].get('jobId',''))" 2>/dev/null || true)
VIDEO_ID=$(echo "$GEN" | python3 -c "import sys,json; d=json.load(sys.stdin); print((d.get('data') or [{}])[0].get('videoId',''))" 2>/dev/null || true)
if [[ -z "$JOB_ID" || -z "$VIDEO_ID" ]]; then
  echo "Missing jobId/videoId in generate response: $GEN" >&2
  exit 1
fi

echo "Waiting for job to complete: ${JOB_ID}"
JOB_OK=0
JOB_STATUS=""
for i in $(seq 1 240); do
  J=$(curl -sf "http://127.0.0.1:${PORT}/api/jobs/${JOB_ID}" -H "Authorization: Bearer ${TOKEN}") || true
  JOB_STATUS=$(echo "$J" | python3 -c "import sys,json; d=json.load(sys.stdin); print((d.get('data') or {}).get('status',''))" 2>/dev/null || true)
  if [[ "$JOB_STATUS" == "completed" ]]; then
    JOB_OK=1
    break
  fi
  if [[ "$JOB_STATUS" == "failed" || "$JOB_STATUS" == "cancelled" ]]; then
    echo "Job ended: ${JOB_STATUS}" >&2
    echo "$J" >&2
    exit 1
  fi
  sleep 1
done

if [[ "$JOB_OK" != "1" ]]; then
  echo "Job did not complete within 240s (last status: ${JOB_STATUS})" >&2
  exit 1
fi

echo "Test: GET /api/videos/:id/play"
PLAY=$(curl -sf "http://127.0.0.1:${PORT}/api/videos/${VIDEO_ID}/play" -H "Authorization: Bearer ${TOKEN}") || {
  echo "GET /api/videos/:id/play failed" >&2
  exit 1
}
PLAY_URL=$(echo "$PLAY" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('url','') or (d.get('data') or {}).get('url',''))" 2>/dev/null || true)
if [[ -z "$PLAY_URL" ]]; then
  echo "Missing url in play response: $PLAY" >&2
  exit 1
fi
if [[ "$PLAY_URL" == /* ]]; then
  PLAY_URL="http://127.0.0.1:${PORT}${PLAY_URL}"
fi

echo "Test: video stream Range request (expect 206)"
RANGE_OUT="${TMPDIR:-/tmp}/mcq_smoke_range_$$.bin"
HTTP=$(curl -sS -o "$RANGE_OUT" -w "%{http_code}" -H "Range: bytes=0-0" "$PLAY_URL")
if [[ "$HTTP" != "206" && "$HTTP" != "200" ]]; then
  echo "Expected HTTP 206/200 for range stream, got $HTTP" >&2
  head -c 500 "$RANGE_OUT" 2>/dev/null || true
  echo >&2
  exit 1
fi
rm -f "$RANGE_OUT" 2>/dev/null || true

echo "Smoke OK — TTS preview ${BYTES} bytes; video generated; stream OK"
