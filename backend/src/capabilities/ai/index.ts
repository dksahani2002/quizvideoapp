export { createOpenAIClient } from './client.js';
export type { WhisperSegment, TranscribeVerboseResult } from './types.js';
export { transcribeAudioVerbose, parseStoredVideoWhisper } from './whisper.js';
export { embedTexts, cosineSimilarity } from './embeddings.js';
export { extractJsonArray } from './jsonExtract.js';
