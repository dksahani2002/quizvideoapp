#!/usr/bin/env bash
# Comprehensive backend API smoke test (local/dev).
# Boots server → exercises key endpoints with a real user.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

command -v curl >/dev/null 2>&1 || { echo "curl required" >&2; exit 1; }

PORT="${API_TEST_PORT:-$((41000 + RANDOM % 8000))}"
export NODE_ENV="${NODE_ENV:-development}"
export PORT

cleanup() {
  if [[ -n "${SERVER_PID:-}" ]] && kill -0 "$SERVER_PID" 2>/dev/null; then
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

echo "Starting server on PORT=$PORT"
if [[ -f dist/index.js ]]; then
  node dist/index.js & SERVER_PID=$!
else
  ./node_modules/.bin/tsx src/index.ts & SERVER_PID=$!
fi

BASE="http://127.0.0.1:${PORT}"

wait_health() {
  for i in $(seq 1 90); do
    if curl -sf "${BASE}/health" >/dev/null 2>&1; then
      echo "Health OK (${i}s)"
      return 0
    fi
    sleep 1
  done
  echo "Server did not become healthy within 90s." >&2
  return 1
}

assert_http() {
  local expected="$1"; shift
  local outFile="$1"; shift
  local label="$1"; shift
  local code
  code="$(curl -sS -o "$outFile" -w "%{http_code}" "$@")"
  if [[ "$code" != "$expected" ]]; then
    echo "Expected HTTP ${expected}, got ${code} for ${label}" >&2
    python3 - <<'PY' "$outFile"
import json,sys,pathlib
p=pathlib.Path(sys.argv[1])
try:
  print(p.read_text()[:2000])
except Exception as e:
  print(f"<could not read body: {e}>")
PY
    exit 1
  fi
}

wait_health

TMP_DIR="${TMPDIR:-/tmp}"
R1="${TMP_DIR}/mcq_api_test_register_$$.json"
R2="${TMP_DIR}/mcq_api_test_login_$$.json"
R3="${TMP_DIR}/mcq_api_test_me_$$.json"
R4="${TMP_DIR}/mcq_api_test_settings_get_$$.json"
R5="${TMP_DIR}/mcq_api_test_settings_put_$$.json"
R6="${TMP_DIR}/mcq_api_test_tts_$$.mp3"
R7="${TMP_DIR}/mcq_api_test_videos_$$.json"
R8="${TMP_DIR}/mcq_api_test_analytics_$$.json"
R9="${TMP_DIR}/mcq_api_test_publish_ig_$$.json"
R10="${TMP_DIR}/mcq_api_test_publish_yt_$$.json"
R11="${TMP_DIR}/mcq_api_test_admin_users_$$.json"

EMAIL="api_test_$(date +%s)@example.com"
PASS="testpass12345"

echo "Test: POST /api/auth/register"
assert_http 201 "$R1" "POST /api/auth/register" -X POST "${BASE}/api/auth/register" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"API Test\",\"email\":\"${EMAIL}\",\"password\":\"${PASS}\"}"

TOKEN="$(python3 - <<'PY' "$R1"
import json,sys
d=json.load(open(sys.argv[1]))
print(d.get("data",{}).get("token",""))
PY
)"
if [[ -z "$TOKEN" ]]; then
  echo "No token in register response" >&2
  cat "$R1" >&2 || true
  exit 1
fi

echo "Test: POST /api/auth/login"
assert_http 200 "$R2" "POST /api/auth/login" -X POST "${BASE}/api/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"${EMAIL}\",\"password\":\"${PASS}\"}"

echo "Test: GET /api/auth/me"
assert_http 200 "$R3" "GET /api/auth/me" "${BASE}/api/auth/me" \
  -H "Authorization: Bearer ${TOKEN}"

echo "Test: GET /api/settings"
assert_http 200 "$R4" "GET /api/settings" "${BASE}/api/settings" \
  -H "Authorization: Bearer ${TOKEN}"

echo "Test: PUT /api/settings (minimal)"
if [[ -n "${KMS_KEY_ID:-}" || -n "${APP_ENCRYPTION_KEY:-}" ]]; then
  assert_http 200 "$R5" "PUT /api/settings" -X PUT "${BASE}/api/settings" \
    -H "Authorization: Bearer ${TOKEN}" \
    -H "Content-Type: application/json" \
    -d '{"tts":{"provider":"system","voice":"Alex"},"openai":{"apiUrl":"https://api.openai.com/v1"}}'
else
  echo "Skip: PUT /api/settings (set APP_ENCRYPTION_KEY or KMS_KEY_ID to enable)"
fi

echo "Test: POST /api/tts/preview"
assert_http 200 "$R6" "POST /api/tts/preview" -X POST "${BASE}/api/tts/preview" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"ttsProvider":"system","systemVoice":"Alex"}'
BYTES=$(wc -c < "$R6" | tr -d ' ')
echo "TTS preview bytes: ${BYTES}"

echo "Test: GET /api/videos (empty ok)"
assert_http 200 "$R7" "GET /api/videos" "${BASE}/api/videos" \
  -H "Authorization: Bearer ${TOKEN}"

echo "Test: GET /api/analytics/summary"
assert_http 200 "$R8" "GET /api/analytics/summary" "${BASE}/api/analytics/summary" \
  -H "Authorization: Bearer ${TOKEN}"

echo "Test: GET /api/publish/instagram/connect-url (may be 400 if Meta not configured)"
code="$(curl -sS -o "$R9" -w "%{http_code}" "${BASE}/api/publish/instagram/connect-url" -H "Authorization: Bearer ${TOKEN}")"
if [[ "$code" != "200" && "$code" != "400" ]]; then
  echo "Expected HTTP 200 or 400 for instagram connect-url, got $code" >&2
  head -c 2000 "$R9" >&2 || true
  exit 1
fi

echo "Test: GET /api/publish/youtube/connect-url (may be 400 if YouTube not configured)"
code="$(curl -sS -o "$R10" -w "%{http_code}" "${BASE}/api/publish/youtube/connect-url" -H "Authorization: Bearer ${TOKEN}")"
if [[ "$code" != "200" && "$code" != "400" ]]; then
  echo "Expected HTTP 200 or 400 for youtube connect-url, got $code" >&2
  head -c 2000 "$R10" >&2 || true
  exit 1
fi

echo "Test: GET /api/admin/users (should be 403 for non-admin)"
code="$(curl -sS -o "$R11" -w "%{http_code}" "${BASE}/api/admin/users" -H "Authorization: Bearer ${TOKEN}")"
if [[ "$code" != "403" ]]; then
  echo "Expected HTTP 403 for /api/admin/users as non-admin, got $code" >&2
  head -c 2000 "$R11" >&2 || true
  exit 1
fi

rm -f "$R1" "$R2" "$R3" "$R4" "$R5" "$R6" "$R7" "$R8" "$R9" "$R10" "$R11" 2>/dev/null || true
echo "API tests OK"

