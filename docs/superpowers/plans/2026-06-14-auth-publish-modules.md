# Auth & Publish Modules — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract `auth/` and `publish/` modules from flat `common/`, consolidate immediate upload under publish, enforce layer boundaries — no HTTP route changes.

**Architecture:** Bounded modules — `vertical → publish/auth → common`. Publish owns OAuth, schedule, upload, platforms. Auth owns JWT + admin. `resolveVideoSource.ts` unifies MCQ/story/trailer file resolution.

**Tech Stack:** Express, Mongoose, TypeScript (ESM), googleapis, Meta Graph API.

**Spec:** `docs/superpowers/specs/2026-06-14-auth-publish-modules-design.md`

---

## File map

| Path | Responsibility |
|------|----------------|
| `backend/src/auth/index.ts` | Barrel: middleware + route factories |
| `backend/src/auth/middleware/auth.ts` | JWT, requireAdmin, AuthUser |
| `backend/src/auth/controllers/authController.ts` | register, login, me |
| `backend/src/auth/controllers/adminController.ts` | users, audit |
| `backend/src/auth/services/authService.ts` | bcrypt, signToken |
| `backend/src/auth/services/adminService.ts` | list users, audit query |
| `backend/src/publish/index.ts` | Barrel: publish + upload routes |
| `backend/src/publish/controllers/publishController.ts` | OAuth, schedule, export-plan |
| `backend/src/publish/controllers/uploadController.ts` | POST /api/uploads/* (from mcq) |
| `backend/src/publish/services/publishService.ts` | schedule, run-due, OAuth processing |
| `backend/src/publish/services/uploadService.ts` | immediate upload (from mcq) |
| `backend/src/publish/services/resolveVideoSource.ts` | **NEW** — resolve output MP4 path |
| `backend/src/publish/services/youtubeOAuthService.ts` | Google token exchange |
| `backend/src/publish/services/instagramGraphService.ts` | Meta reel publish |
| `backend/src/publish/services/analyticsService.ts` | PublishJob stats (from common) |
| `backend/src/publish/orchestrator/uploadOrchestrator.ts` | multi-platform upload |
| `backend/src/publish/platforms/youtubeService.ts` | YouTube Data API |
| `backend/src/publish/platforms/instagramService.ts` | legacy stub |
| `backend/src/publish/publishers/*` | export adapters |
| `backend/src/publish/db/models/PublishJob.ts` | scheduled jobs model |

---

## Phase 1 — Extract `auth/` module

### Task 1: Move auth files and create barrel

**Files:**
- Move: `common/controllers/authController.ts` → `auth/controllers/authController.ts`
- Move: `common/controllers/adminController.ts` → `auth/controllers/adminController.ts`
- Move: `common/services/authService.ts` → `auth/services/authService.ts`
- Move: `common/services/adminService.ts` → `auth/services/adminService.ts`
- Move: `common/middleware/auth.ts` → `auth/middleware/auth.ts`
- Create: `backend/src/auth/index.ts`
- Modify: `backend/src/app.ts`, `backend/src/mcq/controllers/videosController.ts`

- [ ] **Step 1: Create directory and git mv**

```bash
cd /Users/dsahani/Documents/mcq-shorts-agent
mkdir -p backend/src/auth/{controllers,services,middleware}
git mv backend/src/common/controllers/authController.ts backend/src/auth/controllers/authController.ts
git mv backend/src/common/controllers/adminController.ts backend/src/auth/controllers/adminController.ts
git mv backend/src/common/services/authService.ts backend/src/auth/services/authService.ts
git mv backend/src/common/services/adminService.ts backend/src/auth/services/adminService.ts
git mv backend/src/common/middleware/auth.ts backend/src/auth/middleware/auth.ts
```

- [ ] **Step 2: Fix relative imports inside moved files**

| File | Import fix |
|------|------------|
| `auth/controllers/authController.ts` | `../middleware/auth.js`, `../services/authService.js` |
| `auth/controllers/adminController.ts` | `../middleware/auth.js`, `../services/adminService.js` |
| `auth/services/authService.ts` | `../../common/db/models/User.js`, `../../common/config/envConfig.js` |
| `auth/services/adminService.ts` | `../../common/db/models/AuditEvent.js`, `../../common/db/models/User.js` |
| `auth/middleware/auth.ts` | `../../common/config/envConfig.js`, `../../common/db/models/User.js` |

- [ ] **Step 3: Create `auth/index.ts`**

```typescript
export { authMiddleware, requireAdmin } from './middleware/auth.js';
export type { AuthUser } from './middleware/auth.js';
export { createAuthRoutes } from './controllers/authController.js';
export { createAdminRoutes } from './controllers/adminController.js';
```

- [ ] **Step 4: Update `app.ts`**

Replace:
```typescript
import { createAuthRoutes } from './common/controllers/authController.js';
import { createAdminRoutes } from './common/controllers/adminController.js';
import { authMiddleware } from './common/middleware/auth.js';
```

With:
```typescript
import { authMiddleware, createAuthRoutes, createAdminRoutes } from './auth/index.js';
```

- [ ] **Step 5: Update `mcq/controllers/videosController.ts`**

```typescript
import { authMiddleware } from '../../auth/index.js';
```

- [ ] **Step 6: Grep for stale imports**

```bash
rg "common/middleware/auth|common/controllers/authController|common/controllers/adminController|common/services/authService|common/services/adminService" backend/src
```

Fix any remaining hits (lambda handlers, etc.).

- [ ] **Step 7: Build**

```bash
cd backend && npm run build
```

- [ ] **Step 8: Commit**

```bash
git add backend/src/auth backend/src/app.ts backend/src/mcq/controllers/videosController.ts
git commit -m "refactor: extract auth module"
```

---

## Phase 2 — Extract `publish/` core (OAuth + schedule)

### Task 2: Move publish services and controllers

**Files:**
- Move publish stack from `common/` to `publish/`
- Move `PublishJob` model

- [ ] **Step 1: Create publish tree and git mv**

```bash
mkdir -p backend/src/publish/{controllers,services,platforms,publishers,orchestrator,db/models}
git mv backend/src/common/controllers/publishController.ts backend/src/publish/controllers/publishController.ts
git mv backend/src/common/services/publishService.ts backend/src/publish/services/publishService.ts
git mv backend/src/common/services/youtubeOAuthService.ts backend/src/publish/services/youtubeOAuthService.ts
git mv backend/src/common/services/instagramGraphService.ts backend/src/publish/services/instagramGraphService.ts
git mv backend/src/common/services/platforms/youtubeService.ts backend/src/publish/platforms/youtubeService.ts
git mv backend/src/common/services/platforms/instagramService.ts backend/src/publish/platforms/instagramService.ts
git mv backend/src/common/services/publishers/publisherAdapter.ts backend/src/publish/publishers/publisherAdapter.ts
git mv backend/src/common/services/publishers/exportAdapters.ts backend/src/publish/publishers/exportAdapters.ts
git mv backend/src/common/db/models/PublishJob.ts backend/src/publish/db/models/PublishJob.ts
```

- [ ] **Step 2: Fix imports in moved publish files**

Pattern: `../config/` → `../../common/config/`, `../db/models/PublishJob` → `../db/models/PublishJob` (local), `./settingsService` → `../../common/services/settingsService.js`, `./platforms/` → `../platforms/`, `./publishers/` → `../publishers/`, `./s3Storage` → `../../common/services/s3Storage.js`

`publishService.ts` key imports:
```typescript
import { loadEnvConfig } from '../../common/config/envConfig.js';
import { loadSettings, saveSettings } from '../../common/services/settingsService.js';
import { getYouTubeAuthUrl, exchangeYouTubeCode } from './youtubeOAuthService.js';
import { connectInstagramGraph, publishReel } from './instagramGraphService.js';
import { PublishJob } from '../db/models/PublishJob.js';
import { Video } from '../../common/db/models/Video.js';
import { getPresignedGetUrl, downloadObjectToFile } from '../../common/services/s3Storage.js';
import { uploadToYouTube } from '../platforms/youtubeService.js';
import { ExportOnlyAdapter } from '../publishers/exportAdapters.js';
```

`publishController.ts`:
```typescript
import { ... } from '../services/publishService.js';
```

`exportAdapters.ts`:
```typescript
import type { ... } from './publisherAdapter.js';
```

- [ ] **Step 3: Update PublishJob importers**

```bash
rg "common/db/models/PublishJob" backend/src
```

Change to `../../publish/db/models/PublishJob.js` or `../publish/db/models/PublishJob.js` depending on depth.

Files likely affected:
- `common/services/analyticsService.ts` (Phase 4 moves this)
- Any other grep hits

For Phase 2, update `analyticsService.ts` import path only:
```typescript
import { PublishJob } from '../../publish/db/models/PublishJob.js';
```

- [ ] **Step 4: Create `publish/index.ts` (partial — upload routes added in Task 3)**

```typescript
export { createPublishRoutes, handleYouTubeOAuthCallback } from './controllers/publishController.js';
```

- [ ] **Step 5: Update `app.ts`**

```typescript
import { createPublishRoutes, handleYouTubeOAuthCallback } from './publish/index.js';
```

- [ ] **Step 6: Remove empty `common/services/platforms/` and `common/services/publishers/` dirs if empty**

- [ ] **Step 7: Build + commit**

```bash
cd backend && npm run build
git commit -m "refactor: extract publish module (oauth and schedule)"
```

---

## Phase 3 — Consolidate immediate upload under publish

### Task 3: Create resolveVideoSource and move upload stack

**Files:**
- Create: `publish/services/resolveVideoSource.ts`
- Move: `mcq/services/uploadService.ts` → `publish/services/uploadService.ts`
- Move: `mcq/controllers/uploadController.ts` → `publish/controllers/uploadController.ts`
- Move: `common/services/uploadOrchestrator.ts` → `publish/orchestrator/uploadOrchestrator.ts`
- Modify: `publish/services/uploadService.ts`, `app.ts`, `publish/index.ts`

- [ ] **Step 1: Create `resolveVideoSource.ts`**

Extract resolution logic from current `mcq/services/uploadService.ts` (lines ~95–171):

```typescript
import fs from 'fs';
import path from 'path';
import mongoose from 'mongoose';
import type { EnvConfig } from '../../common/config/envConfig.js';
import { StoryVideoJob } from '../../common/db/models/StoryVideoJob.js';
import { TrailerBreakdownJob } from '../../common/db/models/TrailerBreakdownJob.js';
import { Video } from '../../common/db/models/Video.js';
import { downloadObjectToFile } from '../../common/services/s3Storage.js';

export type PublishVideoSource =
  | { kind: 'story'; storyVideoJobId: string }
  | { kind: 'trailer'; trailerBreakdownJobId: string }
  | { kind: 'latest-mcq' };

export type ResolvedPublishOutput = {
  outputDir: string;
  title: string;
};

export async function resolvePublishOutput(
  userId: string,
  source: {
    storyVideoJobId?: string;
    trailerBreakdownJobId?: string;
  },
  envConfig: EnvConfig
): Promise<ResolvedPublishOutput> {
  if (source.storyVideoJobId && source.trailerBreakdownJobId) {
    throw new Error('Provide either storyVideoJobId or trailerBreakdownJobId, not both');
  }

  if (source.trailerBreakdownJobId) {
    if (!mongoose.Types.ObjectId.isValid(source.trailerBreakdownJobId)) {
      throw new Error('Invalid trailer breakdown job id');
    }
    const tj = await TrailerBreakdownJob.findOne({
      _id: source.trailerBreakdownJobId,
      userId: new mongoose.Types.ObjectId(userId),
      status: 'completed',
    }).lean();
    if (!tj) throw new Error('Trailer breakdown job not found or not completed');

    const title = (tj.breakdownTitle || tj.movieTitle || 'Trailer breakdown').trim() || 'Trailer breakdown';
    const tmpDir = path.join(envConfig.TEMP_DIR || '/tmp', 'uploads', userId, 'trailer-publish');
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
    const outPath = path.join(tmpDir, `trailer-${String(tj._id)}.mp4`);

    if (tj.s3Bucket && tj.outputVideoKey) {
      await downloadObjectToFile(tj.s3Bucket, tj.outputVideoKey, outPath);
    } else {
      const fp = (tj.intermediate as { finalPath?: string } | undefined)?.finalPath;
      if (!fp || !fs.existsSync(fp)) {
        throw new Error(
          'Trailer breakdown output is not on disk (use S3 output bucket) or path missing — cannot upload to YouTube'
        );
      }
      fs.copyFileSync(fp, outPath);
    }
    return { outputDir: tmpDir, title };
  }

  if (source.storyVideoJobId) {
    if (!mongoose.Types.ObjectId.isValid(source.storyVideoJobId)) {
      throw new Error('Invalid story video job id');
    }
    const sj = await StoryVideoJob.findOne({
      _id: source.storyVideoJobId,
      userId: new mongoose.Types.ObjectId(userId),
      status: 'completed',
    }).lean();
    if (!sj) throw new Error('Story video job not found or not completed');

    const title = 'Story video';
    const tmpDir = path.join(envConfig.TEMP_DIR || '/tmp', 'uploads', userId, 'story-publish');
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
    const outPath = path.join(tmpDir, `story-${String(sj._id)}.mp4`);

    if (sj.s3Bucket && sj.outputVideoKey) {
      await downloadObjectToFile(sj.s3Bucket, sj.outputVideoKey, outPath);
    } else {
      const fp = (sj.intermediate as { finalPath?: string } | undefined)?.finalPath;
      if (!fp || !fs.existsSync(fp)) {
        throw new Error(
          'Story video output is not on disk (use S3 output bucket) or path missing — cannot upload to YouTube'
        );
      }
      fs.copyFileSync(fp, outPath);
    }
    return { outputDir: tmpDir, title };
  }

  // Latest MCQ video
  const latest = await Video.findOne({ userId, status: 'completed' }).sort({ createdAt: -1 }).lean();
  if (latest?.s3Bucket && latest?.s3Key) {
    const tmpDir = path.join(envConfig.TEMP_DIR || '/tmp', 'uploads', userId);
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
    const outPath = path.join(tmpDir, latest.filename || 'latest.mp4');
    await downloadObjectToFile(latest.s3Bucket, latest.s3Key, outPath);
    return { outputDir: tmpDir, title: envConfig.TOPIC || 'Quiz' };
  }

  return { outputDir: path.join(envConfig.OUTPUT_DIR, userId), title: envConfig.TOPIC || 'Quiz' };
}
```

- [ ] **Step 2: Git mv upload files**

```bash
git mv backend/src/mcq/services/uploadService.ts backend/src/publish/services/uploadService.ts
git mv backend/src/mcq/controllers/uploadController.ts backend/src/publish/controllers/uploadController.ts
git mv backend/src/common/services/uploadOrchestrator.ts backend/src/publish/orchestrator/uploadOrchestrator.ts
```

- [ ] **Step 3: Refactor `uploadService.ts`**

Replace inline resolution block with:
```typescript
import { resolvePublishOutput } from './resolveVideoSource.js';
import { uploadToAllPlatforms, uploadToInstagramOnly, uploadToYouTubeOnly } from '../orchestrator/uploadOrchestrator.js';
import { loadSettings } from '../../common/services/settingsService.js';
import type { EnvConfig } from '../../common/config/envConfig.js';
```

In `uploadToPlatforms`:
```typescript
const { outputDir: resolvedOutputDir, title: uploadTitle } = await resolvePublishOutput(
  userId!,
  { storyVideoJobId: request.storyVideoJobId, trailerBreakdownJobId: request.trailerBreakdownJobId },
  envConfig
);
```

Remove duplicate story/trailer/latest resolution code.

- [ ] **Step 4: Fix `uploadOrchestrator.ts` imports**

```typescript
import { uploadLatestVideoToYouTube, YouTubeUploadResult } from '../platforms/youtubeService.js';
import { InstagramUploadResult } from '../platforms/instagramService.js';
```

- [ ] **Step 5: Fix `uploadController.ts` imports**

```typescript
import type { EnvConfig } from '../../common/config/envConfig.js';
import { uploadToPlatforms, ... } from '../services/uploadService.js';
```

- [ ] **Step 6: Update `publish/index.ts`**

```typescript
export { createPublishRoutes, handleYouTubeOAuthCallback } from './controllers/publishController.js';
export { createUploadRoutes } from './controllers/uploadController.js';
```

- [ ] **Step 7: Update `app.ts`**

Replace:
```typescript
import { createUploadRoutes } from './mcq/controllers/uploadController.js';
```

With:
```typescript
import { createPublishRoutes, handleYouTubeOAuthCallback, createUploadRoutes } from './publish/index.js';
```

Keep dual mount on `/api/uploads`:
```typescript
app.use('/api/uploads', authMiddleware, createUploadFilesRoutes(env));  // common — backgrounds
app.use('/api/uploads', authMiddleware, createUploadRoutes(env));      // publish — youtube/instagram
```

- [ ] **Step 8: Grep for mcq upload imports**

```bash
rg "mcq/services/uploadService|mcq/controllers/uploadController" backend/src
```

Fix or delete stale mcq files.

- [ ] **Step 9: Build + manual verify paths**

```bash
cd backend && npm run build
```

Manual: story editor POST `/api/uploads/youtube` with `storyVideoJobId`; trailer with `trailerBreakdownJobId`.

- [ ] **Step 10: Commit**

```bash
git commit -m "refactor: consolidate upload path under publish module"
```

---

## Phase 4 — Analytics + layer enforcement

### Task 4: Move publish analytics and extend layer checks

**Files:**
- Move: `common/services/analyticsService.ts` → `publish/services/analyticsService.ts`
- Modify: `common/controllers/analyticsController.ts`
- Modify: `backend/scripts/check-layer-imports.sh`
- Modify: `backend/eslint.config.js` (if exists)

- [ ] **Step 1: Git mv analyticsService**

```bash
git mv backend/src/common/services/analyticsService.ts backend/src/publish/services/analyticsService.ts
```

Fix imports inside:
```typescript
import { PublishJob } from '../db/models/PublishJob.js';
import { loadSettings } from '../../common/services/settingsService.js';
```

- [ ] **Step 2: Update `analyticsController.ts`**

```typescript
import { getAnalyticsSummary, refreshYouTubeAnalytics } from '../../publish/services/analyticsService.js';
```

- [ ] **Step 3: Export from `publish/index.ts`**

```typescript
export { getAnalyticsSummary, refreshYouTubeAnalytics } from './services/analyticsService.js';
```

- [ ] **Step 4: Extend `check-layer-imports.sh`**

Add after existing checks:

```bash
check "auth→verticals|publish" "$SRC/auth" "from ['\"].*/(mcq|story|trailer|publish)/"
check "publish→verticals|auth" "$SRC/publish" "from ['\"].*/(mcq|story|trailer|auth)/"
check "common→auth|publish" "$SRC/common" "from ['\"].*/(auth|publish)/"
```

- [ ] **Step 5: Build + check layers**

```bash
cd backend && npm run build && npm run check:layers
```

- [ ] **Step 6: Commit**

```bash
git commit -m "chore: move publish analytics and enforce auth/publish layer boundaries"
```

---

## Phase 5 — Cleanup

### Task 5: Remove dead paths and verify

- [ ] **Step 1: Grep forbidden patterns**

```bash
rg "common/services/publishService|common/controllers/publishController|common/middleware/auth|mcq/services/uploadService|mcq/controllers/uploadController|common/db/models/PublishJob" backend/src
```

All should be zero (except docs).

- [ ] **Step 2: Delete empty directories**

```bash
rmdir backend/src/common/services/platforms 2>/dev/null || true
rmdir backend/src/common/services/publishers 2>/dev/null || true
```

- [ ] **Step 3: Update lambda handler if needed**

Read `backend/src/lambda/apiHandler.ts` — ensure it imports `createApp` only (no direct common auth paths).

- [ ] **Step 4: Final verification**

```bash
cd backend && npm run build && npm run check:layers
cd frontend && npx tsc -b
```

- [ ] **Step 5: Commit**

```bash
git commit -m "chore: remove auth/publish migration leftovers"
```

---

## Final verification checklist

- [ ] `POST /api/auth/login` — returns token
- [ ] `GET /api/auth/me` — returns user
- [ ] `GET /api/admin/users` — admin only
- [ ] `GET /api/publish/youtube/connect-url` — returns OAuth URL
- [ ] `POST /api/uploads/youtube` with `storyVideoJobId` — story publish
- [ ] `POST /api/uploads/youtube` with `trailerBreakdownJobId` — trailer publish
- [ ] `POST /api/publish/schedule` — MCQ schedule still works
- [ ] Dashboard analytics publish counts load
- [ ] `npm run check:layers` passes

---

## Spec coverage self-review

| Spec requirement | Task |
|------------------|------|
| `auth/` module | Task 1 |
| `publish/` OAuth + schedule | Task 2 |
| `resolveVideoSource` + upload consolidation | Task 3 |
| Analytics in publish | Task 4 |
| Layer enforcement | Task 4 |
| No route changes | All tasks |
| User model stays in common/db | Unchanged |
| Audit stays in common | Unchanged |

---

## Plan self-review

- `resolvePublishOutput` matches existing mcq/uploadService behavior (no logic change)
- `app.ts` dual `/api/uploads` mount preserved (uploadFiles + publish upload)
- PublishJob import paths updated in Phase 2 before analytics move
- No placeholder TBDs
