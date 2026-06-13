#!/usr/bin/env bash
# Tests story-video re-render (editor round-trip): same as clicking "Save & re-render" with the saved timeline.
# Prereq: a job that already reached status=completed (initial pipeline finished).
#
# Usage:
#   export STORY_TOKEN="<jwt>"
#   export STORY_RERENDER_JOB_ID="<mongodb ObjectId>"
#   optional: STORY_API_BASE=http://127.0.0.1:3002
#
# The script POSTs { "render": true } (no timeline body) so the server re-exports using the current DB timeline,
# then polls until the job is completed again.
set -euo pipefail

BASE="${STORY_API_BASE:-http://127.0.0.1:3002}"
TOKEN="${STORY_TOKEN:?Set STORY_TOKEN to a JWT (same as localStorage token)}"
JOB="${STORY_RERENDER_JOB_ID:?Set STORY_RERENDER_JOB_ID to a completed story-video job id}"

command -v curl >/dev/null 2>&1 || { echo "curl required" >&2; exit 1; }

echo "Checking job status…"
STATUS=$(curl -sS -H "Authorization: Bearer ${TOKEN}" "${BASE}/api/story-video/${JOB}/status")
# crude parse without jq
if echo "$STATUS" | grep -qE '"status"[[:space:]]*:[[:space:]]*"completed"'; then
  echo "Job is completed — queueing re-render."
elif echo "$STATUS" | grep -qE '"status"[[:space:]]*:[[:space:]]*"processing"'; then
  echo "Job is still processing; wait for the first render to finish, then re-run." >&2
  exit 1
else
  echo "Unexpected status response: $STATUS" >&2
  exit 1
fi

echo "POST /edit { render: true }…"
RESP=$(curl -sS -X POST "${BASE}/api/story-video/${JOB}/edit" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"render":true}')
echo "$RESP"

if ! echo "$RESP" | grep -qE '"success"[[:space:]]*:[[:space:]]*true'; then
  echo "Edit request failed" >&2
  exit 1
fi
if ! echo "$RESP" | grep -q 'asyncRerender'; then
  echo "Expected async re-render response" >&2
  exit 1
fi

echo "Polling status (every 3s, up to ~20 min)…"
for _ in $(seq 1 400); do
  sleep 3
  ST=$(curl -sS -H "Authorization: Bearer ${TOKEN}" "${BASE}/api/story-video/${JOB}/status")
  if echo "$ST" | grep -qE '"status"[[:space:]]*:[[:space:]]*"completed"'; then
    echo "Re-render completed."
    curl -sS -H "Authorization: Bearer ${TOKEN}" "${BASE}/api/story-video/${JOB}/result" | head -c 400
    echo ""
    echo "Done. Open the editor in the app and play the preview URL from the result."
    exit 0
  fi
  if echo "$ST" | grep -qE '"status"[[:space:]]*:[[:space:]]*"failed"'; then
    echo "Job failed: $ST" >&2
    exit 1
  fi
  PCT=$(echo "$ST" | sed -n 's/.*"progressPercent":\([0-9]*\).*/\1/p' | head -1)
  MSG=$(echo "$ST" | sed -n 's/.*"progressMessage":"\([^"]*\)".*/\1/p' | head -1)
  echo "… ${PCT}% ${MSG}"
done

echo "Timeout waiting for completion" >&2
exit 1
