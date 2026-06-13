# Capabilities Layer Refactor — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract shared AI, voice, media, and job primitives into `backend/src/capabilities/` and shared UI into `frontend/src/shared/`, eliminating cross-vertical imports while keeping orchestration in `mcq/`, `story/`, and `trailer/`.

**Architecture:** Layered capabilities platform — `vertical → capabilities → common`. Move code by function (not big-bang). Each PR is buildable. MCQ quiz ffmpeg renderer stays in `common/utils/ffmpeg.ts`.

**Tech Stack:** Express, Mongoose, TypeScript (ESM), OpenAI SDK, FFmpeg, React + TanStack Query + Vite.

**Spec:** `docs/superpowers/specs/2026-06-13-capabilities-refactor-design.md`

---

## File map (created / moved)

| Path | Responsibility |
|------|----------------|
| `backend/src/common/i18n/quizUiStrings.ts` | Brand defaults, intro/outro UI strings (moved from mcq) |
| `backend/src/common/i18n/quizLanguages.ts` | Language normalization (moved from mcq) |
| `backend/src/capabilities/ai/client.ts` | `createOpenAIClient` |
| `backend/src/capabilities/ai/whisper.ts` | Whisper verbose transcription + chunking |
| `backend/src/capabilities/ai/embeddings.ts` | `embedTexts`, `cosineSimilarity` |
| `backend/src/capabilities/ai/types.ts` | `WhisperSegment`, `TranscribeVerboseResult` |
| `backend/src/capabilities/ai/jsonExtract.ts` | `extractJsonArray` (from mcqAgent) |
| `backend/src/capabilities/ai/index.ts` | Barrel exports |
| `backend/src/capabilities/voice/types.ts` | `VoiceOverrides`, `ResolvedTts`, `TtsProvider` |
| `backend/src/capabilities/voice/ttsResolution.ts` | Resolution + server fallback |
| `backend/src/capabilities/voice/ttsFactory.ts` | `createTtsFromSettings`, `createIntroOutroTtsService` |
| `backend/src/capabilities/voice/scriptChunker.ts` | `chunkScriptForTts` |
| `backend/src/capabilities/voice/synthesize.ts` | `synthesizeScriptToNarration` |
| `backend/src/capabilities/voice/index.ts` | Barrel exports |
| `backend/src/capabilities/media/probe.ts` | Duration + dimensions |
| `backend/src/capabilities/media/audio.ts` | WAV extract, MP3 concat |
| `backend/src/capabilities/media/video.ts` | Cut, pad, concat, mux, scene cut times |
| `backend/src/capabilities/media/sceneWindows.ts` | `buildSceneWindows`, `assignWhisperToSceneWindows` |
| `backend/src/capabilities/media/scene/detectFacade.ts` | `resolveSceneCuts` |
| `backend/src/capabilities/media/scene/pyDetect.ts` | PySceneDetect wrapper |
| `backend/src/capabilities/media/index.ts` | Barrel exports |
| `backend/src/capabilities/jobs/types.ts` | `JobProgressFields`, `RetryableJobFields` |
| `backend/src/capabilities/jobs/progress.ts` | `createJobProgressHelpers` |
| `backend/src/capabilities/jobs/retry.ts` | `createRetryScheduler` |
| `backend/src/capabilities/jobs/index.ts` | Barrel exports |
| `frontend/src/shared/voice/*` | `VoiceSettingsPanel`, types, ElevenLabs hook |
| `frontend/src/shared/jobs/*` | Progress card, labels, polling hook |
| `frontend/src/shared/media/*` | Authenticated video preview |
| `frontend/src/shared/ui/*` | `FormSection`, `PhaseStepper` |

---

## Phase 1a — `common/i18n` (fix reverse dependencies)

### Task 1: Move quiz i18n modules

**Files:**
- Move: `backend/src/mcq/utils/quizUiStrings.ts` → `backend/src/common/i18n/quizUiStrings.ts`
- Move: `backend/src/mcq/utils/quizLanguages.ts` → `backend/src/common/i18n/quizLanguages.ts`
- Modify: all importers listed below

- [ ] **Step 1: Move files**

```bash
cd /Users/dsahani/Documents/mcq-shorts-agent
mkdir -p backend/src/common/i18n
git mv backend/src/mcq/utils/quizUiStrings.ts backend/src/common/i18n/quizUiStrings.ts
git mv backend/src/mcq/utils/quizLanguages.ts backend/src/common/i18n/quizLanguages.ts
```

- [ ] **Step 2: Update imports**

Replace imports in these files:

| File | Old import | New import |
|------|------------|------------|
| `common/services/settingsService.ts` | `../../mcq/utils/quizUiStrings.js` | `../i18n/quizUiStrings.js` |
| `common/services/ttsPreviewService.ts` | `../../mcq/utils/quizLanguages.js` | `../i18n/quizLanguages.js` |
| `mcq/pipeline/audioGenerator.ts` | `../utils/quizUiStrings.js` | `../../common/i18n/quizUiStrings.js` |
| `mcq/pipeline/videoRenderer.ts` | `../utils/quizUiStrings.js` | `../../common/i18n/quizUiStrings.js` |
| `mcq/services/videosService.ts` | `../utils/quizLanguages.js` | `../../common/i18n/quizLanguages.js` |
| `mcq/videoJob/introOutroPhase.ts` | `../utils/quizUiStrings.js` | `../../common/i18n/quizUiStrings.js` |
| `mcq/agents/mcqAgent.ts` | `../utils/quizLanguages.js` | `../../common/i18n/quizLanguages.js` |
| `mcq/utils/topicLocalization.ts` | `./quizLanguages.js` | `../../common/i18n/quizLanguages.js` |
| `mcq/runVideoPipeline.ts` | `./utils/quizUiStrings.js` | `../common/i18n/quizUiStrings.js` |

- [ ] **Step 3: Verify build**

```bash
cd backend && npm run build
```

Expected: `✅ Build complete` with zero errors.

- [ ] **Step 4: Manual smoke**

1. Start dev server, open Settings — brand name fields load.
2. POST `/api/tts/preview` with `{ "language": "hi" }` — no crash (uses `normalizeQuizLanguage`).

- [ ] **Step 5: Commit**

```bash
git add backend/src/common/i18n backend/src/common/services backend/src/mcq
git commit -m "refactor: move quiz i18n to common/i18n (fix reverse deps)"
```

---

## Phase 1b — `capabilities/ai`

### Task 2: Create AI types and client

**Files:**
- Create: `backend/src/capabilities/ai/types.ts`
- Create: `backend/src/capabilities/ai/client.ts`

- [ ] **Step 1: Create `capabilities/ai/types.ts`**

```typescript
export type WhisperSegment = {
  start: number;
  end: number;
  text: string;
};

export type TranscribeVerboseResult = {
  segments: WhisperSegment[];
  language?: string;
};
```

- [ ] **Step 2: Create `capabilities/ai/client.ts`**

Copy `createOpenAIClient` verbatim from `backend/src/story/ai/openaiStory.ts` (lines 27–30). Import `OpenAI` from `'openai'`.

- [ ] **Step 3: Commit types + client**

```bash
git add backend/src/capabilities/ai/types.ts backend/src/capabilities/ai/client.ts
git commit -m "feat(capabilities): add ai client and whisper types"
```

### Task 3: Move Whisper + embeddings

**Files:**
- Create: `backend/src/capabilities/ai/whisper.ts`
- Create: `backend/src/capabilities/ai/embeddings.ts`
- Create: `backend/src/capabilities/ai/index.ts`
- Modify: `backend/src/story/ai/openaiStory.ts` (shim)
- Modify: importers

- [ ] **Step 1: Create `whisper.ts`**

Move from `openaiStory.ts`:
- `transcribeAudioVerbose`
- `parseStoredVideoWhisper`
- `assignWhisperToSceneWindows` → **skip for now** (goes to `media/sceneWindows.ts` in Phase 3)
- Private helpers: `normalizeWhisperSegments`, `mergeAdjacentSegments`
- Type `VerboseTranscription` (internal)

Change imports:
- `WhisperSegment` from `./types.js`
- `TranscribeVerboseResult` from `./types.js`
- `getMediaDurationSec` — **temporary**: import from `../../story/render/ffmpeg.js` until Phase 3 moves it to `capabilities/media/probe.ts`

- [ ] **Step 2: Create `embeddings.ts`**

Move `embedTexts` and `cosineSimilarity` from `openaiStory.ts`.

- [ ] **Step 3: Create `capabilities/ai/index.ts`**

```typescript
export { createOpenAIClient } from './client.js';
export type { WhisperSegment, TranscribeVerboseResult } from './types.js';
export { transcribeAudioVerbose, parseStoredVideoWhisper } from './whisper.js';
export { embedTexts, cosineSimilarity } from './embeddings.js';
```

- [ ] **Step 4: Replace `story/ai/openaiStory.ts` with shim**

```typescript
/** @deprecated Import from capabilities/ai instead */
export {
  createOpenAIClient,
  transcribeAudioVerbose,
  parseStoredVideoWhisper,
  embedTexts,
  cosineSimilarity,
  assignWhisperToSceneWindows,
} from '../../capabilities/ai/index.js';
export type { TranscribeVerboseResult } from '../../capabilities/ai/index.js';
```

Keep `assignWhisperToSceneWindows` in openaiStory shim until Phase 3 (re-export from media).

- [ ] **Step 5: Update `trailer/pipeline/run.ts` imports**

```typescript
import {
  createOpenAIClient,
  transcribeAudioVerbose,
} from '../../capabilities/ai/index.js';
// assignWhisperToSceneWindows — still from story shim OR media once Phase 3 done
```

- [ ] **Step 6: Update `story/narration/ttsNarration.ts`**

```typescript
import { transcribeAudioVerbose } from '../../capabilities/ai/index.js';
```

- [ ] **Step 7: Update `story/narration/narrationSceneMatch.ts`**

```typescript
import { embedTexts, cosineSimilarity } from '../../capabilities/ai/index.js';
```

- [ ] **Step 8: Update `story/lib/types.ts`**

Re-export for backward compat:

```typescript
export type { WhisperSegment } from '../../capabilities/ai/types.js';
// keep NarrationSegment, SceneSegment locally
```

- [ ] **Step 9: Verify**

```bash
cd backend && npm run build
```

- [ ] **Step 10: Commit**

```bash
git add backend/src/capabilities/ai backend/src/story backend/src/trailer
git commit -m "feat(capabilities): extract OpenAI client, Whisper, embeddings"
```

### Task 4: Extract JSON helper from mcqAgent

**Files:**
- Create: `backend/src/capabilities/ai/jsonExtract.ts`
- Modify: `backend/src/mcq/agents/mcqAgent.ts`

- [ ] **Step 1: Create `jsonExtract.ts`**

Move `extractJson` from `mcqAgent.ts`, rename export to `extractJsonArray`:

```typescript
export function extractJsonArray(text: string): string {
  if (!text || typeof text !== 'string') {
    throw new Error('AI response is empty or not a string');
  }
  let cleaned = text.replace(/```json/gi, '').replace(/```/g, '').trim();
  const start = cleaned.indexOf('[');
  const end = cleaned.lastIndexOf(']');
  if (start === -1 || end === -1) {
    throw new Error('No JSON array found in AI response');
  }
  return cleaned.slice(start, end + 1);
}
```

- [ ] **Step 2: Update mcqAgent**

```typescript
import { extractJsonArray } from '../../capabilities/ai/jsonExtract.js';
// replace extractJson(text) calls with extractJsonArray(text)
```

- [ ] **Step 3: Export from `capabilities/ai/index.ts`**

```typescript
export { extractJsonArray } from './jsonExtract.js';
```

- [ ] **Step 4: Build + commit**

```bash
cd backend && npm run build
git add backend/src/capabilities/ai backend/src/mcq/agents/mcqAgent.ts
git commit -m "feat(capabilities): extract JSON array parser for AI responses"
```

---

## Phase 2a — `capabilities/voice`

### Task 5: Voice types and resolution

**Files:**
- Create: `backend/src/capabilities/voice/types.ts`
- Create: `backend/src/capabilities/voice/ttsResolution.ts`
- Modify: `backend/src/mcq/videoJob/ttsResolution.ts` (shim)

- [ ] **Step 1: Create `capabilities/voice/types.ts`**

```typescript
export type TtsProvider = 'system' | 'openai' | 'elevenlabs';
export type TtsOverride = 'inherit' | TtsProvider;

export type VoiceOverrides = {
  ttsProvider?: TtsProvider | TtsOverride;
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
  openaiKey: string;
};
```

- [ ] **Step 2: Create `capabilities/voice/ttsResolution.ts`**

Copy `resolveTtsFromRequest`, `applyServerTtsFallback` from `mcq/videoJob/ttsResolution.ts`.

Add new function (replaces fake-request hack):

```typescript
import type { AppSettings } from '../../common/services/settingsService.js';
import type { GenerateRequestPayload } from '../../mcq/videoJob/types.js';
import type { ResolvedTts, VoiceOverrides, TtsProvider } from './types.js';

export function resolveTtsFromSettings(
  settings: AppSettings,
  overrides: VoiceOverrides = {}
): ResolvedTts {
  const inherit = overrides.ttsProvider === 'inherit' || overrides.ttsProvider === undefined;
  const provider: TtsProvider = inherit
    ? (settings.tts.provider as TtsProvider) || 'system'
    : (overrides.ttsProvider as TtsProvider);

  const voiceFromOverride = overrides.ttsVoice?.trim();
  const systemVoice = overrides.systemVoice?.trim();
  const voice =
    provider === 'elevenlabs'
      ? voiceFromOverride || settings.elevenlabs.voiceId
      : provider === 'openai'
        ? voiceFromOverride || settings.tts.voice
        : systemVoice || settings.tts.voice;

  const ttsModel = overrides.ttsModel?.trim() || 'tts-1';
  const elevenlabsModelId =
    overrides.elevenlabsModelId?.trim() || settings.elevenlabs.modelId || 'eleven_turbo_v2_5';
  const openaiKey = settings.openai.apiKey?.trim() || '';

  return { provider, voice, ttsModel, elevenlabsModelId, openaiKey };
}

/** MCQ generate-video request shape — keep for mcq vertical */
export function resolveTtsFromRequest(req: GenerateRequestPayload, settings: AppSettings): ResolvedTts {
  return resolveTtsFromSettings(settings, {
    ttsProvider: req.ttsProvider,
    ttsVoice: req.ttsVoice,
    ttsModel: req.ttsModel,
    systemVoice: req.systemVoice,
    elevenlabsModelId: req.elevenlabsModelId,
  });
}

export function applyServerTtsFallback(resolved: ResolvedTts, settings: AppSettings): ResolvedTts {
  // copy verbatim from mcq/videoJob/ttsResolution.ts
}
```

- [ ] **Step 3: Shim `mcq/videoJob/ttsResolution.ts`**

```typescript
export type { ResolvedTts } from '../../capabilities/voice/types.js';
export {
  resolveTtsFromRequest,
  applyServerTtsFallback,
} from '../../capabilities/voice/ttsResolution.js';
export { createIntroOutroTtsService } from '../../capabilities/voice/ttsFactory.js';
```

(After Task 6 creates `ttsFactory.ts`.)

- [ ] **Step 4: Commit resolution module**

```bash
git add backend/src/capabilities/voice
git commit -m "feat(capabilities): extract TTS resolution and types"
```

### Task 6: TTS factory + script chunker + synthesize

**Files:**
- Create: `backend/src/capabilities/voice/ttsFactory.ts`
- Create: `backend/src/capabilities/voice/scriptChunker.ts`
- Create: `backend/src/capabilities/voice/synthesize.ts`
- Create: `backend/src/capabilities/voice/index.ts`
- Modify: `story/narration/ttsNarration.ts`
- Modify: `trailer/render/assembleBreakdown.ts`

- [ ] **Step 1: Create `ttsFactory.ts`**

```typescript
import { createTTSService, type TTSService } from '../../common/services/ttsService.js';
import { resolveOpenAiCredentials, type AppSettings } from '../../common/services/settingsService.js';
import {
  resolveTtsFromSettings,
  applyServerTtsFallback,
  resolveTtsFromRequest,
} from './ttsResolution.js';
import type { ResolvedTts, VoiceOverrides } from './types.js';
import type { GenerateRequestPayload } from '../../mcq/videoJob/types.js';

export function resolveTtsForJob(
  settings: AppSettings,
  overrides: VoiceOverrides
): ResolvedTts {
  const base = resolveTtsFromSettings(settings, overrides);
  return applyServerTtsFallback(base, settings);
}

export function createTtsFromSettings(
  settings: AppSettings,
  cacheDir: string,
  overrides: VoiceOverrides = {}
): { tts: TTSService; resolved: ResolvedTts } {
  const resolved = resolveTtsForJob(settings, overrides);
  const creds = resolveOpenAiCredentials(settings);
  const tts = createTTSService(resolved.provider, {
    apiKey: creds.apiKey || resolved.openaiKey,
    model: resolved.ttsModel,
    cacheDir,
    elevenlabsApiKey: settings.elevenlabs.apiKey || undefined,
    elevenlabsModelId: resolved.elevenlabsModelId,
    openaiApiUrl: creds.apiUrl,
  });
  return { tts, resolved };
}

export function createIntroOutroTtsService(
  resolved: ResolvedTts,
  settings: AppSettings,
  introOutroCacheDir: string
) {
  const creds = resolveOpenAiCredentials(settings);
  return createTTSService(resolved.provider, {
    apiKey: creds.apiKey || resolved.openaiKey,
    model: resolved.ttsModel,
    cacheDir: introOutroCacheDir,
    elevenlabsApiKey: settings.elevenlabs.apiKey || undefined,
    elevenlabsModelId: resolved.elevenlabsModelId,
    openaiApiUrl: creds.apiUrl,
  });
}
```

- [ ] **Step 2: Create `scriptChunker.ts`**

Move `chunkScriptForTts` from `ttsNarration.ts` (export with `MAX_TTS_CHUNK = 3800`).

- [ ] **Step 3: Create `synthesize.ts`**

Move `synthesizeScriptToNarration` from `ttsNarration.ts`. Replace `buildResolvedTts` with:

```typescript
const resolved = resolveTtsForJob(settings, {
  ttsProvider: ttsProvider === 'inherit' ? 'inherit' : ttsProvider,
  ttsVoice: settings.tts.voice,
  ttsModel: 'tts-1',
  elevenlabsModelId: settings.elevenlabs.modelId,
  systemVoice: settings.tts.voice,
});
```

Use `createTtsFromSettings` instead of inline `createTTSService`.

Import media from story ffmpeg until Phase 3:

```typescript
import { concatAudioFilesMp3, extractAudioWav16kMono } from '../../story/render/ffmpeg.js';
```

- [ ] **Step 4: Slim `story/narration/ttsNarration.ts`**

```typescript
export { synthesizeScriptToNarration } from '../../capabilities/voice/synthesize.js';
```

- [ ] **Step 5: Update `trailer/render/assembleBreakdown.ts`**

Remove `buildResolvedTts` function (lines 101–118). In `synthesizeSegmentAudio`:

```typescript
import { createTtsFromSettings, resolveTtsForJob } from '../../capabilities/voice/index.js';

const { tts, resolved } = createTtsFromSettings(settings, cacheDir, {
  ttsProvider: options.ttsProvider,
  ttsVoice: options.ttsVoice,
  ttsModel: options.ttsModel,
  systemVoice: options.systemVoice,
  elevenlabsModelId: options.elevenlabsModelId,
});
```

Remove import from `mcq/videoJob/ttsResolution.js`.

- [ ] **Step 6: Create `capabilities/voice/index.ts`**

Export all voice modules.

- [ ] **Step 7: Verify**

```bash
cd backend && npm run build
```

Manual: trailer re-render with TTS; story script-only path; MCQ video generate.

- [ ] **Step 8: Commit**

```bash
git add backend/src/capabilities/voice backend/src/story/narration backend/src/trailer/render backend/src/mcq/videoJob/ttsResolution.ts
git commit -m "feat(capabilities): extract voice factory, chunker, and synthesize"
```

---

## Phase 3a — `capabilities/media`

### Task 7: Media probe + audio + video ops

**Files:**
- Create: `backend/src/capabilities/media/probe.ts`
- Create: `backend/src/capabilities/media/audio.ts`
- Create: `backend/src/capabilities/media/video.ts`
- Modify: `backend/src/story/render/ffmpeg.ts`

- [ ] **Step 1: Create `probe.ts`**

Move from `story/render/ffmpeg.ts`:
- `getMediaDurationSec` (uses `extractDuration` from `common/utils/ffmpeg.js`)
- `getVideoStreamDimensions`

- [ ] **Step 2: Create `audio.ts`**

Move:
- `extractAudioWav16kMono`
- `concatAudioFilesMp3`

- [ ] **Step 3: Create `video.ts`**

Move:
- `detectSceneCutTimes`
- `cutVideoSilentSegment`
- `cutAndPadSilentSegment`
- `concatVideoFilesConcatDemuxer`
- `muxVideoWithAudio`
- `extractAudioSegment`

- [ ] **Step 4: Update `whisper.ts`**

Change `getMediaDurationSec` import to `../media/probe.js`.

- [ ] **Step 5: Update `capabilities/voice/synthesize.ts`**

```typescript
import { concatAudioFilesMp3, extractAudioWav16kMono } from '../media/audio.js';
```

- [ ] **Step 6: Refactor `story/render/ffmpeg.ts`**

Replace moved function bodies with re-exports:

```typescript
export {
  getMediaDurationSec,
  getVideoStreamDimensions,
} from '../../capabilities/media/probe.js';
export { extractAudioWav16kMono, concatAudioFilesMp3 } from '../../capabilities/media/audio.js';
export {
  cutAndPadSilentSegment,
  concatVideoFilesConcatDemuxer,
  muxVideoWithAudio,
  detectSceneCutTimes,
} from '../../capabilities/media/video.js';
```

Keep story-only functions locally: `extractStoryRerenderClip`, `stillImageToProgramClipMp4`, `overlayImageOnVideo`, `buildSceneWindows` (until Task 8).

- [ ] **Step 7: Update `trailer/pipeline/run.ts` and `trailer/render/assembleBreakdown.ts`**

```typescript
import { extractAudioWav16kMono, getMediaDurationSec } from '../../capabilities/media/index.js';
import { cutAndPadSilentSegment, concatVideoFilesConcatDemuxer, concatAudioFilesMp3, muxVideoWithAudio } from '../../capabilities/media/index.js';
```

Remove imports from `story/render/ffmpeg.js`.

- [ ] **Step 8: Build + commit**

```bash
cd backend && npm run build
git add backend/src/capabilities/media backend/src/story/render/ffmpeg.ts backend/src/capabilities/ai/whisper.ts backend/src/capabilities/voice/synthesize.ts backend/src/trailer
git commit -m "feat(capabilities): extract generic media ffmpeg ops"
```

### Task 8: Scene detection + scene windows

**Files:**
- Create: `backend/src/capabilities/media/sceneWindows.ts`
- Move: `story/scene/detectFacade.ts` → `capabilities/media/scene/detectFacade.ts`
- Move: `story/scene/pyDetect.ts` → `capabilities/media/scene/pyDetect.ts`
- Modify: pipelines, shims

- [ ] **Step 1: Create `sceneWindows.ts`**

Move from `openaiStory.ts` / `story/render/ffmpeg.ts`:
- `assignWhisperToSceneWindows` (from openaiStory)
- `buildSceneWindows` (from story/render/ffmpeg.ts)

- [ ] **Step 2: Move scene detection**

```bash
git mv backend/src/story/scene/detectFacade.ts backend/src/capabilities/media/scene/detectFacade.ts
git mv backend/src/story/scene/pyDetect.ts backend/src/capabilities/media/scene/pyDetect.ts
```

Update imports inside `detectFacade.ts`:
- `detectSceneCutTimes` from `../video.js`
- `StorySceneDetectionMode` — move type to `capabilities/media/scene/types.ts` OR import from `story/lib/storyOptions.js` (acceptable: capabilities may import story types only if we move the type — **prefer** copy minimal type):

```typescript
// capabilities/media/scene/types.ts
export type SceneDetectionMode = 'ffmpeg' | 'pyscenedetect' | 'hybrid';
```

Update `detectFacade.ts` to use `SceneDetectionMode`.

- [ ] **Step 3: Create `capabilities/media/index.ts`**

```typescript
export * from './probe.js';
export * from './audio.js';
export * from './video.js';
export * from './sceneWindows.js';
export { resolveSceneCuts } from './scene/detectFacade.js';
```

- [ ] **Step 4: Shim `story/scene/detectFacade.ts`**

```typescript
export { resolveSceneCuts } from '../../capabilities/media/scene/detectFacade.js';
```

- [ ] **Step 5: Update importers**

| File | New import |
|------|------------|
| `story/pipeline/run.ts` | `../../capabilities/media/scene/detectFacade.js` |
| `trailer/pipeline/run.ts` | `../../capabilities/media/index.js` |
| `story/pipeline/run.ts` | `assignWhisperToSceneWindows` from `capabilities/media/sceneWindows.js` |

- [ ] **Step 6: Update `capabilities/ai/index.ts`**

Remove `assignWhisperToSceneWindows` if added; export only AI concerns.

- [ ] **Step 7: Build + commit**

```bash
cd backend && npm run build
git commit -m "feat(capabilities): extract scene detection and scene windows"
```

---

## Phase 4a — `capabilities/jobs`

### Task 9: Job progress helpers

**Files:**
- Create: `backend/src/capabilities/jobs/types.ts`
- Create: `backend/src/capabilities/jobs/progress.ts`
- Create: `backend/src/capabilities/jobs/retry.ts`
- Create: `backend/src/capabilities/jobs/index.ts`
- Modify: `story/pipeline/run.ts`, `trailer/pipeline/run.ts`

- [ ] **Step 1: Create `jobs/types.ts`**

```typescript
export type JobEvent = { at: Date; stage: string; message: string };

export type JobProgressFields = {
  progressPercent: number;
  stage: string;
  progressMessage: string;
  events?: JobEvent[];
  status: string;
  cancelRequested?: boolean;
  idempotencyKey?: string;
  error?: string;
  save(): Promise<unknown>;
};

export type RetryableJobFields = JobProgressFields & {
  attempts: number;
  maxAttempts?: number;
};
```

- [ ] **Step 2: Create `jobs/progress.ts`**

```typescript
import type { Model } from 'mongoose';
import type { JobProgressFields } from './types.js';

export function createJobProgressHelpers<T extends JobProgressFields>(model: Model<T>) {
  async function pushEvent(job: T, stage: string, message: string) {
    const ev = [...(job.events || []), { at: new Date(), stage, message }];
    job.events = ev.slice(-300) as T['events'];
  }

  async function setProgress(job: T, pct: number, stage: string, message: string) {
    job.progressPercent = Math.min(100, Math.max(0, pct));
    job.stage = stage;
    job.progressMessage = message;
    await pushEvent(job, stage, message);
    await job.save();
  }

  async function isCancelled(jobId: string): Promise<boolean> {
    const j = await model.findById(jobId).select('cancelRequested').lean();
    return !!(j && (j as { cancelRequested?: boolean }).cancelRequested);
  }

  async function markCancelled(job: T) {
    job.status = 'cancelled';
    job.stage = 'cancelled';
    job.progressMessage = 'Cancelled';
    job.progressPercent = 0;
    job.idempotencyKey = '';
    await pushEvent(job, 'cancelled', 'Cancelled by user');
    await job.save();
  }

  async function failJobPermanent(job: T, error: string) {
    job.status = 'failed';
    job.stage = 'failed';
    job.error = error;
    job.progressMessage = error;
    job.progressPercent = 0;
    job.idempotencyKey = '';
    await pushEvent(job, 'failed', error);
    await job.save();
  }

  return { pushEvent, setProgress, isCancelled, markCancelled, failJobPermanent };
}
```

- [ ] **Step 3: Create `jobs/retry.ts`**

```typescript
import type { Model } from 'mongoose';
import type { RetryableJobFields } from './types.js';

export function createRetryScheduler<T extends RetryableJobFields>(
  model: Model<T>,
  options: {
    maxAttemptsEnvKey: string;
    defaultMax: number;
    requeue: (jobId: string, job: T) => void | Promise<void>;
  }
) {
  function maxJobAttempts(job: T): number {
    const n = job.maxAttempts;
    if (n && n > 0) return n;
    return Math.max(1, parseInt(process.env[options.maxAttemptsEnvKey] || String(options.defaultMax), 10));
  }

  return async function scheduleRetryOrFail(
    jobId: string,
    error: string,
    helpers: ReturnType<typeof import('./progress.js').createJobProgressHelpers<T>>
  ): Promise<void> {
    const job = await model.findById(jobId);
    if (!job) return;
    const max = maxJobAttempts(job);
    if (await helpers.isCancelled(job._id.toString())) {
      await helpers.failJobPermanent(job, error);
      return;
    }
    if (job.attempts < max) {
      job.status = 'pending';
      job.stage = 'queued';
      job.progressMessage = `Will retry (${job.attempts}/${max}): ${error.slice(0, 200)}`;
      job.error = error;
      job.progressPercent = 0;
      await helpers.pushEvent(job, 'retry_scheduled', error);
      await job.save();
      const delay = Math.min(120_000, 3000 * Math.pow(2, Math.max(0, job.attempts - 1)));
      setTimeout(() => {
        void options.requeue(jobId, job);
      }, delay);
      return;
    }
    await helpers.failJobPermanent(job, error);
  };
}
```

- [ ] **Step 4: Wire `story/pipeline/run.ts`**

Near top of file:

```typescript
import { createJobProgressHelpers, createRetryScheduler } from '../../capabilities/jobs/index.js';

const jobProgress = createJobProgressHelpers(StoryVideoJob);
const { setProgress, isCancelled, markCancelled, failJobPermanent } = jobProgress;

const scheduleRetryOrFail = createRetryScheduler(StoryVideoJob, {
  maxAttemptsEnvKey: 'STORY_VIDEO_MAX_JOB_ATTEMPTS',
  defaultMax: 3,
  requeue: async (jobId) => {
    const { queueStoryVideoJob } = await import('./queue.js');
    void queueStoryVideoJob(jobId);
  },
});
```

Delete local duplicate function definitions (lines ~107–176).

Update `scheduleRetryOrFail` call sites to pass `jobProgress` if signature requires it, OR bind:

```typescript
const scheduleRetryOrFailBound = (jobId: string, error: string) =>
  scheduleRetryOrFail(jobId, error, jobProgress);
```

- [ ] **Step 5: Wire `trailer/pipeline/run.ts`**

Same pattern with trailer-specific `requeue`:

```typescript
requeue: async (jobId, job) => {
  const { queueTrailerBreakdownJob } = await import('./queue.js');
  const userId = job.userId.toString();
  const workDir =
    (job as ITrailerBreakdownJob).intermediate?.workDir ||
    path.join(process.env.TEMP_DIR || './temp', 'trailer-breakdown', userId, jobId);
  const sourcePath =
    (job as ITrailerBreakdownJob).intermediate?.sourceVideoPath || path.join(workDir, 'source.mp4');
  const hasScript = ((job as ITrailerBreakdownJob).breakdownScript?.length ?? 0) > 0;
  let hasSource = false;
  try {
    await fs.access(sourcePath);
    hasSource = true;
  } catch {
    hasSource = false;
  }
  const resumeOpts = hasScript && hasSource ? { renderOnly: true as const } : {};
  void queueTrailerBreakdownJob(jobId, resumeOpts);
},
```

- [ ] **Step 6: Build + manual cancel/retry test + commit**

```bash
cd backend && npm run build
git add backend/src/capabilities/jobs backend/src/story/pipeline/run.ts backend/src/trailer/pipeline/run.ts
git commit -m "feat(capabilities): extract shared job progress and retry helpers"
```

---

## Phase 5a — Frontend `shared/voice`

### Task 10: Voice settings panel

**Files:**
- Create: `frontend/src/shared/voice/types.ts`
- Create: `frontend/src/shared/voice/useElevenLabsVoices.ts`
- Create: `frontend/src/shared/voice/VoiceSettingsPanel.tsx`
- Modify: `TrailerBreakdownEditor.tsx`, `StoryVideoEditor.tsx`
- Modify: `TrailerVoiceSettings.tsx` (shim)

- [ ] **Step 1: Create `shared/voice/types.ts`**

```typescript
export type VoiceProvider = 'inherit' | 'openai' | 'elevenlabs' | 'system';

export type VoiceOptions = {
  ttsProvider: VoiceProvider;
  ttsVoice: string;
  ttsModel: 'tts-1' | 'tts-1-hd';
  systemVoice: string;
  elevenlabsModelId: string;
  narrationLanguage: string;
};
```

- [ ] **Step 2: Create `useElevenLabsVoices.ts`**

Extract ElevenLabs fetch logic from `TrailerVoiceSettings.tsx` (lines 23–31).

- [ ] **Step 3: Create `VoiceSettingsPanel.tsx`**

Move body of `TrailerVoiceSettings.tsx` into generic component using `VoiceOptions` type. Props:

```typescript
type Props = {
  value: VoiceOptions;
  onChange: (next: VoiceOptions) => void;
  disabled?: boolean;
  allowInherit?: boolean;
  previewText?: string;
  showNarrationLanguage?: boolean;
  reRenderHint?: boolean;
};
```

- [ ] **Step 4: Shim `TrailerVoiceSettings.tsx`**

```typescript
import { VoiceSettingsPanel } from '../../../shared/voice/VoiceSettingsPanel';
import type { TrailerJobOptions } from '../api';
export { DEFAULT_TRAILER_OPTIONS } from './trailerVoiceDefaults'; // or keep defaults inline

export function TrailerVoiceSettings(props: { options: TrailerJobOptions; onChange: ...; disabled?: boolean }) {
  return (
    <VoiceSettingsPanel
      value={props.options}
      onChange={props.onChange}
      disabled={props.disabled}
      allowInherit
      showNarrationLanguage
      previewText="This is a preview of the breakdown voiceover."
    />
  );
}
```

- [ ] **Step 5: Replace story editor voice section**

In `StoryVideoEditor.tsx`, replace inline `<select>` TTS block (~line 927) with `<VoiceSettingsPanel allowInherit value={...} onChange={...} />`.

- [ ] **Step 6: Verify frontend build**

```bash
cd frontend && npm run build
```

Manual: preview voice in trailer + story editors.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/shared/voice frontend/src/features/trailer-breakdown frontend/src/features/story-video
git commit -m "feat(frontend): shared VoiceSettingsPanel for story and trailer"
```

---

## Phase 5b — Frontend `shared/jobs` + `shared/media`

### Task 11: Job status UI

**Files:**
- Create: `frontend/src/shared/jobs/friendlyLabels.ts`
- Create: `frontend/src/shared/jobs/statusStyles.ts`
- Create: `frontend/src/shared/jobs/types.ts`
- Create: `frontend/src/shared/jobs/JobProgressCard.tsx`
- Create: `frontend/src/shared/jobs/useJobStatusPoll.ts`
- Modify: `StoryVideoLibrary.tsx`, `TrailerBreakdownLibrary.tsx`

- [ ] **Step 1: Create `friendlyLabels.ts`**

Merge `storyVideoUi.friendlyStatusLabel` and `trailerBreakdownUi` stage maps:

```typescript
const DEFAULT_STATUS_LABELS: Record<string, string> = {
  pending: 'Pending',
  processing: 'In progress',
  completed: 'Complete',
  failed: 'Failed',
  cancelled: 'Cancelled',
  queued: 'Queued',
};

export function friendlyStatusLabel(status: string): string {
  return DEFAULT_STATUS_LABELS[status] || status;
}

export function friendlyStageLabel(stage: string, custom?: Record<string, string>): string {
  const map = custom || {};
  return map[stage] || stage.replace(/_/g, ' ');
}
```

- [ ] **Step 2: Create `statusStyles.ts`**

Extract identical `statusStyles` function from both library pages.

- [ ] **Step 3: Create `JobProgressCard.tsx`**

Extract shared card layout from `StoryVideoLibrary.tsx` / `TrailerBreakdownLibrary.tsx` (~lines 10–90). Accept props:

```typescript
export type JobProgressCardProps = {
  jobId: string;
  title: string;
  status: string;
  stage?: string;
  progressPercent: number;
  progressMessage?: string;
  error?: string;
  editHref: string;
  stageLabels?: Record<string, string>;
  onPlay?: () => void;
  playReady?: boolean;
};
```

- [ ] **Step 4: Create `useJobStatusPoll.ts`**

Generic wrapper over `useQuery` matching story/trailer status shape.

- [ ] **Step 5: Refactor both library pages to use shared components**

- [ ] **Step 6: Build + commit**

```bash
cd frontend && npm run build
git commit -m "feat(frontend): shared job progress card and status labels"
```

### Task 12: Shared media preview (optional thin extract)

**Files:**
- Create: `frontend/src/shared/media/useAuthenticatedMediaUrl.ts`

- [ ] **Step 1: Extract auth-fetch play URL pattern**

Both libraries call `authFetch(\`/api/.../play\`)` — extract to hook returning `{ url, loading, error }`.

- [ ] **Step 2: Commit**

```bash
git commit -m "feat(frontend): shared authenticated media URL hook"
```

---

## Phase 5c — Frontend `shared/ui`

### Task 13: Form shells

**Files:**
- Create: `frontend/src/shared/ui/FormSection.tsx`
- Create: `frontend/src/shared/ui/PhaseStepper.tsx`
- Modify: `storyVideoUi.tsx` (shim)

- [ ] **Step 1: Move `FormSection` from `storyVideoUi.tsx` to `shared/ui/FormSection.tsx`**

- [ ] **Step 2: Generalize `StoryPhaseStepper` → `PhaseStepper`**

```typescript
export type PhaseStep = { id: string; label: string; hint: string };

export function PhaseStepper({ phases, activeId, spinningId }: {
  phases: PhaseStep[];
  activeId: string;
  spinningId?: string;
}) { /* same markup */ }
```

- [ ] **Step 3: Update `storyVideoUi.tsx`**

```typescript
export { FormSection } from '../../shared/ui/FormSection';
export { PhaseStepper as StoryPhaseStepper } from '../../shared/ui/PhaseStepper';
// keep story-specific phase config locally
```

- [ ] **Step 4: Build + commit**

```bash
cd frontend && npm run build
git commit -m "feat(frontend): shared FormSection and PhaseStepper"
```

---

## Phase 6 — Cleanup + enforcement

### Task 14: Remove backend shims

**Files:**
- Delete or empty: `story/ai/openaiStory.ts`, `story/scene/detectFacade.ts`, `story/narration/ttsNarration.ts` (if only re-export)
- Update all remaining imports to `capabilities/*`

- [ ] **Step 1: Grep for forbidden imports**

```bash
cd backend/src
rg "from ['\"].*story/ai/openaiStory" .
rg "from ['\"].*mcq/videoJob/ttsResolution" .
rg "from ['\"].*story/scene/detectFacade" .
rg "from ['\"].*story/render/ffmpeg" trailer/
```

Fix every hit to use `capabilities/`.

- [ ] **Step 2: Delete shim files once zero imports**

- [ ] **Step 3: Build**

```bash
cd backend && npm run build
```

- [ ] **Step 4: Commit**

```bash
git commit -m "chore: remove capabilities migration shims"
```

### Task 15: Remove frontend shims

- [ ] **Step 1: Delete `TrailerVoiceSettings.tsx` if `TrailerBreakdownEditor` imports `VoiceSettingsPanel` directly**

- [ ] **Step 2: Trim duplicate helpers from `trailerBreakdownUi.tsx` and `storyVideoUi.tsx`**

- [ ] **Step 3: Commit**

```bash
git commit -m "chore: remove frontend shared migration shims"
```

### Task 16: ESLint import boundaries

**Files:**
- Create: `backend/eslint.config.js` (if missing) OR add to existing config
- Modify: `frontend/eslint.config.js`

- [ ] **Step 1: Add backend ESLint restricted imports**

```javascript
// backend/eslint.config.js (create minimal flat config)
{
  rules: {
    'no-restricted-imports': ['error', {
      patterns: [
        { group: ['**/trailer/**', '**/story/**', '**/mcq/**'], importNames: ['*'], message: 'capabilities/common must not import verticals' },
      ],
    }],
  },
}
```

Apply per-folder overrides:
- `common/**` — cannot import `mcq`, `story`, `trailer`
- `capabilities/**` — cannot import `mcq`, `story`, `trailer`
- `story/**` — cannot import `mcq`
- `trailer/**` — cannot import `mcq`, `story`

- [ ] **Step 2: Verify**

```bash
cd backend && npx eslint src --max-warnings 0
cd frontend && npm run build
```

- [ ] **Step 3: Final commit**

```bash
git commit -m "chore: enforce layer import boundaries via ESLint"
```

---

## Final verification checklist

- [ ] `cd backend && npm run build` — passes
- [ ] `cd frontend && npm run build` — passes
- [ ] `rg "from ['\"].*story/" backend/src/trailer` — zero matches
- [ ] `rg "from ['\"].*mcq/" backend/src/story backend/src/trailer backend/src/common` — zero matches
- [ ] MCQ: generate one quiz video end-to-end
- [ ] Story: upload + process OR re-render
- [ ] Trailer: create breakdown from YouTube URL OR re-render
- [ ] Cancel in-progress story + trailer job
- [ ] Voice preview works in both editors

---

## Spec coverage self-review

| Spec requirement | Task |
|------------------|------|
| `common/i18n` reverse-dep fix | Task 1 |
| `capabilities/ai` | Tasks 2–4 |
| `capabilities/voice` + kill fakeReq | Tasks 5–6 |
| `capabilities/media` | Tasks 7–8 |
| `capabilities/jobs` | Task 9 |
| Frontend `shared/voice` | Task 10 |
| Frontend `shared/jobs` + media | Tasks 11–12 |
| Frontend `shared/ui` | Task 13 |
| Shim removal + ESLint | Tasks 14–16 |
| API stability (no route changes) | All tasks — no controller changes |
| MCQ ffmpeg stays separate | Explicitly excluded in Tasks 7–8 |

---

## Plan self-review

- No TBD placeholders
- `ResolvedTts` / `VoiceOverrides` defined once in Task 5, used consistently in Tasks 6+
- Trailer retry `renderOnly` preserved via `requeue` callback in Task 9
- `WhisperSegment` type lives in `capabilities/ai/types.ts`; story re-exports for compat
