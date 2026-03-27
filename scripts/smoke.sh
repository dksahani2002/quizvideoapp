#!/usr/bin/env bash
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

cleanup() {
  if [[ -n "${SERVER_PID:-}" ]] && kill -0 "$SERVER_PID" 2>/dev/null; then
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

if [[ -f dist/index.js ]]; then
  echo "Starting server: node dist/index.js (PORT=$PORT)"
  node dist/index.js &
else
  echo "Starting server: tsx src/index.ts (PORT=$PORT)"
  ./node_modules/.bin/tsx src/index.ts &
fi
SERVER_PID=$!

for i in $(seq 1 90); do
  if curl -sf "http://127.0.0.1:${PORT}/health" >/dev/null 2>&1; then
    echo "Health OK (${i}s)"
    break
  fi
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    echo "Server process exited before becoming healthy." >&2
    exit 1
  fi
  sleep 1
done

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
HTTP=$(curl -sS -o "$OUT" -w "%{http_code}" -X POST "http://127.0.0.1:${PORT}/api/tts/preview" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"ttsProvider":"system","systemVoice":"Alex"}')

if [[ "$HTTP" != "200" ]]; then
  echo "POST /api/tts/preview failed: HTTP $HTTP" >&2
  head -c 500 "$OUT" 2>/dev/null || true
  echo >&2
  exit 1
fi

BYTES=$(wc -c < "$OUT" | tr -d ' ')
if [[ "${BYTES:-0}" -lt 1000 ]]; then
  echo "Preview file too small (${BYTES} bytes)" >&2
  exit 1
fi

rm -f "$OUT"
echo "Smoke OK — TTS preview ${BYTES} bytes (system/Alex)"
