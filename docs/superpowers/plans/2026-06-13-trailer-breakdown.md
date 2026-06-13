# Trailer Breakdown Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Trailer Breakdown feature — paste YouTube URL → download → AI script → voiceover breakdown video.

**Architecture:** New `backend/src/trailer/` module mirroring story-video (controller → service → queue → pipeline). Reuses Whisper, scene detection, TTS, FFmpeg, S3. New: yt-dlp download + GPT breakdown prompts.

**Tech Stack:** Express, Mongoose, yt-dlp, OpenAI (Whisper + GPT-4o-mini + TTS), FFmpeg, React + TanStack Query.

**Spec:** `docs/superpowers/specs/2026-06-13-trailer-breakdown-design.md`

---

## File map

| File | Responsibility |
|------|----------------|
| `backend/src/common/db/models/TrailerBreakdownJob.ts` | Mongoose model |
| `backend/src/trailer/io/youtubeDownload.ts` | yt-dlp wrapper |
| `backend/src/trailer/ai/trailerAnalysis.ts` | GPT breakdown script |
| `backend/src/trailer/render/assembleBreakdown.ts` | Per-segment clip + overlay + mux |
| `backend/src/trailer/pipeline/queue.ts` | Lambda or in-process dispatch |
| `backend/src/trailer/pipeline/run.ts` | Pipeline orchestrator |
| `backend/src/trailer/services/trailerBreakdownService.ts` | Business logic |
| `backend/src/trailer/controllers/trailerBreakdownController.ts` | Express routes |
| `backend/src/app.ts` | Mount routes + rate limiter |
| `backend/Dockerfile` | Install yt-dlp |
| `frontend/src/features/trailer-breakdown/*` | Library + editor UI |

---

### Task 1: Database model

- [x] Create `TrailerBreakdownJob` with status, segments, intermediate, output fields

### Task 2: YouTube download

- [x] Create `youtubeDownload.ts` with URL validation + yt-dlp spawn

### Task 3: AI analysis

- [x] Create `trailerAnalysis.ts` with GPT json_object prompt

### Task 4: Render assembler

- [x] Create `assembleBreakdown.ts` — cut, pad, drawtext, mux per segment

### Task 5: Pipeline

- [x] Create `queue.ts` + `run.ts` — full download→upload flow

### Task 6: Service + controller

- [x] CRUD endpoints: create, jobs, status, result, play, cancel, retry, script patch, render

### Task 7: App wiring + Dockerfile

- [x] Mount `/api/trailer-breakdown`, add yt-dlp to Docker

### Task 8: Frontend

- [x] API client, library page, editor page, sidebar + routes

### Task 9: Verification

- [ ] Run `npm run build` in backend and frontend
- [ ] Manual smoke: create job with YouTube URL
