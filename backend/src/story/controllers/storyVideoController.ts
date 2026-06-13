// @ts-nocheck
/**
 * Story-video controller (`/api/story-video/…`).
 *
 * Job lifecycle: create → queue → status/result → edit/re-render.
 * Asset ingestion: multipart upload, presigned S3 PUT, local user-media (no-S3 dev).
 *
 * Mounted from app.ts via {@link createStoryVideoRoutes}.
 */
import { Router } from 'express';
import type { EnvConfig } from '../../common/config/envConfig.js';
import path from 'path';
import fs from 'fs';
import multer from 'multer';
import { randomUUID } from 'crypto';
import mongoose from 'mongoose';
import { StoryVideoJob } from '../../common/db/models/StoryVideoJob.js';
import { uploadFileToS3IfAbsent, getPresignedGetUrl, getPresignedPutUrl, resolveUserUploadsBucket, } from '../../common/services/s3Storage.js';
import { queueStoryVideoJob } from '../queueStoryVideoJob.js';
import { runStoryRerenderJob } from '../pipeline.js';
import { parseStoryOptionsFromBody } from '../storyOptions.js';
import { normalizeIdempotencyKey } from '../idempotency.js';
import { parseS3Uri } from '../s3InputUri.js';
import { resolvePathUnderAssetsDir } from '../../common/config/paths.js';
function ensureUploadRoot(env) {
    const root = path.join(env.TEMP_DIR, 'story-uploads');
    if (!fs.existsSync(root))
        fs.mkdirSync(root, { recursive: true });
    return root;
}
function createUploadStorage(env) {
    const root = ensureUploadRoot(env);
    return multer.diskStorage({
        destination: (_req, _file, cb) => {
            cb(null, root);
        },
        filename: (_req, file, cb) => {
            const ext = path.extname(file.originalname) || '.bin';
            cb(null, `${randomUUID()}${ext}`);
        },
    });
}
function cleanupMulterFiles(files) {
    if (!files)
        return;
    for (const arr of Object.values(files)) {
        for (const f of arr || []) {
            try {
                if (f?.path && fs.existsSync(f.path))
                    fs.unlinkSync(f.path);
            }
            catch {
                /* ignore */
            }
        }
    }
}
function inferStoryUploadExt(kind, filename) {
    const fromName = path.extname(filename || '').toLowerCase();
    if (/^\.\w{1,8}$/.test(fromName)) {
        if (kind === 'video' && ['.mp4', '.mov', '.webm', '.mkv'].includes(fromName))
            return fromName;
        if (kind === 'image' && ['.png', '.jpg', '.jpeg', '.webp', '.gif'].includes(fromName))
            return fromName;
        if (kind !== 'video' && kind !== 'image' && ['.mp3', '.wav', '.m4a', '.aac', '.ogg', '.flac'].includes(fromName))
            return fromName;
    }
    if (kind === 'image')
        return '.png';
    return kind === 'video' ? '.mp4' : '.mp3';
}
function defaultContentTypeForExt(ext, kind) {
    /* kind: video | audio | image */
    const e = ext.toLowerCase();
    const map = {
        '.mp4': 'video/mp4',
        '.mov': 'video/quicktime',
        '.webm': 'video/webm',
        '.mkv': 'video/x-matroska',
        '.mp3': 'audio/mpeg',
        '.wav': 'audio/wav',
        '.m4a': 'audio/mp4',
        '.aac': 'audio/aac',
        '.ogg': 'audio/ogg',
        '.flac': 'audio/flac',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.webp': 'image/webp',
        '.gif': 'image/gif',
    };
    if (map[e])
        return map[e];
    if (kind === 'video')
        return 'video/mp4';
    if (kind === 'image')
        return 'image/png';
    return 'audio/mpeg';
}
/** Local `backend/assets/` paths — development only; production must use presigned URLs or s3:// URIs. */
function allowDevAssetInputs(env) {
    return env.NODE_ENV === 'development';
}
function storyProductionUsesRemoteUrlsOnly(env) {
    return env.NODE_ENV === 'production';
}
/**
 * Factory for the story-video Express router (auth middleware applied upstream).
 *
 * @param env — server env (TEMP_DIR, NODE_ENV for dev-asset and production URL rules)
 */
export function createStoryVideoRoutes(env) {
    const router = Router();
    const upload = multer({
        storage: createUploadStorage(env),
        limits: { fileSize: 4 * 1024 * 1024 * 1024 },
    });
    /** When S3 is not configured: browser uploads here; files are served from GET /user-media/:userId/:filename. */
    const userMediaUpload = multer({
        storage: multer.diskStorage({
            destination: (req, _file, cb) => {
                const uid = req.user.id;
                const dir = path.join(env.TEMP_DIR, 'story-user-media', uid);
                fs.mkdirSync(dir, { recursive: true });
                cb(null, dir);
            },
            filename: (_req, file, cb) => {
                const ext = path.extname(file.originalname || '').toLowerCase();
                const safe = /^\.\w{1,8}$/.test(ext) ? ext : '.bin';
                cb(null, `${randomUUID()}${safe}`);
            },
        }),
        limits: { fileSize: 4 * 1024 * 1024 * 1024 },
    });
    router.post('/create', upload.fields([
        { name: 'video', maxCount: 1 },
        { name: 'audio', maxCount: 1 },
        { name: 'bgm', maxCount: 1 },
    ]), async (req, res) => {
        const userId = req.user.id;
        const files = req.files;
        const body = req.body;
        const idemKey = normalizeIdempotencyKey(req.headers['idempotency-key'] ?? body.idempotencyKey);
        const maxAttempts = Math.max(1, parseInt(process.env.STORY_VIDEO_MAX_JOB_ATTEMPTS || '3', 10));
        try {
            if (idemKey) {
                const existing = await StoryVideoJob.findOne({ userId, idempotencyKey: idemKey }).lean();
                if (existing && ['pending', 'processing', 'completed'].includes(existing.status)) {
                    cleanupMulterFiles(files);
                    res.status(200).json({
                        success: true,
                        data: {
                            jobId: existing._id.toString(),
                            status: existing.status,
                            idempotentReplay: true,
                            options: existing.options,
                        },
                    });
                    return;
                }
            }
            const videoUrl = typeof body.videoUrl === 'string' ? body.videoUrl.trim() : '';
            const audioUrl = typeof body.audioUrl === 'string' ? body.audioUrl.trim() : '';
            const bgmSourceUrl = typeof body.bgmSourceUrl === 'string' ? body.bgmSourceUrl.trim() : '';
            const devVideoAsset = typeof body.devVideoAsset === 'string' ? body.devVideoAsset.trim() : '';
            const devAudioAsset = typeof body.devAudioAsset === 'string' ? body.devAudioAsset.trim() : '';
            const devBgmAsset = typeof body.devBgmAsset === 'string' ? body.devBgmAsset.trim() : '';
            const devAssetsAllowed = allowDevAssetInputs(env);
            const anyDevField = !!(devVideoAsset || devAudioAsset || devBgmAsset);
            if (anyDevField && !devAssetsAllowed) {
                cleanupMulterFiles(files);
                res.status(400).json({
                    success: false,
                    error: 'devVideoAsset/devAudioAsset/devBgmAsset are only allowed when NODE_ENV=development (use videoUrl/audioUrl/bgmSourceUrl in production)',
                });
                return;
            }
            const isHttpUrl = (s) => {
                try {
                    const u = new URL(s);
                    return u.protocol === 'http:' || u.protocol === 'https:';
                }
                catch {
                    return false;
                }
            };
            const extFromAssetUrl = (url, fallback) => {
                const s3 = parseS3Uri(url);
                if (s3) {
                    const base = s3.key.split('/').pop() || '';
                    const e = path.extname(base);
                    if (e && e.length <= 8)
                        return e;
                    return fallback;
                }
                try {
                    const e = path.extname(new URL(url).pathname);
                    if (e && e.length <= 8)
                        return e;
                }
                catch {
                    /* ignore */
                }
                return fallback;
            };
            for (const u of [videoUrl, audioUrl, bgmSourceUrl]) {
                if (u && !isHttpUrl(u) && !parseS3Uri(u)) {
                    cleanupMulterFiles(files);
                    res.status(400).json({
                        success: false,
                        error: 'Asset URLs must be https links or s3://bucket/key',
                    });
                    return;
                }
            }
            const videoFile = files?.video?.[0];
            const audioFile = files?.audio?.[0];
            const bgmFile = files?.bgm?.[0];
            const scriptText = typeof body.scriptText === 'string' ? body.scriptText.trim() : '';
            const options = parseStoryOptionsFromBody(body.options);
            if (storyProductionUsesRemoteUrlsOnly(env)) {
                if (videoFile?.path || audioFile?.path || bgmFile?.path) {
                    cleanupMulterFiles(files);
                    res.status(400).json({
                        success: false,
                        error: 'In production, upload media to S3 (or use s3:// URIs readable by this server), then pass presigned HTTPS GET URLs via videoUrl, audioUrl, and bgmSourceUrl. Direct multipart uploads to this API are not supported.',
                    });
                    return;
                }
            }
            if (videoUrl && videoFile?.path) {
                cleanupMulterFiles(files);
                res.status(400).json({ success: false, error: 'Provide either field video or videoUrl, not both' });
                return;
            }
            if (devVideoAsset && (videoUrl || videoFile?.path)) {
                cleanupMulterFiles(files);
                res.status(400).json({
                    success: false,
                    error: 'Provide either devVideoAsset or video / videoUrl, not both',
                });
                return;
            }
            if (!videoUrl && !videoFile?.path && !devVideoAsset) {
                res.status(400).json({
                    success: false,
                    error: 'Video file (field: video), videoUrl (https or s3://…), or devVideoAsset (dev) is required',
                });
                return;
            }
            if (audioUrl && audioFile?.path) {
                cleanupMulterFiles(files);
                res.status(400).json({ success: false, error: 'Provide either field audio or audioUrl, not both' });
                return;
            }
            if (devAudioAsset && (audioUrl || audioFile?.path)) {
                cleanupMulterFiles(files);
                res.status(400).json({
                    success: false,
                    error: 'Provide either devAudioAsset or audio / audioUrl, not both',
                });
                return;
            }
            if (bgmSourceUrl && bgmFile?.path) {
                cleanupMulterFiles(files);
                res.status(400).json({ success: false, error: 'Provide either field bgm or bgmSourceUrl, not both' });
                return;
            }
            if (devBgmAsset && (bgmSourceUrl || bgmFile?.path)) {
                cleanupMulterFiles(files);
                res.status(400).json({
                    success: false,
                    error: 'Provide either devBgmAsset or bgm / bgmSourceUrl, not both',
                });
                return;
            }
            if (!scriptText && !audioFile?.path && !audioUrl && !devAudioAsset) {
                res.status(400).json({
                    success: false,
                    error: 'Provide narration: script text (scriptText), and/or audio file (audio), and/or audioUrl (https or s3://…), and/or devAudioAsset (dev)',
                });
                return;
            }
            const id = new mongoose.Types.ObjectId();
            const jobId = id.toString();
            const workDir = path.join(env.TEMP_DIR, 'story-video', userId, jobId);
            fs.mkdirSync(workDir, { recursive: true });
            const { downloadHttpToFileOrLocalUserMedia } = await import('../downloadAsset.js');
            let videoDest = '';
            let audioDest = '';
            let bgmDest = '';
            try {
                if (devVideoAsset) {
                    const src = resolvePathUnderAssetsDir(devVideoAsset);
                    if (!src) {
                        throw new Error(`Invalid or missing devVideoAsset: ${devVideoAsset}`);
                    }
                    videoDest = path.join(workDir, `input${path.extname(src) || '.mp4'}`);
                    fs.copyFileSync(src, videoDest);
                }
                else if (videoUrl) {
                    videoDest = path.join(workDir, `input${extFromAssetUrl(videoUrl, '.mp4')}`);
                    await downloadHttpToFileOrLocalUserMedia(videoUrl, videoDest);
                }
                else {
                    videoDest = path.join(workDir, `input${path.extname(videoFile.filename) || '.mp4'}`);
                    fs.renameSync(videoFile.path, videoDest);
                }
                if (devAudioAsset) {
                    const src = resolvePathUnderAssetsDir(devAudioAsset);
                    if (!src) {
                        throw new Error(`Invalid or missing devAudioAsset: ${devAudioAsset}`);
                    }
                    audioDest = path.join(workDir, `narration${path.extname(src) || '.mp3'}`);
                    fs.copyFileSync(src, audioDest);
                }
                else if (audioUrl) {
                    audioDest = path.join(workDir, `narration${extFromAssetUrl(audioUrl, '.mp3')}`);
                    await downloadHttpToFileOrLocalUserMedia(audioUrl, audioDest);
                }
                else if (audioFile?.path) {
                    audioDest = path.join(workDir, `narration${path.extname(audioFile.filename) || '.mp3'}`);
                    fs.renameSync(audioFile.path, audioDest);
                }
                if (devBgmAsset) {
                    const src = resolvePathUnderAssetsDir(devBgmAsset);
                    if (!src) {
                        throw new Error(`Invalid or missing devBgmAsset: ${devBgmAsset}`);
                    }
                    bgmDest = path.join(workDir, `bgm${path.extname(src) || '.mp3'}`);
                    fs.copyFileSync(src, bgmDest);
                }
                else if (bgmSourceUrl) {
                    bgmDest = path.join(workDir, `bgm${extFromAssetUrl(bgmSourceUrl, '.mp3')}`);
                    await downloadHttpToFileOrLocalUserMedia(bgmSourceUrl, bgmDest);
                }
                else if (bgmFile?.path) {
                    bgmDest = path.join(workDir, `bgm${path.extname(bgmFile.filename) || '.mp3'}`);
                    fs.renameSync(bgmFile.path, bgmDest);
                }
            }
            catch (e) {
                try {
                    fs.rmSync(workDir, { recursive: true, force: true });
                }
                catch {
                    /* ignore */
                }
                cleanupMulterFiles(files);
                const msg = e instanceof Error ? e.message : String(e);
                res.status(400).json({ success: false, error: `Failed to prepare assets: ${msg}` });
                return;
            }
            const bucket = resolveUserUploadsBucket();
            let inputVideoUrl = '';
            let inputVideoKey = '';
            let inputAudioUrl = '';
            let inputAudioKey = '';
            let bgmKey = '';
            let jobBgmPresignedUrl = '';
            if (bucket) {
                inputVideoKey = `story-video/${userId}/${jobId}/input${path.extname(videoDest)}`;
                await uploadFileToS3IfAbsent(bucket, inputVideoKey, videoDest, defaultContentTypeForExt(path.extname(videoDest), 'video'));
                inputVideoUrl = await getPresignedGetUrl(bucket, inputVideoKey, 3600);
                if (audioDest) {
                    inputAudioKey = `story-video/${userId}/${jobId}/narration${path.extname(audioDest)}`;
                    const audioType = defaultContentTypeForExt(path.extname(audioDest), 'audio');
                    await uploadFileToS3IfAbsent(bucket, inputAudioKey, audioDest, audioType);
                    inputAudioUrl = await getPresignedGetUrl(bucket, inputAudioKey, 3600);
                }
                if (bgmDest) {
                    bgmKey = `story-video/${userId}/${jobId}/bgm${path.extname(bgmDest)}`;
                    await uploadFileToS3IfAbsent(bucket, bgmKey, bgmDest, 'audio/mpeg');
                    jobBgmPresignedUrl = await getPresignedGetUrl(bucket, bgmKey, 3600);
                }
            }
            const createPayload = {
                _id: id,
                userId,
                idempotencyKey: idemKey || '',
                attempts: 0,
                maxAttempts,
                status: 'pending',
                stage: 'queued',
                progressMessage: 'Queued',
                progressPercent: 0,
                cancelRequested: false,
                inputVideoUrl,
                inputVideoKey,
                inputVideoLocalPath: videoDest,
                inputAudioUrl,
                inputAudioKey,
                inputAudioLocalPath: audioDest,
                scriptText,
                bgmLocalPath: bgmDest,
                bgmKey,
                bgmUrl: jobBgmPresignedUrl,
                options: options,
                timeline: { clips: [] },
                s3Bucket: bucket || '',
                events: [{ at: new Date(), stage: 'queued', message: 'Job created' }],
            };
            let doc;
            try {
                doc = await StoryVideoJob.create(createPayload);
            }
            catch (e) {
                const code = e?.code;
                if (code === 11000 && idemKey) {
                    try {
                        fs.rmSync(workDir, { recursive: true, force: true });
                    }
                    catch {
                        /* ignore */
                    }
                    const dup = await StoryVideoJob.findOne({ userId, idempotencyKey: idemKey }).lean();
                    if (dup) {
                        res.status(200).json({
                            success: true,
                            data: {
                                jobId: dup._id.toString(),
                                status: dup.status,
                                idempotentReplay: true,
                                options: dup.options,
                            },
                        });
                        return;
                    }
                }
                throw e;
            }
            void queueStoryVideoJob(doc._id.toString());
            res.status(201).json({
                success: true,
                data: {
                    jobId: doc._id.toString(),
                    status: doc.status,
                    options,
                },
            });
        }
        catch (e) {
            res.status(500).json({ success: false, error: e instanceof Error ? e.message : String(e) });
        }
    });
    /**
     * Presigned PUT + GET for direct browser upload to the user-uploads bucket (user-uploads/{userId}/...).
     * Client: PUT file bytes to putUrl with Content-Type, then pass getUrl to POST /create as videoUrl/audioUrl/bgmSourceUrl.
     */
    router.post('/presign-upload', async (req, res) => {
        try {
            const userId = req.user.id;
            const bucket = resolveUserUploadsBucket();
            if (!bucket) {
                res.status(503).json({
                    success: false,
                    error: 'Set S3_USER_UPLOADS_BUCKET or S3_OUTPUT_BUCKET to enable S3 uploads',
                    hint: 'Without S3, the app uses POST /api/story-video/upload-user-media (multipart); the editor switches automatically.',
                });
                return;
            }
            const { kind, filename, contentType } = req.body;
            const k = (kind || '').toLowerCase();
            if (!['video', 'audio', 'bgm', 'image'].includes(k)) {
                res.status(400).json({ success: false, error: 'kind must be video, audio, bgm, or image' });
                return;
            }
            const ext = inferStoryUploadExt(k === 'bgm' ? 'audio' : k, filename);
            const ct = (contentType || '').trim() ||
                defaultContentTypeForExt(ext, k === 'video' ? 'video' : k === 'image' ? 'image' : 'audio');
            const key = `user-uploads/${userId}/${randomUUID()}${ext}`;
            const expiresIn = 3600;
            const putUrl = await getPresignedPutUrl(bucket, key, ct, expiresIn);
            const getUrl = await getPresignedGetUrl(bucket, key, expiresIn);
            res.json({
                success: true,
                data: {
                    putUrl,
                    getUrl,
                    bucket,
                    key,
                    contentType: ct,
                    expiresIn,
                },
            });
        }
        catch (e) {
            res.status(500).json({ success: false, error: e instanceof Error ? e.message : String(e) });
        }
    });
    /**
     * Local-dev / no-S3: multipart upload (`file` + `kind`). Returns an API path; use with ?token= like other media.
     */
    router.post('/upload-user-media', (_req, res, next) => {
        if (resolveUserUploadsBucket()) {
            res.status(400).json({
                success: false,
                error: 'S3 is configured — use presign-upload and PUT to the presigned URL.',
            });
            return;
        }
        next();
    }, userMediaUpload.single('file'), async (req, res) => {
        try {
            const userId = req.user.id;
            if (!req.file?.path) {
                res.status(400).json({ success: false, error: 'Missing file field' });
                return;
            }
            const kind = String(req.body.kind || '').toLowerCase();
            if (!['video', 'audio', 'bgm', 'image'].includes(kind)) {
                try {
                    fs.unlinkSync(req.file.path);
                }
                catch {
                    /* ignore */
                }
                res.status(400).json({ success: false, error: 'kind must be video, audio, bgm, or image' });
                return;
            }
            const ext = path.extname(req.file.filename).toLowerCase();
            const ct = req.file.mimetype ||
                defaultContentTypeForExt(ext, kind === 'video' ? 'video' : kind === 'image' ? 'image' : 'audio');
            res.json({
                success: true,
                data: {
                    path: `/api/story-video/user-media/${userId}/${req.file.filename}`,
                    contentType: ct,
                },
            });
        }
        catch (e) {
            res.status(500).json({ success: false, error: e instanceof Error ? e.message : String(e) });
        }
    });
    router.get('/user-media/:userId/:filename', async (req, res) => {
        try {
            if (req.user.id !== req.params.userId) {
                res.status(403).json({ success: false, error: 'Forbidden' });
                return;
            }
            const filename = path.basename(req.params.filename);
            if (!/^[a-f0-9-]{36}\.[a-z0-9]{1,8}$/i.test(filename)) {
                res.status(400).json({ success: false, error: 'Invalid filename' });
                return;
            }
            const base = path.resolve(path.join(env.TEMP_DIR, 'story-user-media', req.params.userId));
            const filePath = path.resolve(path.join(base, filename));
            if (!filePath.startsWith(base + path.sep)) {
                res.status(400).json({ success: false, error: 'Invalid path' });
                return;
            }
            if (!fs.existsSync(filePath)) {
                res.status(404).json({ success: false, error: 'Not found' });
                return;
            }
            const ext = path.extname(filename).toLowerCase();
            const isImg = ['.png', '.jpg', '.jpeg', '.webp', '.gif'].includes(ext);
            const kind = isImg
                ? 'image'
                : ['.mp4', '.mov', '.webm', '.mkv'].includes(ext)
                    ? 'video'
                    : 'audio';
            res.setHeader('Content-Type', defaultContentTypeForExt(ext, kind));
            res.sendFile(filePath);
        }
        catch (e) {
            res.status(500).json({ success: false, error: e instanceof Error ? e.message : String(e) });
        }
    });
    /** List recent story-video jobs for the current user (dashboard / library). */
    router.get('/jobs', async (req, res) => {
        try {
            const userId = req.user.id;
            const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit || '50'), 10) || 50));
            const jobs = await StoryVideoJob.find({ userId })
                .sort({ updatedAt: -1 })
                .limit(limit)
                .select('_id status stage progressMessage progressPercent error createdAt updatedAt scriptText')
                .lean();
            const data = jobs.map((j) => {
                const st = (j.scriptText || '').trim().replace(/\s+/g, ' ');
                const scriptPreview = st.length > 160 ? `${st.slice(0, 160)}…` : st;
                return {
                    jobId: j._id.toString(),
                    status: j.status,
                    stage: j.stage,
                    progressMessage: j.progressMessage || '',
                    progressPercent: j.progressPercent ?? 0,
                    error: j.error || '',
                    createdAt: j.createdAt,
                    updatedAt: j.updatedAt,
                    scriptPreview,
                };
            });
            res.json({ success: true, data });
        }
        catch (e) {
            res.status(500).json({ success: false, error: e instanceof Error ? e.message : String(e) });
        }
    });
    router.post('/:jobId/cancel', async (req, res) => {
        try {
            const userId = req.user.id;
            const job = await StoryVideoJob.findOneAndUpdate({ _id: req.params.jobId, userId, status: { $in: ['pending', 'processing'] } }, {
                $set: {
                    cancelRequested: true,
                    progressMessage: 'Cancellation requested…',
                },
                $push: { events: { at: new Date(), stage: 'cancel', message: 'Cancellation requested' } },
            }, { new: true });
            if (!job) {
                res.status(404).json({ success: false, error: 'Job not found or not cancellable' });
                return;
            }
            res.json({ success: true });
        }
        catch (e) {
            res.status(500).json({ success: false, error: e instanceof Error ? e.message : String(e) });
        }
    });
    router.post('/:jobId/retry', async (req, res) => {
        try {
            const userId = req.user.id;
            const job = await StoryVideoJob.findOne({
                _id: req.params.jobId,
                userId,
                status: { $in: ['failed', 'cancelled'] },
            });
            if (!job) {
                res.status(404).json({ success: false, error: 'Job not found or not eligible for retry' });
                return;
            }
            job.attempts = 0;
            job.cancelRequested = false;
            job.status = 'pending';
            job.stage = 'queued';
            job.error = '';
            job.progressMessage = 'Queued for retry';
            job.progressPercent = 0;
            const ev = [...(job.events || []), { at: new Date(), stage: 'retry', message: 'Manual retry' }];
            job.events = ev.slice(-300);
            await job.save();
            void queueStoryVideoJob(job._id.toString());
            res.json({ success: true });
        }
        catch (e) {
            res.status(500).json({ success: false, error: e instanceof Error ? e.message : String(e) });
        }
    });
    router.get('/:jobId/status', async (req, res) => {
        try {
            const userId = req.user.id;
            const job = await StoryVideoJob.findOne({ _id: req.params.jobId, userId }).lean();
            if (!job) {
                res.status(404).json({ success: false, error: 'Job not found' });
                return;
            }
            res.json({
                success: true,
                data: {
                    jobId: job._id.toString(),
                    status: job.status,
                    stage: job.stage,
                    progressMessage: job.progressMessage,
                    progressPercent: job.progressPercent ?? 0,
                    cancelRequested: !!job.cancelRequested,
                    error: job.error || '',
                    attempts: job.attempts ?? 0,
                    maxAttempts: job.maxAttempts && job.maxAttempts > 0
                        ? job.maxAttempts
                        : Math.max(1, parseInt(process.env.STORY_VIDEO_MAX_JOB_ATTEMPTS || '3', 10)),
                    createdAt: job.createdAt,
                    updatedAt: job.updatedAt,
                },
            });
        }
        catch (e) {
            res.status(500).json({ success: false, error: e instanceof Error ? e.message : String(e) });
        }
    });
    router.get('/:jobId/result', async (req, res) => {
        try {
            const userId = req.user.id;
            const job = await StoryVideoJob.findOne({ _id: req.params.jobId, userId }).lean();
            if (!job) {
                res.status(404).json({ success: false, error: 'Job not found' });
                return;
            }
            let outputVideoUrl = job.outputVideoUrl || '';
            if (job.status === 'completed' && job.s3Bucket && job.outputVideoKey) {
                outputVideoUrl = await getPresignedGetUrl(job.s3Bucket, job.outputVideoKey, 86400);
            }
            let outputSrtUrl = '';
            if (job.status === 'completed' && job.s3Bucket && job.outputSrtKey) {
                outputSrtUrl = await getPresignedGetUrl(job.s3Bucket, job.outputSrtKey, 86400);
            }
            let scenes = [];
            const inter = job.intermediate;
            const scenesPath = inter?.scenesJson;
            if (scenesPath && fs.existsSync(scenesPath)) {
                try {
                    scenes = JSON.parse(fs.readFileSync(scenesPath, 'utf8'));
                }
                catch {
                    scenes = [];
                }
            }
            res.json({
                success: true,
                data: {
                    jobId: job._id.toString(),
                    status: job.status,
                    timeline: job.timeline,
                    outputVideoUrl,
                    outputSrtUrl,
                    scenes,
                    options: job.options,
                    error: job.error || '',
                    detectedLanguages: {
                        video: inter?.detectedVideoLanguage,
                        narration: inter?.detectedNarrationLanguage,
                    },
                },
            });
        }
        catch (e) {
            res.status(500).json({ success: false, error: e instanceof Error ? e.message : String(e) });
        }
    });
    /** JSON playback URL for <video src> (presigned S3 or same-origin file route). */
    router.get('/:jobId/play', async (req, res) => {
        try {
            res.setHeader('Cache-Control', 'no-store');
            const userId = req.user.id;
            const job = await StoryVideoJob.findOne({ _id: req.params.jobId, userId }).lean();
            if (!job || job.status !== 'completed') {
                res.status(404).json({ success: false, error: 'Export not ready' });
                return;
            }
            if (job.s3Bucket && job.outputVideoKey) {
                const url = await getPresignedGetUrl(job.s3Bucket, job.outputVideoKey, 86400);
                res.json({ success: true, url });
                return;
            }
            res.json({ success: true, url: `/api/story-video/files/${req.params.jobId}/output.mp4` });
        }
        catch (e) {
            res.status(500).json({ success: false, error: e instanceof Error ? e.message : String(e) });
        }
    });
    router.get('/:jobId/subtitles.srt', async (req, res) => {
        try {
            const userId = req.user.id;
            const job = await StoryVideoJob.findOne({ _id: req.params.jobId, userId }).lean();
            if (!job) {
                res.status(404).json({ success: false, error: 'Job not found' });
                return;
            }
            const inter = job.intermediate;
            const srtPath = inter?.finalSrtPath ||
                path.join(env.TEMP_DIR, 'story-video', userId, req.params.jobId, 'output.srt');
            if (!fs.existsSync(srtPath)) {
                res.status(404).json({ success: false, error: 'Subtitles not available yet' });
                return;
            }
            res.setHeader('Content-Type', 'application/x-subrip; charset=utf-8');
            res.setHeader('Content-Disposition', `attachment; filename="story-${req.params.jobId}.srt"`);
            res.sendFile(path.resolve(srtPath));
        }
        catch (e) {
            res.status(500).json({ success: false, error: e instanceof Error ? e.message : String(e) });
        }
    });
    router.post('/:jobId/edit', async (req, res) => {
        try {
            const userId = req.user.id;
            const job = await StoryVideoJob.findOne({ _id: req.params.jobId, userId });
            if (!job) {
                res.status(404).json({ success: false, error: 'Job not found' });
                return;
            }
            const { timeline, render } = req.body;
            if (timeline && typeof timeline === 'object') {
                const next = { ...(job.timeline || { clips: [] }) };
                if (Array.isArray(timeline.clips)) {
                    next.clips = timeline.clips;
                }
                if (Array.isArray(timeline.imageLibrary)) {
                    next.imageLibrary = timeline.imageLibrary;
                }
                job.timeline = next;
                await job.save();
            }
            if (render) {
                if (job.status === 'processing' && job.stage === 're_render') {
                    res.status(409).json({ success: false, error: 'Re-render already in progress' });
                    return;
                }
                if (job.status !== 'completed') {
                    res.status(400).json({
                        success: false,
                        error: 'Job must be completed before re-render (wait for the initial pipeline to finish)',
                    });
                    return;
                }
                job.status = 'processing';
                job.stage = 're_render';
                job.progressPercent = 0;
                job.progressMessage = 'Queued re-render…';
                job.error = '';
                job.cancelRequested = false;
                const ev = [...(job.events || []), { at: new Date(), stage: 're_render', message: 'Queued re-render' }];
                job.events = ev.slice(-300);
                await job.save();
                void runStoryRerenderJob(job._id.toString());
                res.json({
                    success: true,
                    data: {
                        timeline: job.timeline,
                        outputVideoUrl: '',
                        outputSrtUrl: '',
                        asyncRerender: true,
                        status: 'processing',
                    },
                });
                return;
            }
            const fresh = await StoryVideoJob.findById(job._id);
            let outputVideoUrl = fresh?.outputVideoUrl ?? job.outputVideoUrl ?? '';
            if (fresh?.s3Bucket && fresh?.outputVideoKey) {
                outputVideoUrl = await getPresignedGetUrl(fresh.s3Bucket, fresh.outputVideoKey, 86400);
            }
            let outputSrtUrl = '';
            if (fresh?.s3Bucket && fresh?.outputSrtKey) {
                outputSrtUrl = await getPresignedGetUrl(fresh.s3Bucket, fresh.outputSrtKey, 86400);
            }
            res.json({
                success: true,
                data: {
                    timeline: fresh?.timeline ?? job.timeline,
                    outputVideoUrl,
                    outputSrtUrl,
                },
            });
        }
        catch (e) {
            res.status(500).json({ success: false, error: e instanceof Error ? e.message : String(e) });
        }
    });
    /** Original uploaded video (local path only) — for source monitor / crop UI. */
    router.get('/files/:jobId/original', async (req, res) => {
        try {
            const userId = req.user.id;
            const job = await StoryVideoJob.findOne({ _id: req.params.jobId, userId }).lean();
            if (!job) {
                res.status(404).json({ success: false, error: 'Job not found' });
                return;
            }
            const p = job.inputVideoLocalPath;
            if (!p || !fs.existsSync(p)) {
                res.status(404).json({
                    success: false,
                    error: 'Original file not available on this server (S3-only upload)',
                });
                return;
            }
            const ext = path.extname(p).toLowerCase();
            const contentType = ext === '.webm'
                ? 'video/webm'
                : ext === '.mkv'
                    ? 'video/x-matroska'
                    : ext === '.mov'
                        ? 'video/quicktime'
                        : 'video/mp4';
            res.setHeader('Content-Type', contentType);
            res.setHeader('Cache-Control', 'no-store');
            res.sendFile(path.resolve(p));
        }
        catch (e) {
            res.status(500).json({ success: false, error: e instanceof Error ? e.message : String(e) });
        }
    });
    router.get('/files/:jobId/output.mp4', async (req, res) => {
        try {
            const userId = req.user.id;
            const job = await StoryVideoJob.findOne({ _id: req.params.jobId, userId }).lean();
            if (!job) {
                res.status(404).json({ success: false, error: 'Job not found' });
                return;
            }
            const inter = job.intermediate;
            const finalPath = inter?.finalPath ||
                path.join(env.TEMP_DIR, 'story-video', userId, req.params.jobId, 'final_export.mp4');
            if (!fs.existsSync(finalPath)) {
                const fallback = path.join(env.TEMP_DIR, 'story-video', userId, req.params.jobId, 'story_output.mp4');
                if (!fs.existsSync(fallback)) {
                    res.status(404).json({ success: false, error: 'Output not available on disk (use S3 URL)' });
                    return;
                }
                res.setHeader('Content-Type', 'video/mp4');
                res.setHeader('Cache-Control', 'no-store');
                res.sendFile(path.resolve(fallback));
                return;
            }
            res.setHeader('Content-Type', 'video/mp4');
            res.setHeader('Cache-Control', 'no-store');
            res.sendFile(path.resolve(finalPath));
        }
        catch (e) {
            res.status(500).json({ success: false, error: e instanceof Error ? e.message : String(e) });
        }
    });
    return router;
}
//# sourceMappingURL=storyVideoRoutes.js.map