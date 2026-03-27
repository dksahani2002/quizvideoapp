# MCQ Shorts Agent

Backend + frontend app to generate quiz videos and publish to social platforms.

## Architecture at a glance

- Backend: Node.js + Express + MongoDB (`src/`)
- Frontend: React + Vite (`frontend/`)
- Rendering pipeline: ffmpeg-based (`src/pipeline/`)
- Per-user secrets: encrypted `UserSettings` storage

## Credentials model

The app uses **per-user credentials** for AI and publishing integrations.

- Configure these in **Settings / Publishing UI** (stored encrypted per user):
  - OpenAI API key + API URL
  - YouTube OAuth client + refresh token
  - Instagram Graph token/account linkage
  - ElevenLabs API key (optional)

- Keep only **server/runtime infrastructure settings** in environment variables:
  - `MONGO_URI`, `DB_NAME`
  - `JWT_SECRET`
  - `KMS_KEY_ID` or `APP_ENCRYPTION_KEY`
  - `CORS_ORIGIN`
  - storage/runtime values like `OUTPUT_DIR`, `UPLOADS_DIR`, `CACHE_DIR`, `TEMP_DIR`
  - optional Meta app values for OAuth broker flow: `META_APP_ID`, `META_APP_SECRET`, `META_REDIRECT_URI`

Notes:
- `OPENAI_API_KEY` is not used by the API server request flow anymore. It is only relevant for local CLI tools.
- YouTube env credentials are no longer required for normal app usage; user-level settings are used.

## Local development

### Backend

```bash
npm install
npm run dev
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

## Build

```bash
# backend
npm run build

# frontend
cd frontend && npm run build
```

## Smoke tests

```bash
# basic smoke (health/register/settings)
bash scripts/smoke.sh
```

Optional full media smoke (includes TTS preview, manual generation, playback URL + range stream):

```bash
SMOKE_OPENAI_API_KEY=sk-... bash scripts/smoke.sh
# or
SMOKE_ELEVENLABS_API_KEY=... bash scripts/smoke.sh
```

