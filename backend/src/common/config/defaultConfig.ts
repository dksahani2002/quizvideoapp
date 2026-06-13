/**
 * Default render configuration
 */

import { RenderConfig } from '../types/index.js';
import path from 'path';

import { BACKEND_ROOT } from './paths.js';

export function getDefaultConfig(): RenderConfig {
  return {
    // Video specs
    width: 1080,
    height: 1920,
    fps: 30,
    codec: 'libx264',
    
    // Audio specs
    sampleRate: 44100,
    channels: 2,
    loudnessTarget: -23, // EBU R128
    
    // Timing
    safetyPadding: 0.2, // 200ms
    minSegmentDuration: 1.2, // Minimum 1.2 seconds
    maxAnimationTime: 2.0, // Max animation duration
    
    // Text rendering
    maxLineLength: 100,
    safeMargin: {
      top: 5,
      bottom: 5,
      left: 5,
      right: 5,
    },
    fontFile: path.join(BACKEND_ROOT, 'assets', 'fonts', 'Montserrat-Bold.ttf'),
    
    // TTS
    ttsProvider: 'openai',
    ttsVoice: 'alloy',
    ttsModel: 'tts-1',
    
    // Concurrency
    maxConcurrentSegments: 3,
    
    // Paths
    tempDir: path.join(BACKEND_ROOT, 'temp'),
    outputDir: path.join(BACKEND_ROOT, 'output'),
    cacheDir: path.join(BACKEND_ROOT, 'cache', 'tts'),
    
    // Background music & SFX
    bgmFile: path.join(BACKEND_ROOT, 'assets', 'audio', 'bgm.mp3'),
    sfxTickFile: path.join(BACKEND_ROOT, 'assets', 'audio', 'tick.mp3'),
    sfxDingFile: path.join(BACKEND_ROOT, 'assets', 'audio', 'ding.mp3'),
    sfxCountdownTickFile: path.join(BACKEND_ROOT, 'assets', 'audio', 'countdown_tick.mp3'),
    bgmVolume: 0.12,

    // Post-processing
    maxTotalDuration: 60, // 60 seconds
    speedUpIfExceeds: true,

    // Captions (sidecars by default; burn-in optional)
    captions: { enabled: true, burnIn: false },

    // Watermark (optional)
    watermark: { imagePath: '', opacity: 0.75, position: 'top-right' },
  };
}
