# MCQ Shorts Agent

Monorepo: **backend** (Node.js API + video pipeline) and **frontend** (React + Vite).

## Layout

```
.
├── backend/
│   └── src/
│       ├── common/            # Shared across both services
│       │   ├── config/        # env, paths, default config
│       │   ├── db/            # Mongo models + connection
│       │   ├── middleware/    # auth, audit, errors
│       │   ├── routes/        # auth, settings, publish, admin, …
│       │   ├── services/      # S3, TTS, OAuth, settings, …
│       │   └── utils/         # ffmpeg, retry, jobRunner, textSanitizer
│       ├── mcq/               # MCQ quiz video generator service
│       │   ├── agents/        # prompt, MCQ, export agents
│       │   ├── pipeline/      # render pipeline (audio, captions, mux)
│       │   ├── videoJob/      # job worker phases + progress
│       │   ├── routes/        # videos, jobs, uploads
│       │   └── utils/         # quiz fonts, languages, theme, queue
│       ├── story/             # Story AI video generator service
│       │   ├── ai/            # OpenAI helpers, translation
│       │   ├── io/            # S3 / HTTP asset download
│       │   ├── lib/           # types, options, subtitles, idempotency
│       │   ├── narration/     # TTS, alignment, scene matching
│       │   ├── pipeline/      # orchestration, re-render, finalize, queue
│       │   ├── render/        # FFmpeg clip extract, cache, overlays
│       │   ├── scene/         # scene detection (ffmpeg + pyscenedetect)
│       │   └── routes/        # story-video HTTP API
│       ├── app.ts, index.ts, lambda/
│       └── assets/
├── frontend/
│   └── src/
│       ├── features/story-video/   # pages, components, hooks, API for story editor
│       ├── pages/                  # MCQ app pages (dashboard, create, …)
│       ├── components/, api/, hooks/, lib/
│       └── …
├── package.json # npm workspaces — install once at repo root
└── Makefile     # shortcuts for common commands
```

Root-level shims under `backend/src/story/` (`pipeline.ts`, `queueStoryVideoJob.ts`, …) re-export from the grouped modules so Lambda handlers and legacy imports stay stable.

## Credentials model

The app uses **per-user credentials** for AI and publishing integrations.

- Configure these in **Settings / Publishing UI** (stored encrypted per user):
  - OpenAI API key + API URL
  - YouTube OAuth client + refresh token
  - Instagram Graph token/account linkage
  - ElevenLabs API key (optional)

- Keep **server/runtime** settings in environment variables (repo root `.env` or `backend/.env`; both are loaded):
  - `MONGO_URI`, `DB_NAME`
  - `JWT_SECRET`
  - `KMS_KEY_ID` or `APP_ENCRYPTION_KEY`
  - `CORS_ORIGIN`
  - `OUTPUT_DIR`, `UPLOADS_DIR`, `CACHE_DIR`, `TEMP_DIR`
  - optional Meta app values: `META_APP_ID`, `META_APP_SECRET`, `META_REDIRECT_URI`

Notes:

- `OPENAI_API_KEY` is not used by the main API request flow; it is relevant for local CLI (`npm run video`).
- YouTube env credentials are not required for normal app usage; user-level settings are used.

## Local development

Install dependencies once at the **repository root** (uses a hoisted install via `.npmrc` so the backend does not get a broken nested `node_modules`):

```bash
npm install
```

- **API + optional static UI** (serves `frontend/dist` if built):

```bash
npm run dev
# or: make dev
```

- **Frontend only** (Vite, port 5173, proxies `/api` to the backend):

```bash
npm run ui
# or: make ui
```

Always run `npm install` from the repo root so Vite stays hoisted there. If you see missing `vite/dist/...` modules, delete `frontend/node_modules` and run `npm install` again from the root.

## Commands

Run from the **repo root** (`npm install` once):

| Command | What it does |
|---------|----------------|
| `npm run dev` / `make dev` | API server |
| `npm run ui` / `make ui` | React UI (Vite, port 5173) |
| `npm run build` / `make build` | Build backend + frontend |
| `npm run start` / `make start` | Run compiled API |
| `npm run test` / `make test` | Smoke test (health, auth, TTS preview) |
| `npm run clean` / `make clean` | Delete `backend/dist` |
| `npm run video` / `make video` | MCQ video CLI (local script) |

Extra tests (from root, backend workspace):

```bash
npm run test:api -w backend      # full API route exercise
npm run test:story -w backend    # story-video asset + re-render smokes
```

## Build

```bash
npm run build
```

Produces `backend/dist` and `frontend/dist`.

## Smoke tests

```bash
npm run test
```

Optional full media smoke (TTS preview, manual generation, playback):

```bash
SMOKE_OPENAI_API_KEY=sk-... npm run test
# or
SMOKE_ELEVENLABS_API_KEY=... npm run test
```

## Docker (backend)

From `backend/` (see `backend/docker-compose.yml` and `backend/Dockerfile`):

```bash
cd backend
docker compose up --build
```

Place a `.env` in `backend/` or rely on paths documented in `docker-compose.yml`.
