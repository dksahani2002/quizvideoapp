# Capabilities Layer Refactor — Design Spec

**Date:** 2026-06-13  
**Status:** Approved  
**Scope:** Full-stack — backend `capabilities/` extraction + frontend `shared/` components  
**Approach:** B — Layered capabilities platform (recommended in brainstorming)

---

## Summary

Three product verticals — **MCQ**, **Story Video**, and **Trailer Breakdown** — all depend on the same AI, voice, and media primitives (OpenAI client, Whisper, TTS, scene detection, ffmpeg cut/concat/mux). Today those primitives are scattered and cross-imported (`trailer → story`, `story → mcq`, `common → mcq`), which makes the codebase hard to read and risky to extend.

This refactor introduces a **`capabilities/`** layer between vertical orchestration and **`common/`** infrastructure, plus a **`frontend/src/shared/`** layer for duplicated UI. Verticals keep orchestration (pipelines, queues, domain prompts, product-specific render assembly). Everything reusable moves up.

---

## Goals

1. **One-way dependencies:** `vertical → capabilities → common` (never reversed)
2. **Readable verticals:** each `mcq/`, `story/`, `trailer/` folder contains only product logic
3. **Shared voice/AI/media behavior** implemented once, with explicit edge-case handling
4. **Shared frontend** for voice settings, job progress UI, and media preview
5. **Incremental migration** — shippable PRs, no big-bang rewrite

## Non-Goals

- Extracting internal npm workspace packages (`@mcq/ai`, etc.)
- Merging MCQ quiz-specific ffmpeg rendering (`common/utils/ffmpeg.ts` ~1.5k lines) into generic media ops
- Changing HTTP API routes or response shapes (backward compatible)
- Rewriting pipeline business logic or domain GPT prompts
- Adding a formal DI framework

---

## Current Problems

### Backend cross-imports (must eliminate)

| Consumer | Imports from | What |
|----------|--------------|------|
| `trailer/pipeline/run.ts` | `story/ai/openaiStory` | OpenAI client, Whisper, assignWhisperToSceneWindows |
| `trailer/pipeline/run.ts` | `story/render/ffmpeg`, `story/scene/detectFacade` | audio extract, scene windows, scene cuts |
| `trailer/render/assembleBreakdown.ts` | `story/render/ffmpeg`, `mcq/videoJob/ttsResolution` | video ops, TTS resolution |
| `story/narration/ttsNarration.ts` | `mcq/videoJob/ttsResolution` | TTS resolution |
| `common/services/settingsService.ts` | `mcq/utils/quizUiStrings` | brand defaults (wrong direction) |
| `common/ttsPreviewService.ts` | `mcq/utils/quizLanguages` | language normalization (wrong direction) |

### Duplicated logic

- `buildResolvedTts` + fake `GenerateRequestPayload` — in `story/narration/ttsNarration.ts` and `trailer/render/assembleBreakdown.ts`
- Job helpers (`setProgress`, `isCancelled`, `scheduleRetryOrFail`, `pushEvent`) — copy-pasted in `story/pipeline/run.ts` and `trailer/pipeline/run.ts`
- `friendlyStatusLabel` / `statusStyles` — duplicated across story and trailer frontend libraries

### Already correct (keep in place)

- `common/services/ttsService.ts` — provider implementations + disk cache
- `common/services/settingsService.ts` — credentials (after i18n fix)
- Job Mongoose models in `common/db/models/`

---

## Architecture

### Dependency rule

```
mcq/     ──┐
story/   ──┼──► capabilities/ ──► common/
trailer/ ──┘

FORBIDDEN:
  common/      → mcq | story | trailer
  capabilities → mcq | story | trailer
  story        → mcq
  trailer      → story | mcq
```

### Layer responsibilities

| Layer | Owns | Does NOT own |
|-------|------|--------------|
| **Vertical** (`mcq/`, `story/`, `trailer/`) | HTTP controllers, services, `pipeline/run.ts`, queue, domain GPT prompts, product render assembly | Generic Whisper, TTS factory, scene detection internals |
| **Capabilities** (`capabilities/`) | Reusable AI, voice, media, job primitives with stable exports | HTTP, DB models, product business rules |
| **Common** (`common/`) | DB, auth, settings, S3, env, MCQ-quiz ffmpeg renderer | Anything product-specific |

### Backend target layout

```
backend/src/capabilities/
├── ai/
│   ├── client.ts              # createOpenAIClient
│   ├── whisper.ts             # transcribeAudioVerbose, parseStoredVideoWhisper, chunk merge
│   ├── embeddings.ts          # embedTexts, cosineSimilarity
│   └── jsonExtract.ts         # extractJsonArray, safe parse helpers (from mcqAgent)
│
├── voice/
│   ├── types.ts               # TtsProvider, VoiceOverrides, ResolvedTts
│   ├── ttsResolution.ts       # resolveTtsFromRequest, applyServerTtsFallback
│   ├── ttsFactory.ts          # createTtsFromSettings(settings, overrides?) → TTSService
│   ├── scriptChunker.ts       # chunkScriptForTts (MAX 3800 chars, paragraph-aware)
│   └── synthesize.ts          # synthesizeScriptToNarration (script → TTS → Whisper → segments)
│
├── media/
│   ├── probe.ts               # getMediaDurationSec, getVideoStreamDimensions
│   ├── audio.ts               # extractAudioWav16kMono, concatAudioFilesMp3
│   ├── video.ts               # cutAndPadSilentSegment, concatVideoFilesConcatDemuxer, muxVideoWithAudio
│   ├── sceneWindows.ts        # buildSceneWindows, assignWhisperToSceneWindows
│   └── scene/
│       ├── detectFacade.ts    # resolveSceneCuts (ffmpeg | pyscenedetect | hybrid)
│       └── pyDetect.ts
│
└── jobs/
    ├── types.ts               # JobProgressFields, JobEvent
    ├── progress.ts            # createJobProgressHelpers(model, options)
    └── retry.ts               # createRetryScheduler(model, envKey, maxAttemptsDefault)

backend/src/common/
├── i18n/
│   ├── quizUiStrings.ts       # moved from mcq/utils (fixes reverse dep)
│   └── quizLanguages.ts       # moved from mcq/utils
├── utils/ffmpeg.ts            # UNCHANGED scope: MCQ quiz slide rendering only
└── ... (existing infra)
```

### Public API surface (capabilities index)

Each subfolder exports through a barrel `index.ts`. Verticals import only from:

```ts
import { createOpenAIClient, transcribeAudioVerbose } from '../capabilities/ai/index.js';
import { createTtsFromSettings, synthesizeScriptToNarration } from '../capabilities/voice/index.js';
import { resolveSceneCuts, cutAndPadSilentSegment } from '../capabilities/media/index.js';
import { createJobProgressHelpers } from '../capabilities/jobs/index.js';
```

Legacy re-export shims (temporary, one release cycle):

```ts
// story/ai/openaiStory.ts — thin re-export, deprecated
export { createOpenAIClient, transcribeAudioVerbose, ... } from '../../capabilities/ai/index.js';
```

Remove shims after all internal imports updated.

### What stays in each vertical

| Vertical | Keeps locally |
|----------|---------------|
| **mcq/** | `agents/mcqAgent`, `agents/promptAgent`, `topicLocalization`, quiz pipeline, `videoJob/*`, quiz-specific captions/theme |
| **story/** | story script GPT prompts, `narrationSceneMatch`, timeline clip logic, `rerenderClips`, story-specific subtitle burn-in |
| **trailer/** | `trailerAnalysis` GPT prompts, `youtubeDownload`, `assembleBreakdown` (overlays, segment window clamping) |

---

## Capabilities — detailed behavior

### `capabilities/ai/`

**`client.ts`**
- `createOpenAIClient(apiKey, baseUrl)` — trim trailing slashes (supports custom/proxy endpoints)

**`whisper.ts`**
- `transcribeAudioVerbose(client, audioPath)` — verbose_json with timed segments
- Files > ~10 min: ffmpeg chunk at 600s, transcribe each, offset-merge, `mergeAdjacentSegments`
- `parseStoredVideoWhisper(raw)` — resume cache: bare array or `{ segments, language }`
- Returns `{ segments, language? }`

**`embeddings.ts`**
- `embedTexts(client, texts, model?)` — batch 64, truncate 8k chars
- `cosineSimilarity(a, b)`

**`jsonExtract.ts`**
- `extractJsonArray(text)` — strip markdown fences, find first `[...]` (from mcqAgent)
- Used by MCQ agent and any future structured GPT output parsers

### `capabilities/voice/`

**`types.ts`**
```ts
export type TtsProvider = 'system' | 'openai' | 'elevenlabs';
export type TtsOverride = 'inherit' | TtsProvider;

export type VoiceOverrides = {
  ttsProvider?: TtsOverride;
  ttsVoice?: string;
  ttsModel?: string;
  systemVoice?: string;
  elevenlabsModelId?: string;
};

export type ResolvedTts = {
  provider: TtsProvider;
  voice: string | undefined;
  ttsModel: string;
  elevenlabsModelId: string;
};
```

**`ttsResolution.ts`** — moved from `mcq/videoJob/ttsResolution.ts`
- `resolveTtsFromSettings(settings, overrides?)` — replaces fake `GenerateRequestPayload` hack
- `applyServerTtsFallback(resolved, settings)` — non-darwin `system` → openai or elevenlabs or throw

**`ttsFactory.ts`**
- `createTtsFromSettings(settings, overrides?, cacheDir)` → `TTSService`
- Internally calls `resolveOpenAiCredentials`, resolution, fallback, `createTTSService`

**`scriptChunker.ts`**
- `chunkScriptForTts(script, maxChars = 3800)` — paragraph-aware splitting

**`synthesize.ts`**
- `synthesizeScriptToNarration({ script, settings, workDir, openai, language, overrides })`
- Chunks → TTS parts → concat MP3 → extract WAV 16k → Whisper → `NarrationSegment[]`
- Throws on empty script or zero whisper segments

### `capabilities/media/`

Split from `story/render/ffmpeg.ts` (generic ops only):

| Module | Functions |
|--------|-----------|
| `probe.ts` | `getMediaDurationSec`, `getVideoStreamDimensions` |
| `audio.ts` | `extractAudioWav16kMono`, `concatAudioFilesMp3` |
| `video.ts` | `cutAndPadSilentSegment`, `concatVideoFilesConcatDemuxer`, `muxVideoWithAudio`, `detectSceneCutTimes` |
| `sceneWindows.ts` | `buildSceneWindows`, `assignWhisperToSceneWindows` |
| `scene/detectFacade.ts` | `resolveSceneCuts(videoPath, durationSec, mode, threshold)` |

**`story/render/ffmpeg.ts`** after migration: imports from `capabilities/media` and re-exports story-only helpers (`clipOutputDurationSec` integration, story timeline clip rendering).

### `capabilities/jobs/`

Generic helpers parameterized by Mongoose model shape:

```ts
export function createJobProgressHelpers<T extends JobProgressFields>(model: Model<T>) {
  return {
    setProgress(job, pct, stage, message),
    pushEvent(job, stage, message),
    isCancelled(jobId),
    markCancelled(job),
    failJobPermanent(job, error),
  };
}

export function createRetryScheduler<T extends RetryableJobFields>(
  model: Model<T>,
  options: { maxAttemptsEnvKey: string; defaultMax: number }
) {
  return { scheduleRetryOrFail(jobId, error) };
}
```

Used by `story/pipeline/run.ts` and `trailer/pipeline/run.ts`. MCQ `videoJob` has a different progress model — out of scope unless a later pass finds overlap.

---

## Edge cases (explicit ownership)

| Edge case | Handler | Behavior |
|-----------|---------|----------|
| Whisper audio > 10 min | `ai/whisper.ts` | Chunk, transcribe, offset-merge |
| TTS input > 4096 chars | `voice/scriptChunker.ts` | Paragraph-aware chunk; concat MP3s |
| `system` TTS on Linux/Docker | `voice/ttsResolution.ts` | Fallback to OpenAI → ElevenLabs → clear error |
| Missing OpenAI API key | Vertical pipeline start | Fail before download/render with settings message |
| Corrupt TTS cache file | `common/ttsService.ts` | Delete + regenerate (unchanged) |
| Scene detect returns 0 cuts | `media/scene/detectFacade.ts` | Return `[]`; caller `buildSceneWindows` ensures ≥1 window |
| Trailer segment times invalid | `trailer/render/assembleBreakdown.ts` | `resolveSegmentWindow` clamp + fallback clip |
| Job cancelled mid-stage | `jobs/progress.ts` | `isCancelled` checked between pipeline stages |
| Transient API failure | `jobs/retry.ts` | Re-queue if `attempts < maxAttempts` |
| `inherit` TTS provider | `voice/ttsFactory.ts` | Use global `settings.tts.provider` |
| Empty narration script | `voice/synthesize.ts` | Throw `Empty script for TTS` |
| Whisper returns no segments after TTS | `voice/synthesize.ts` | Throw `TTS produced no transcribable segments` |
| yt-dlp / YouTube download fail | `trailer/io/youtubeDownload.ts` | Stays in trailer; retry via job scheduler |
| Resume from cached artifacts | Vertical pipeline | Orchestration stays in vertical `run.ts` |
| OpenAI voice name "Alex" with OpenAI provider | `ttsService.ts` | `pickOpenAiTtsVoice` maps to alloy/nova (unchanged) |
| ElevenLabs voices API down | Frontend `useElevenLabsVoices` | Empty list; user can paste voice ID |
| MCQ quiz rendering | `common/utils/ffmpeg.ts` | Not moved — product-specific |

---

## Frontend architecture

### Target layout

```
frontend/src/shared/
├── voice/
│   ├── types.ts                   # VoiceOptions (mirrors backend VoiceOverrides + language)
│   ├── VoiceSettingsPanel.tsx     # unified provider picker + voice fields + preview button
│   └── useElevenLabsVoices.ts
├── jobs/
│   ├── types.ts                   # JobStatusShape (status, stage, progressPercent, progressMessage, error)
│   ├── friendlyLabels.ts          # friendlyStatusLabel, friendlyStageLabel (configurable stage map)
│   ├── statusStyles.ts            # statusBadgeClass(status)
│   ├── JobProgressCard.tsx        # library list card: badge, progress bar, message
│   └── useJobStatusPoll.ts        # generic react-query polling hook
├── media/
│   ├── useAuthenticatedMediaUrl.ts
│   └── VideoPreview.tsx
└── ui/
    ├── FormSection.tsx            # from storyVideoUi
    └── PhaseStepper.tsx           # generic step config prop
```

### Component contracts

**`VoiceSettingsPanel`**
```tsx
type Props = {
  value: VoiceOptions;
  onChange: (next: VoiceOptions) => void;
  disabled?: boolean;
  /** Show "inherit from settings" option (story + trailer) */
  allowInherit?: boolean;
  previewText?: string;
  language?: string;
};
```
Replaces: `TrailerVoiceSettings`, inline story voice `<select>` blocks in `StoryVideoEditor`.

**`useJobStatusPoll`**
```tsx
function useJobStatusPoll<T extends JobStatusShape>({
  jobId: string | undefined,
  fetchStatus: (id: string) => Promise<T>,
  enabled?: boolean;
  refetchInterval?: number | ((data: T) => number | false);
});
```
Used by story and trailer editors (replace duplicated `useQuery` blocks).

**`JobProgressCard`**
```tsx
type Props = {
  job: JobStatusShape & { jobId: string; title?: string };
  stageLabels?: Record<string, string>;
  playUrl?: string;
  editHref: string;
  onRetry?: () => void;
};
```
Used by `StoryVideoLibrary` and `TrailerBreakdownLibrary`.

### Feature folders after refactor

Each feature keeps: pages, API module (`api.ts`), domain-specific editor components (timeline, script editor). Shared UI imported from `shared/`.

---

## Migration plan (incremental PRs)

Each PR must leave the app buildable and runnable. Order minimizes broken imports.

### Phase 1 — Foundation (no behavior change)

**PR 1a: `common/i18n` + reverse-dep fix**
- Move `quizUiStrings.ts`, `quizLanguages.ts` → `common/i18n/`
- Update `settingsService`, `ttsPreviewService`, all mcq imports
- Verify: settings load, TTS preview works

**PR 1b: Create `capabilities/ai`**
- Move functions from `story/ai/openaiStory.ts` → `capabilities/ai/*`
- Leave `story/ai/openaiStory.ts` as re-export shim
- Update `trailer/pipeline/run.ts`, `story/narration/*` to import from capabilities
- Verify: story job transcribe, trailer job transcribe

### Phase 2 — Voice layer

**PR 2a: `capabilities/voice`**
- Move `ttsResolution.ts` from mcq; add `ttsFactory`, `types`, `scriptChunker`
- Move `synthesizeScriptToNarration` from `story/narration/ttsNarration.ts` → `capabilities/voice/synthesize.ts`
- Update story pipeline, trailer assembleBreakdown, mcq videoJob
- Delete `buildResolvedTts` duplicates in story + trailer
- Verify: story TTS narration, trailer per-segment TTS, MCQ video render

### Phase 3 — Media layer

**PR 3a: `capabilities/media`**
- Extract generic functions from `story/render/ffmpeg.ts`
- Move `story/scene/*` → `capabilities/media/scene/`
- Update story pipeline, trailer pipeline, trailer render
- `story/render/ffmpeg.ts` becomes thin wrapper for story-only ops
- Verify: scene detection, clip cut, trailer render, story render

### Phase 4 — Job helpers

**PR 4a: `capabilities/jobs`**
- Extract shared progress/retry from story + trailer `pipeline/run.ts`
- Each vertical: `const progress = createJobProgressHelpers(StoryVideoJob)`
- Verify: cancel, retry, progress polling unchanged

### Phase 5 — Frontend shared

**PR 5a: `shared/voice`**
- Extract `VoiceSettingsPanel` from `TrailerVoiceSettings` + story editor voice section
- Wire story + trailer editors

**PR 5b: `shared/jobs` + `shared/media`**
- Extract `JobProgressCard`, `friendlyLabels`, `statusStyles`, `useJobStatusPoll`
- Refactor both library pages

**PR 5c: `shared/ui`**
- Move `FormSection`, generalize `PhaseStepper`

### Phase 6 — Cleanup

**PR 6: Remove shims**
- Delete `story/ai/openaiStory.ts` re-exports (update all imports)
- Delete empty `mcq/videoJob/ttsResolution.ts` if fully moved
- Delete `TrailerVoiceSettings.tsx`, redundant `*Ui.tsx` helpers
- Add ESLint `no-restricted-imports` rule:
  - `trailer/**` cannot import `story/**` or `mcq/**`
  - `story/**` cannot import `mcq/**`
  - `common/**` cannot import `mcq/**`, `story/**`, `trailer/**`
  - `capabilities/**` cannot import verticals

---

## API stability

- **No HTTP route changes** — `/api/story-video/*`, `/api/trailer-breakdown/*`, `/api/videos/*` unchanged
- **No MongoDB schema changes** — job documents keep same fields
- **No frontend API client signature changes** — feature `api.ts` files keep same exports; internal imports change only
- **Environment variables unchanged** — `OPENAI_API_KEY`, `TRAILER_BREAKDOWN_MAX_JOB_ATTEMPTS`, etc.

---

## Testing & verification

No automated test suite exists today. Each PR includes a manual checklist:

| PR | Verify |
|----|--------|
| 1a | Settings page loads; brand defaults appear; TTS preview language normalization |
| 1b | Story job: upload → transcribe stage completes; Trailer job: transcribe stage |
| 2a | Story: script-only narration path; Trailer: breakdown TTS per segment; MCQ: generate video with openai/elevenlabs/system TTS |
| 3a | Story: scene detection + clip build; Trailer: scene cuts + video assembly |
| 4a | Cancel mid-job (story + trailer); retry after forced failure |
| 5a–c | Voice preview in both editors; library cards render; polling updates progress |
| 6 | `npm run build` backend + frontend; grep confirms no forbidden imports |

**Recommended follow-up (post-refactor):** unit tests for `capabilities/voice/ttsResolution` (platform fallback), `capabilities/ai/whisper` (chunk merge), `capabilities/voice/scriptChunker`.

---

## Risks & mitigations

| Risk | Mitigation |
|------|------------|
| Large ffmpeg move breaks story render | Move function-by-function; keep story wrapper tests via manual render |
| Import cycle during migration | Shims + strict phase order; capabilities never import verticals |
| `ttsFactory` behavior drift from mcq | Port `ttsResolution` verbatim first; refactor naming second |
| Frontend VoiceSettings regression | `TrailerVoiceSettings` kept until `VoiceSettingsPanel` parity verified |
| Docker missing `say`/pyscenedetect | Existing fallbacks preserved; document in Dockerfile comments |

---

## Success criteria

1. Zero imports from `trailer/` → `story/` or `mcq/`
2. Zero imports from `story/` → `mcq/`
3. Zero imports from `common/` → any vertical
4. `capabilities/` has no imports from vertical folders
5. `VoiceSettingsPanel` used by story + trailer editors
6. `JobProgressCard` used by both library pages
7. All three products complete an end-to-end job after refactor

---

## Open decisions (defaults chosen)

| Decision | Choice |
|----------|--------|
| MCQ job progress helpers | Defer — different model than story/trailer |
| Merge `common/utils/ffmpeg` with capabilities/media | No — MCQ renderer stays separate |
| Commit strategy | One PR per phase above |
| ESLint enforcement | Phase 6 — `no-restricted-imports` |
