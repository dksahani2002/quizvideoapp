# Auth & Publish Modules — Design Spec

**Date:** 2026-06-14  
**Status:** Approved (approach B)  
**Scope:** Backend module split — extract `auth/` and `publish/` from flat `common/`  
**Builds on:** `capabilities/` refactor (AI/voice/media) — complementary, not overlapping

---

## Summary

After the capabilities refactor, `common/` still mixes unrelated domains: authentication, admin, publishing, settings, analytics, and infrastructure. The intended mental model is **bounded modules at the same level as product verticals**:

```
auth/          — login, JWT, admin, audit (read)
publish/       — OAuth, scheduled publish, immediate upload, platform adapters
capabilities/  — AI, voice, media (done)
mcq/ story/ trailer/  — product orchestration
common/        — true shared infra only (config, db connection, s3, settings, tts)
```

This spec defines folder layout, dependency rules, consolidation of duplicate publish paths, edge cases, and incremental migration — **without changing HTTP routes**.

---

## Goals

1. **`auth/`** owns identity, JWT middleware, admin routes, and user model access for auth/admin
2. **`publish/`** owns all outbound video publishing (YouTube, Instagram, export plans, scheduled jobs)
3. **`common/`** shrinks to infrastructure no product module should own
4. **One-way dependencies:** verticals → publish/auth → common/capabilities
5. **No API route changes** — `/api/auth/*`, `/api/admin/*`, `/api/publish/*`, `/api/uploads/*` unchanged
6. **Incremental PRs** — each phase buildable

## Non-Goals

- Rewriting publish business logic or adding new platforms
- Moving settings/TTS/S3 out of `common/` (they are cross-cutting infra)
- Frontend folder restructure (optional follow-up)
- Merging `capabilities/` into `common/`

---

## Current State (problems)

### Auth & admin scattered in `common/`

| File | Responsibility |
|------|----------------|
| `common/controllers/authController.ts` | register, login, me |
| `common/controllers/adminController.ts` | users list, audit query |
| `common/services/authService.ts` | bcrypt, JWT sign, register/login |
| `common/services/adminService.ts` | list users, query AuditEvent |
| `common/middleware/auth.ts` | JWT middleware, requireAdmin |
| `common/db/models/User.ts` | user schema |

### Publish scattered across `common/` and `mcq/`

| File | Responsibility |
|------|----------------|
| `common/controllers/publishController.ts` | OAuth URLs, schedule, run-due, export-plan |
| `common/services/publishService.ts` | YouTube OAuth callback, Instagram connect, PublishJob runner |
| `common/services/youtubeOAuthService.ts` | Google OAuth token exchange |
| `common/services/instagramGraphService.ts` | Meta Graph reel publish |
| `common/services/platforms/youtubeService.ts` | YouTube Data API upload |
| `common/services/platforms/instagramService.ts` | Legacy/disabled password flow |
| `common/services/publishers/*` | Export adapters (TikTok, X, Snapchat plans) |
| `common/services/uploadOrchestrator.ts` | Immediate multi-platform upload |
| `common/db/models/PublishJob.ts` | scheduled publish jobs |
| `mcq/services/uploadService.ts` | **Resolves MCQ + story + trailer output → uploads** |
| `mcq/controllers/uploadController.ts` | `POST /api/uploads/:platform` |

**Problem:** Two publish entry points with overlapping YouTube upload logic:
- `/api/publish/schedule` + `run-due` → `publishService` → `platforms/youtubeService`
- `/api/uploads/youtube` → `uploadService` → `uploadOrchestrator` → `platforms/youtubeService`

Story and trailer editors use `/api/uploads/youtube` with `storyVideoJobId` / `trailerBreakdownJobId`. MCQ uses the Publishing page + schedule flow. This split confuses ownership.

### Analytics coupling

`common/services/analyticsService.ts` reads `PublishJob` counts — publish-domain data accessed from common.

### Audit middleware

`common/middleware/audit.ts` logs actions across auth, publish, videos, admin — **stays in `common/`** (cross-cutting observability infra).

---

## Three approaches

### A — Thin move (rename folders only)

Move files from `common/controllers|services` into `auth/` and `publish/` with same code.

| Pros | Cons |
|------|------|
| Fastest | Keeps duplicate upload paths |
| Low risk | `mcq/uploadService` still owns story/trailer publish |

### B — Bounded modules + consolidate publish (recommended)

Move auth/admin into `auth/`. Move all publish code into `publish/`, including:
- Relocate `uploadOrchestrator` and platform services
- Extract **video source resolution** (MCQ Video vs StoryVideoJob vs TrailerBreakdownJob) into `publish/resolveVideoSource.ts`
- `mcq/controllers/uploadController` becomes thin wrapper calling `publish/uploadService`

| Pros | Cons |
|------|------|
| Single publish domain | Medium-sized PR for upload consolidation |
| Clear ownership | Touch mcq upload path |

### C — Publish as async worker module

Same as B, plus extract `runDuePublishJobs` to a queue/worker like story/trailer pipelines.

| Pros | Cons |
|------|------|
| Scalable scheduling | Out of scope for folder refactor |
| | New infrastructure |

**Recommendation: B** — folder split plus unify publish entry points under `publish/`, defer async worker to later.

---

## Target architecture

### Dependency rule

```
mcq/ story/ trailer/
        │
        ├──► publish/ ──► common/ , capabilities/
        ├──► auth/    ──► common/
        └──► capabilities/ ──► common/

FORBIDDEN:
  auth/     → mcq | story | trailer | publish
  publish/  → mcq | story | trailer | auth
  common/   → auth | publish | mcq | story | trailer
  capabilities/ → auth | publish | verticals
```

**Exception (temporary):** `publish/resolveVideoSource.ts` may read `StoryVideoJob`, `TrailerBreakdownJob`, `Video` models from `common/db/models/` — models stay centralized in `common/db/` until a later models split.

**Auth middleware:** `auth/middleware/authMiddleware.ts` is imported by `app.ts` and all protected routes. Verticals import **middleware only** from `auth/` (not services).

### Folder layout

```
backend/src/
├── auth/
│   ├── controllers/
│   │   ├── authController.ts
│   │   └── adminController.ts
│   ├── services/
│   │   ├── authService.ts
│   │   └── adminService.ts
│   ├── middleware/
│   │   └── auth.ts          # authMiddleware, requireAdmin, AuthUser type
│   └── index.ts             # barrel: middleware + route factories
│
├── publish/
│   ├── controllers/
│   │   ├── publishController.ts
│   │   └── uploadController.ts    # moved from mcq — same /api/uploads routes
│   ├── services/
│   │   ├── publishService.ts      # OAuth, schedule, run-due
│   │   ├── uploadService.ts       # immediate upload (from mcq)
│   │   ├── resolveVideoSource.ts  # NEW — MCQ/story/trailer output → local path
│   │   ├── youtubeOAuthService.ts
│   │   ├── instagramGraphService.ts
│   │   └── analyticsService.ts    # publish stats slice (from common)
│   ├── platforms/
│   │   ├── youtubeService.ts
│   │   └── instagramService.ts
│   ├── publishers/
│   │   ├── publisherAdapter.ts
│   │   └── exportAdapters.ts
│   ├── orchestrator/
│   │   └── uploadOrchestrator.ts
│   ├── db/
│   │   └── models/
│   │       └── PublishJob.ts        # moved from common/db/models
│   └── index.ts
│
├── common/
│   ├── config/
│   ├── db/
│   │   ├── connection.ts
│   │   └── models/          # User, Video, StoryVideoJob, TrailerBreakdownJob, …
│   ├── middleware/
│   │   ├── audit.ts         # cross-cutting — stays
│   │   └── errorHandler.ts
│   ├── services/
│   │   ├── settingsService.ts
│   │   ├── s3Storage.ts
│   │   ├── ttsService.ts
│   │   ├── cryptoService.ts
│   │   └── uploadFilesService.ts  # user file uploads (backgrounds), NOT social publish
│   ├── i18n/
│   ├── utils/
│   └── controllers/
│       ├── settingsController.ts
│       ├── ttsPreviewController.ts
│       ├── analyticsController.ts   # thin — delegates publish stats to publish/
│       └── uploadFilesController.ts
│
├── capabilities/            # unchanged
├── mcq/ story/ trailer/
└── app.ts
```

### Why `PublishJob` moves but `User` stays in `common/db`

- `PublishJob` is only used by publish domain
- `User` is referenced by every vertical's job models and settings — remains shared infra model for now
- Future: `auth/db/User.ts` with re-export from common if desired

---

## Publish consolidation (key design decision)

### New: `publish/services/resolveVideoSource.ts`

Single function used by both immediate upload and scheduled publish:

```typescript
export type PublishVideoSource =
  | { kind: 'mcq'; videoId: string }
  | { kind: 'story'; storyVideoJobId: string }
  | { kind: 'trailer'; trailerBreakdownJobId: string }
  | { kind: 'latest-mcq'; userId: string };

export type ResolvedPublishFile = {
  localPath: string;
  title: string;
  cleanup?: () => Promise<void>;  // temp dir from S3 download
};

export async function resolveVideoForPublish(
  userId: string,
  source: PublishVideoSource,
  env: EnvConfig
): Promise<ResolvedPublishFile>;
```

**Behavior:**
- Validates job ownership + `status === 'completed'`
- Downloads from S3 to temp if needed (story/trailer/mcq)
- Returns title from job metadata (breakdown title, story topic, quiz topic)
- Throws clear errors if output missing

### Upload flow after refactor

```
POST /api/uploads/youtube
  → publish/controllers/uploadController.ts
  → publish/services/uploadService.ts
  → resolveVideoForPublish()
  → platforms/youtubeService.uploadToYouTube()
```

### Schedule flow (unchanged routes)

```
POST /api/publish/schedule  { videoId, platform, ... }
  → publishService.schedulePublishJob()
POST /api/publish/run-due
  → publishService.runDuePublishJobs()
  → Video.findOne (MCQ videoId today)
  → platforms upload
```

**Phase 2 enhancement (document, not v1):** extend `schedulePublishJob` to accept `storyVideoJobId` / `trailerBreakdownJobId` — editors can schedule non-MCQ videos. v1 keeps schedule MCQ-only but shared resolver ready.

---

## Auth module detail

### Public API (`auth/index.ts`)

```typescript
export { authMiddleware, requireAdmin } from './middleware/auth.js';
export type { AuthUser } from './middleware/auth.js';
export { createAuthRoutes } from './controllers/authController.js';
export { createAdminRoutes } from './controllers/adminController.js';
```

### `app.ts` wiring (unchanged URLs)

```typescript
import { authMiddleware, createAuthRoutes, createAdminRoutes } from './auth/index.js';
import { createPublishRoutes, handleYouTubeOAuthCallback, createUploadRoutes } from './publish/index.js';

app.use('/api/auth', authLimiter, createAuthRoutes());
app.get('/api/publish/youtube/callback', handleYouTubeOAuthCallback);  // no JWT
app.use('/api/publish', authMiddleware, createPublishRoutes());
app.use('/api/admin', authMiddleware, createAdminRoutes());
app.use('/api/uploads', authMiddleware, createUploadRoutes(env));  // moved from mcq mount
```

Note: today `app.ts` mounts upload routes twice (`uploadFiles` + mcq `upload`). Consolidate to:
- `/api/uploads/background` etc. → `common` uploadFiles
- `/api/uploads/youtube` → `publish` uploadController

---

## Edge cases

| Edge case | Owner | Behavior |
|-----------|-------|----------|
| YouTube OAuth callback without JWT | `publish/publishController` | State param carries userId + expiry (existing) |
| Instagram callback with JWT | `publish/publishController` | User must be logged in (existing) |
| `requireAdmin` DB role vs JWT role | `auth/middleware` | DB wins (existing) |
| GET `?token=` for video play | `auth/middleware` | Bearer fallback for Range requests (existing) |
| Instagram via `/api/uploads` | `publish/uploadService` | Reject with hint to use Publishing (existing) |
| Instagram schedule without S3 URL | `publish/publishService` | Fail — Graph API needs public URL (existing) |
| Story/trailer upload without S3 | `resolveVideoSource` | Try `intermediate.finalPath`, else clear error |
| Both story + trailer IDs in request | `uploadService` | 400 — mutually exclusive (existing) |
| Publish job for deleted Video | `publishService` | Mark failed, "Video not found" |
| YouTube token expired | `youtubeOAuthService` | Surface error, user re-connects in Publishing |
| Analytics publish counts | `publish/analyticsService` | Moved from common; dashboard unchanged via controller |
| Audit logs publish routes | `common/middleware/audit.ts` | Stays — path strings unchanged |
| Settings stores YouTube refresh token | `common/settingsService` | Publish reads via loadSettings — no move |
| Lambda handlers | `lambda/apiHandler.ts` | Update imports to auth/publish barrels |

---

## What stays in `common/`

| Concern | Why |
|---------|-----|
| `settingsService` | All products + publish read credentials |
| `s3Storage` | All products store output |
| `ttsService` | capabilities + settings preview |
| `db/connection` + shared models | Cross-product data |
| `audit` middleware | Logs entire API surface |
| `errorHandler` | Global Express middleware |
| `config/`, `i18n/`, quiz ffmpeg utils | Infra |

---

## Migration plan (5 phases)

### Phase 1 — `auth/` module (low risk)

1. Create `auth/` folder structure
2. `git mv` authController, adminController, authService, adminService, middleware/auth.ts
3. Create `auth/index.ts` barrel
4. Update `app.ts`, `mcq/controllers/videosController.ts`, any other `authMiddleware` importers
5. Shim re-exports in old `common/` paths (one release) OR update all imports in same PR
6. Verify: login, register, /me, admin users, admin audit
7. Commit: `refactor: extract auth module`

### Phase 2 — `publish/` core (OAuth + schedule)

1. Create `publish/` folders
2. Move publishController, publishService, youtubeOAuth, instagramGraph, platforms/*, publishers/*
3. Move `PublishJob` model to `publish/db/models/` (update imports)
4. Update `app.ts` imports
5. Verify: YouTube connect, callback, schedule, run-due, export-plan
6. Commit: `refactor: extract publish module (oauth and schedule)`

### Phase 3 — Consolidate immediate upload

1. Create `publish/services/resolveVideoSource.ts` (extract from mcq/uploadService)
2. Move `uploadOrchestrator` → `publish/orchestrator/`
3. Move `uploadService` + `uploadController` → `publish/`
4. `mcq/controllers/uploadController.ts` → delete or thin re-export
5. Update `app.ts` to mount upload routes from publish
6. Verify: MCQ upload, story editor publish, trailer editor publish
7. Commit: `refactor: consolidate upload path under publish module`

### Phase 4 — Analytics + layer enforcement

1. Move publish-related functions from `analyticsService` to `publish/services/analyticsService.ts`
2. `common/controllers/analyticsController.ts` imports from publish
3. Extend `check-layer-imports.sh`:
   - `auth/` cannot import verticals or publish
   - `publish/` cannot import verticals or auth
   - `common/` cannot import auth or publish
4. Commit: `chore: enforce auth/publish layer boundaries`

### Phase 5 — Cleanup

1. Remove `common/` shims for moved files
2. Delete empty `common/controllers` entries if migrated
3. Update docs/architecture diagram
4. Commit: `chore: remove auth/publish migration shims`

---

## API stability

| Route | Change |
|-------|--------|
| `POST /api/auth/login` | None |
| `POST /api/auth/register` | None |
| `GET /api/auth/me` | None |
| `GET /api/admin/users` | None |
| `GET /api/admin/audit` | None |
| `GET /api/publish/youtube/connect-url` | None |
| `GET /api/publish/youtube/callback` | None |
| `POST /api/publish/schedule` | None |
| `POST /api/publish/run-due` | None |
| `POST /api/uploads/youtube` | None (body: storyVideoJobId, trailerBreakdownJobId) |

---

## Testing & verification

Per phase manual checklist:

| Phase | Verify |
|-------|--------|
| 1 | Register, login, JWT on protected route, admin page loads, non-admin 403 |
| 2 | YouTube OAuth connect + callback redirect to `/publishing`, schedule job |
| 3 | Upload from MCQ dashboard, story editor, trailer editor |
| 4 | Dashboard analytics publish counts, `npm run check:layers` |
| 5 | Full grep — no stale `common/services/publishService` imports |

---

## Success criteria

1. `auth/` contains all auth + admin code
2. `publish/` contains all OAuth, schedule, upload, platform adapters
3. Zero `common/` imports from `auth/` or `publish/` implementation files (controllers may delegate)
4. `mcq/` does not contain social upload logic (only calls publish)
5. `npm run check:layers` passes with new rules
6. All publish flows work for MCQ, story, and trailer

---

## Relationship to capabilities refactor

```
                    ┌─────────────┐
  mcq/story/trailer │ orchestration│
                    └──────┬──────┘
           ┌───────────────┼───────────────┐
           ▼               ▼               ▼
    capabilities/      publish/         auth/
    (AI/voice/media)   (distribution)  (identity)
           │               │               │
           └───────────────┴───────────────┘
                           ▼
                        common/
                      (infra only)
```

These are orthogonal extractions. Capabilities answered "how do we generate video content?" Auth/publish answers "who is the user?" and "how do we ship video to platforms?"

---

## Open decisions (defaults chosen)

| Decision | Choice |
|----------|--------|
| User model location | Stay in `common/db/models/User.ts` for v1 |
| Audit middleware | Stay in `common/middleware/audit.ts` |
| Schedule for story/trailer jobs | Defer — resolver ready in Phase 3 |
| Frontend `api/auth.ts` | No change (same URLs) |
| Publish async worker | Defer (approach C) |
