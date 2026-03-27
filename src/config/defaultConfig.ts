/**
 * Default render configuration
 */

import { RenderConfig } from '../types/index.js';
import path from 'path';

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
    fontFile: path.join(process.cwd(), 'assets', 'fonts', 'Montserrat-Bold.ttf'),
    
    // TTS
    ttsProvider: 'openai',
    ttsVoice: 'alloy',
    ttsModel: 'tts-1',
    
    // Concurrency
    maxConcurrentSegments: 3,
    
    // Paths
    tempDir: path.join(process.cwd(), 'temp'),
    outputDir: path.join(process.cwd(), 'output'),
    cacheDir: path.join(process.cwd(), 'cache', 'tts'),
    
    // Background music & SFX
    bgmFile: path.join(process.cwd(), 'assets', 'audio', 'bgm.mp3'),
    sfxTickFile: path.join(process.cwd(), 'assets', 'audio', 'tick.mp3'),
    sfxDingFile: path.join(process.cwd(), 'assets', 'audio', 'ding.mp3'),
    sfxCountdownTickFile: path.join(process.cwd(), 'assets', 'audio', 'countdown_tick.mp3'),
    bgmVolume: 0.12,

    // Post-processing
    maxTotalDuration: 60, // 60 seconds
    speedUpIfExceeds: true,
  };
}
