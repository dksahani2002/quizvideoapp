import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

/** Extract mono 16 kHz PCM WAV from video or audio (Whisper / scene-detect input). */
export async function extractAudioWav16kMono(inputVideoOrAudio: string, outWav: string): Promise<void> {
  const cmd = [
    'ffmpeg',
    '-y',
    `-i "${inputVideoOrAudio}"`,
    '-vn',
    '-ac',
    '1',
    '-ar',
    '16000',
    '-c:a',
    'pcm_s16le',
    `"${outWav}"`,
  ].join(' ');
  await execAsync(cmd);
}

/** Concatenate MP3 files into one output (delegates to common `concatAudio`). */
export async function concatAudioFilesMp3(inputFiles: string[], outputMp3: string): Promise<void> {
  const { concatAudio } = await import('../../common/utils/ffmpeg.js');
  await concatAudio(inputFiles, outputMp3);
}
