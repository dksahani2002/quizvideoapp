/**
 * FFmpeg command generation and execution utilities
 * All commands follow the zero-drift architecture principles
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { wrapText } from './textSanitizer.js';
import path from 'path';
import fs from 'fs/promises';

const execAsync = promisify(exec);

/**
 * FFmpeg -filter_complex treats commas as filter-chain separators.
 * Commas inside drawtext expressions (e.g. between(t,a,b), if(...)) must be escaped as \,
 */
function escapeCommasInFilterExpr(expr: string): string {
  return expr.replace(/,/g, '\\,');
}

/**
 * Extract exact duration from audio/video file using FFprobe
 * This is the SINGLE SOURCE OF TRUTH for timing
 */
export async function extractDuration(filePath: string): Promise<number> {
  try {
    const command = `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${filePath}"`;
    const { stdout } = await execAsync(command);
    const duration = parseFloat(stdout.trim());
    
    if (isNaN(duration) || duration <= 0) {
      throw new Error(`Invalid duration extracted: ${duration}`);
    }
    
    return duration;
  } catch (error: any) {
    throw new Error(`Failed to extract duration from ${filePath}: ${error.message}`);
  }
}

/**
 * Stream duration in seconds from ffprobe (may differ from container format duration when A/V drift).
 */
export async function extractStreamDuration(
  filePath: string,
  stream: 'a:0' | 'v:0'
): Promise<number | null> {
  try {
    const command = `ffprobe -v error -select_streams ${stream} -show_entries stream=duration -of default=noprint_wrappers=1:nokey=1 "${filePath}"`;
    const { stdout } = await execAsync(command);
    const line = stdout.trim();
    if (!line || line === 'N/A') return null;
    const duration = parseFloat(line);
    if (isNaN(duration) || duration <= 0) return null;
    return duration;
  } catch {
    return null;
  }
}

/**
 * After concat demuxer (-c copy), video and audio can have different total lengths.
 * Trim the output to the audio stream duration (video re-encoded; audio copied).
 */
export async function trimFinalVideoToAudioMaster(outputPath: string): Promise<void> {
  const audioDur = await extractStreamDuration(outputPath, 'a:0');
  if (audioDur === null) {
    console.warn('⚠️  No audio stream or duration; skip A/V length fix');
    return;
  }

  const videoDur = await extractStreamDuration(outputPath, 'v:0');
  if (videoDur !== null && Math.abs(videoDur - audioDur) < 0.05) {
    return;
  }
  if (videoDur !== null && videoDur < audioDur) {
    console.warn(
      '⚠️  Video stream shorter than audio; skipping automatic trim (unexpected layout)'
    );
    return;
  }

  const tmp = outputPath.replace(/\.mp4$/i, '_avsync_tmp.mp4');
  const t = audioDur.toFixed(6);
  const command = [
    'ffmpeg',
    '-y',
    `-i "${outputPath}"`,
    `-t ${t}`,
    '-c:v',
    'libx264',
    '-crf',
    '22',
    '-preset',
    'medium',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'copy',
    '-movflags',
    '+faststart',
    `"${tmp}"`,
  ].join(' ');

  try {
    await execAsync(command);
    await fs.rename(tmp, outputPath);
    console.log(
      `✂️  Trimmed final video to audio length (~${audioDur.toFixed(2)}s; was ~${videoDur?.toFixed(2) ?? '?'}s video)`
    );
  } catch (err: any) {
    await fs.unlink(tmp).catch(() => {});
    throw new Error(`Final A/V trim failed: ${err?.message || err}`);
  }
}

/**
 * Concatenate audio segments with a single deterministic encode.
 * No dynaudnorm / loudnorm — those can shift energy and misalign phase boundaries
 * vs ffprobe durations on the raw clips, which breaks video↔voice sync.
 */
export async function concatAudio(
  inputFiles: string[],
  outputFile: string,
  sampleRate: number = 44100,
  channels: number = 2,
  _loudnessTarget: number = -23
): Promise<void> {
  const concatListFile = outputFile.replace(/\.[^.]+$/, '_concat.txt');
  const concatList = inputFiles.map(file => `file '${path.resolve(file)}'`).join('\n');
  await fs.writeFile(concatListFile, concatList);

  const command = [
    'ffmpeg',
    '-f concat',
    '-safe 0',
    `-i "${concatListFile}"`,
    `-ar ${sampleRate}`,
    `-ac ${channels}`,
    '-c:a libmp3lame',
    '-q:a',
    '3',
    '-y',
    `"${outputFile}"`
  ].join(' ');

  try {
    await execAsync(command);
    await fs.unlink(concatListFile).catch(() => {});
  } catch (error: any) {
    await fs.unlink(concatListFile).catch(() => {});
    throw new Error(`Audio concatenation failed: ${error.message}`);
  }
}

/**
 * Approximate character width for a monospaced-like Latin font.
 * Helvetica averages about 0.52 × fontSize for uppercase/mixed text.
 */
function charsPerLine(usableWidth: number, fontSize: number): number {
  const avgCharWidth = fontSize * 0.52;
  return Math.floor(usableWidth / avgCharWidth);
}

/**
 * Compute an adaptive layout so header + question + 4 options + countdown
 * all fit within the 1080×1920 safe area without clipping.
 *
 * The layout reserves:
 *   top 80px             → header bar ("QUIZ")
 *   gap 30px             → spacing below header
 *   next region          → question card (variable height)
 *   gap                  → 50px between question and options
 *   next region          → 4 option cards (variable height, adaptive spacing)
 *   bottom 180px         → countdown area
 *
 * The content block (question + options) is vertically centered in the
 * available space so short quizzes don't look top-heavy.
 *
 * If the content is too tall, font sizes and spacing are scaled down.
 */
function computeLayout(
  width: number,
  height: number,
  safeMargin: { top: number; bottom: number; left: number; right: number },
  questionText: string,
  optionTexts: [string, string, string, string],
  density: number = 1,
) {
  const d = Math.min(1.25, Math.max(0.75, density));
  const hPad = 60;
  const usable = width - hPad * 2;

  const headerHeight = 80;
  const headerGap = 30;
  const topReserved = headerHeight + headerGap;
  const qOptGap = 50;
  const countdownReserved = 180;
  const availableHeight = height - topReserved - safeMargin.top - countdownReserved - safeMargin.bottom;

  let qFontSize = Math.round(46 * d);
  let oFontSize = Math.round(34 * d);
  let qLineH = Math.round(58 * d);
  let oLineH = Math.round(44 * d);
  let optGap = Math.round(32 * d);

  const measure = () => {
    const qLines = wrapText(questionText, charsPerLine(usable, qFontSize));
    const oLines = optionTexts.map(t => wrapText(t, charsPerLine(usable - 80, oFontSize)));
    const qHeight = qLines.length * qLineH;
    const oHeight = oLines.reduce((sum, lines) => sum + lines.length * oLineH, 0) + optGap * 3;
    return { qLines, oLines, total: qHeight + qOptGap + oHeight };
  };

  let m = measure();

  const scales = [0.92, 0.84, 0.76, 0.70];
  for (const s of scales) {
    if (m.total <= availableHeight) break;
    qFontSize = Math.round(46 * d * s);
    oFontSize = Math.round(34 * d * s);
    qLineH = Math.round(58 * d * s);
    oLineH = Math.round(44 * d * s);
    optGap = Math.round(32 * d * s);
    m = measure();
  }

  // Bias content toward the upper portion (30% of remaining space above, 70% below)
  const verticalOffset = Math.max(0, Math.round((availableHeight - m.total) * 0.3));
  const contentTop = safeMargin.top + topReserved + verticalOffset;

  const questionYStart = contentTop;
  const optionYStart = questionYStart + m.qLines.length * qLineH + qOptGap;
  const countdownY = height - safeMargin.bottom - 140;

  // Header position
  const headerY = safeMargin.top + 20;

  return {
    usable,
    hPad,
    qFontSize,
    oFontSize,
    qLineH,
    oLineH,
    optGap,
    questionLines: m.qLines,
    optionLines: m.oLines,
    questionYStart,
    optionYStart,
    countdownY,
    headerY,
    headerHeight,
  };
}

// ────────────────────────────────────────────────────────────────
// Escape drawtext special characters
// ────────────────────────────────────────────────────────────────
function escapeDrawtext(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/:/g, '\\:')
    // Commas are treated as filter separators in filter_complex; inside drawtext they must be escaped.
    .replace(/,/g, '\\,')
    // Single quotes are brittle inside drawtext text='...'; normalize to typographic apostrophe.
    .replace(/'/g, '’')
    .replace(/"/g, '\\"')
    .replace(/%/g, '\\%')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]')
    // Normalize newlines for drawtext.
    .replace(/\r\n|\r|\n/g, '\\n');
}

/**
 * Build a smooth multi-stop gradient background using thin horizontal strips,
 * plus subtle accent elements. Shared by quiz segments, intro, and outro.
 *
 * Color stops (top → bottom):
 *   #0B0A1A → #1A1545 → #2D1B69 → #1E1145 → #0D0B1E
 *
 * Returns { filters, outputLabel } where outputLabel is the stream label to
 * chain further filters from.
 */
function parseHexColor(hex: string): { r: number; g: number; b: number } {
  const clean = hex.replace(/^[#0x]+/, '');
  return {
    r: parseInt(clean.substring(0, 2), 16) || 0,
    g: parseInt(clean.substring(2, 4), 16) || 0,
    b: parseInt(clean.substring(4, 6), 16) || 0,
  };
}

function buildGradientFilters(
  width: number,
  height: number,
  duration: number,
  opts?: {
    showAccent?: boolean;
    accentLineY?: number;
    glowCenterY?: number;
    glowHeight?: number;
    customColorStops?: Array<{ pos: number; color: string }>;
    backgroundImage?: string;
    backgroundOpacity?: number;
  }
): { filters: string[]; outputLabel: string } {
  const filters: string[] = [];

  const defaultStops: Array<{ pos: number; r: number; g: number; b: number }> = [
    { pos: 0.00, r: 0x0B, g: 0x0A, b: 0x1A },
    { pos: 0.25, r: 0x1A, g: 0x15, b: 0x45 },
    { pos: 0.45, r: 0x2D, g: 0x1B, b: 0x69 },
    { pos: 0.70, r: 0x1E, g: 0x11, b: 0x45 },
    { pos: 1.00, r: 0x0D, g: 0x0B, b: 0x1E },
  ];

  const colorStops = (opts?.customColorStops && opts.customColorStops.length >= 2)
    ? opts.customColorStops.map(s => ({ pos: s.pos, ...parseHexColor(s.color) }))
    : defaultStops;

  const bgColor = `0x${colorStops[0].r.toString(16).padStart(2, '0')}${colorStops[0].g.toString(16).padStart(2, '0')}${colorStops[0].b.toString(16).padStart(2, '0')}`;
  filters.push(`color=c=${bgColor}:s=${width}x${height}:d=${duration}[base]`);

  const STRIPS = 60;
  const stripH = Math.ceil(height / STRIPS);
  let prevLabel = 'base';

  for (let i = 0; i < STRIPS; i++) {
    const t = (i + 0.5) / STRIPS;
    let segIdx = 0;
    for (let s = 1; s < colorStops.length; s++) {
      if (t <= colorStops[s].pos) { segIdx = s - 1; break; }
    }
    const s0 = colorStops[segIdx];
    const s1 = colorStops[segIdx + 1];
    const localT = (t - s0.pos) / (s1.pos - s0.pos);

    const r = Math.round(s0.r + (s1.r - s0.r) * localT);
    const g = Math.round(s0.g + (s1.g - s0.g) * localT);
    const b = Math.round(s0.b + (s1.b - s0.b) * localT);
    const hex = `0x${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;

    const y = i * stripH;
    const label = `gs${i}`;
    filters.push(
      `[${prevLabel}]drawbox=x=0:y=${y}:w=${width}:h=${stripH + 1}:color=${hex}:t=fill[${label}]`
    );
    prevLabel = label;
  }

  // Accent line below header area (only for quiz segments with a header)
  if (opts?.showAccent !== false) {
    const accentY = opts?.accentLineY ?? Math.round(height * 0.06);
    const accentLabel = 'accent';
    filters.push(
      `[${prevLabel}]drawbox=x=${Math.round(width * 0.1)}:y=${accentY}:w=${Math.round(width * 0.8)}:h=2:color=0x00BFFF@0.25:t=fill[${accentLabel}]`
    );
    prevLabel = accentLabel;
  }

  // Subtle glow behind the question area
  const glowCY = opts?.glowCenterY ?? Math.round(height * 0.35);
  const glowH = opts?.glowHeight ?? Math.round(height * 0.30);
  const glowY = glowCY - Math.round(glowH / 2);
  const glowLabel = 'glow';
  filters.push(
    `[${prevLabel}]drawbox=x=${Math.round(width * 0.05)}:y=${glowY}:w=${Math.round(width * 0.9)}:h=${glowH}:color=0x2D1B69@0.18:t=fill[${glowLabel}]`
  );
  prevLabel = glowLabel;

  return { filters, outputLabel: prevLabel };
}

/**
 * Render silent video with engaging text overlays:
 *
 * - Smooth gradient background (deep navy → purple → midnight)
 * - "QUIZ" header bar always visible at top
 * - Question in a semi-transparent card, center-aligned
 * - Options in cards, left-aligned, cumulative reveal (stay visible)
 * - Gold countdown numbers with pulsing overlay
 * - Answer reveal flash + green/red boxes + "Correct!" badge
 * - Content block vertically centered
 */
export async function renderSilentVideo(
  outputFile: string,
  duration: number,
  width: number,
  height: number,
  fps: number,
  textConfig: {
    question: string;
    options: [string, string, string, string];
    answerIndex: number;
    explanation: string;
    timing: {
      question: { start: number; end: number };
      options: [{ start: number; end: number }, { start: number; end: number }, { start: number; end: number }, { start: number; end: number }];
      countdown: { start: number; end: number };
      answerReveal: { start: number; end: number };
    };
  },
  config: {
    fontFile: string;
    safeMargin: { top: number; bottom: number; left: number; right: number };
    theme?: {
      preset?: string;
      customStops?: Array<{ pos: number; color: string }>;
      backgroundImage?: string;
      backgroundOpacity?: number;
    };
    textAlign?: 'left' | 'center' | 'right';
    layoutDensity?: number;
    headerTitle?: string;
  }
): Promise<void> {
  const { question, options, answerIndex, timing } = textConfig;
  const { fontFile, safeMargin } = config;
  const qAlign = config.textAlign || 'center';
  const layoutDensity = config.layoutDensity ?? 1;
  const headerTitle =
    (config.headerTitle || "QUIZ").replace(/\s+/g, " ").trim().slice(0, 32) || "QUIZ";

  const layout = computeLayout(width, height, safeMargin, question, options, layoutDensity);
  const {
    hPad,
    qFontSize, oFontSize,
    qLineH, oLineH, optGap,
    questionLines, optionLines,
    questionYStart, optionYStart, countdownY,
    headerY, headerHeight,
  } = layout;

  const escapedQuestionLines = questionLines.map(l => escapeDrawtext(l));
  const labelWidth = Math.round(oFontSize * 0.52 * 3) + 10;

  const themeStops = config.theme?.customStops;
  const bgColor = themeStops && themeStops.length >= 2
    ? `0x${themeStops[0].color.replace(/^#/, '')}`
    : '0x0B0A1A';

  // ── Smooth gradient background ──
  const grad = buildGradientFilters(width, height, duration, {
    accentLineY: headerY + headerHeight + 4,
    glowCenterY: questionYStart + Math.round(questionLines.length * qLineH / 2),
    glowHeight: Math.round(questionLines.length * qLineH + 120),
    customColorStops: themeStops,
  });
  const filters: string[] = [...grad.filters];

  // ── Header bar (always visible) ──
  const headerBarY = headerY - 10;
  filters.push(
    `[${grad.outputLabel}]drawbox=x=0:y=${headerBarY}:w=${width}:h=${headerHeight}:` +
    `color=0x00BFFF@0.15:t=fill[hdr_bg]`
  );
  filters.push(
    `[hdr_bg]drawtext=fontfile='${fontFile}':text='${escapeDrawtext(headerTitle)}':` +
    `fontsize=38:fontcolor=0x00BFFF:x=(w-text_w)/2:y=${headerY + 10}[hdr]`
  );

  let layer = 'hdr';

  // ── Question card (stays visible through answer reveal) ──
  const qStart = timing.question.start;
  const qVisibleEnd = timing.answerReveal.end;
  const qBoxPadV = 16;
  const qBoxPadH = 20;
  const qBoxX = hPad - qBoxPadH;
  const qBoxW = width - 2 * qBoxX;
  const qBoxY = questionYStart - qBoxPadV;
  const qBoxH = questionLines.length * qLineH + qBoxPadV * 2;

  filters.push(
    `[${layer}]drawbox=x=${qBoxX}:y=${qBoxY}:w=${qBoxW}:h=${qBoxH}:` +
    `color=0x1e1e3e@0.8:t=fill:` +
    `enable='${escapeCommasInFilterExpr(`between(t,${qStart},${qVisibleEnd})`)}'[q_box]`
  );
  layer = 'q_box';

  const qXExpr = qAlign === 'left' ? `${hPad}` : qAlign === 'right' ? `(w-text_w-${hPad})` : '(w-text_w)/2';

  questionLines.forEach((_l, i) => {
    const y = questionYStart + i * qLineH;
    const next = i === questionLines.length - 1 ? 'q_done' : `q_l${i}`;
    filters.push(
      `[${layer}]drawtext=fontfile='${fontFile}':text='${escapedQuestionLines[i]}':` +
      `fontsize=${qFontSize}:fontcolor=white:` +
      `x=${qXExpr}:y=${y}:` +
      `enable='${escapeCommasInFilterExpr(`between(t,${qStart},${qVisibleEnd})`)}'[${next}]`
    );
    layer = next;
  });

  // ── Options with card boxes (cumulative — they stay visible) ──
  const boxPadV = 12;
  const boxPadH = 20;
  const boxX = hPad - boxPadH;
  const boxW = width - 2 * boxX;

  let yPos = optionYStart;
  const optionBoxes: Array<{ y: number; h: number }> = [];

  options.forEach((_opt, idx) => {
    const oStart = timing.options[idx].start;
    const oEnd = timing.options[idx].end;
    const label = String.fromCharCode(65 + idx);
    const lineCount = optionLines[idx].length;
    const boxH = lineCount * oLineH + boxPadV * 2;
    const boxY = yPos - boxPadV;

    optionBoxes.push({ y: boxY, h: boxH });

    filters.push(
      `[${layer}]drawbox=x=${boxX}:y=${boxY}:w=${boxW}:h=${boxH}:` +
      `color=0x1e1e3e@0.75:t=fill:` +
      `enable='${escapeCommasInFilterExpr(`between(t,${oStart},${oEnd})`)}'[boxf${idx}]`
    );
    filters.push(
      `[boxf${idx}]drawbox=x=${boxX}:y=${boxY}:w=${boxW}:h=${boxH}:` +
      `color=0x00BFFF@0.3:t=2:` +
      `enable='${escapeCommasInFilterExpr(`between(t,${oStart},${oEnd})`)}'[box${idx}]`
    );
    layer = `box${idx}`;

    optionLines[idx].forEach((line, li) => {
      const y = yPos + li * oLineH;
      const isLast = li === optionLines[idx].length - 1;
      const isLastOpt = idx === 3;
      const next = isLast
        ? (isLastOpt ? 'opt_done' : `opt${idx + 1}`)
        : `o${idx}_l${li}`;

      if (li === 0) {
        const labelTxt = escapeDrawtext(`${label})`);
        const lineTxt = escapeDrawtext(line);
        const labelNext = `lbl${idx}`;
        filters.push(
          `[${layer}]drawtext=fontfile='${fontFile}':text='${labelTxt}':` +
          `fontsize=${oFontSize}:fontcolor=0x00BFFF:` +
          `x=${hPad}:y=${y}:` +
          `enable='${escapeCommasInFilterExpr(`between(t,${oStart},${oEnd})`)}'[${labelNext}]`
        );
        filters.push(
          `[${labelNext}]drawtext=fontfile='${fontFile}':text='${lineTxt}':` +
          `fontsize=${oFontSize}:fontcolor=white:` +
          `x=${hPad + labelWidth}:y=${y}:` +
          `enable='${escapeCommasInFilterExpr(`between(t,${oStart},${oEnd})`)}'[${next}]`
        );
      } else {
        const txt = escapeDrawtext(line);
        filters.push(
          `[${layer}]drawtext=fontfile='${fontFile}':text='${txt}':` +
          `fontsize=${oFontSize}:fontcolor=white:` +
          `x=${hPad + labelWidth}:y=${y}:` +
          `enable='${escapeCommasInFilterExpr(`between(t,${oStart},${oEnd})`)}'[${next}]`
        );
      }
      layer = next;
    });

    yPos += lineCount * oLineH + optGap;
  });

  // ── Countdown with pulse overlay (gold numbers + dark pulse each tick) ──
  const cdStart = timing.countdown.start;
  const cdEnd = timing.countdown.end;
  const cdEach = (cdEnd - cdStart) / 3;

  for (let i = 0; i < 3; i++) {
    const num = 3 - i;
    const s = cdStart + i * cdEach;
    const e = s + cdEach;
    const pulseMid = s + cdEach * 0.15;
    const prev = i === 0 ? layer : `cd${i}`;
    const pulseLabel = `cdp${i}`;
    const next = i === 2 ? 'cd_done' : `cd${i + 1}`;
    filters.push(
      `[${prev}]drawbox=x=0:y=0:w=${width}:h=${height}:` +
      `color=0x000000@0.15:t=fill:` +
      `enable='${escapeCommasInFilterExpr(`between(t,${s},${pulseMid})`)}'[${pulseLabel}]`
    );
    filters.push(
      `[${pulseLabel}]drawtext=fontfile='${fontFile}':text='${num}':` +
      `fontsize=100:fontcolor=0xFFD700:x=(w-text_w)/2:y=${countdownY}:` +
      `enable='${escapeCommasInFilterExpr(`between(t,${s},${e})`)}'[${next}]`
    );
  }

  // ── Answer reveal flash + green/red boxes + "Correct!" badge ──
  const arStart = timing.answerReveal.start;
  const arEnd = timing.answerReveal.end;
  const flashEnd = arStart + 0.15;

  filters.push(
    `[cd_done]drawbox=x=0:y=0:w=${width}:h=${height}:` +
    `color=0xFFFFFF@0.12:t=fill:` +
    `enable='${escapeCommasInFilterExpr(`between(t,${arStart},${flashEnd})`)}'[flash]`
  );
  layer = 'flash';

  for (let idx = 0; idx < 4; idx++) {
    const box = optionBoxes[idx];
    const isCorrect = idx === answerIndex;
    const boxColor = isCorrect ? '0x27AE60@0.85' : '0xE74C3C@0.45';
    const next = `hl${idx}`;
    filters.push(
      `[${layer}]drawbox=x=${boxX}:y=${box.y}:w=${boxW}:h=${box.h}:` +
      `color=${boxColor}:t=fill:` +
      `enable='${escapeCommasInFilterExpr(`between(t,${arStart},${arEnd})`)}'[${next}]`
    );
    layer = next;

    const label = String.fromCharCode(65 + idx);
    const textColor = isCorrect ? '0xFFFFFF' : '0xcccccc';
    const labelColor = isCorrect ? '0xFFD700' : '0xcccccc';
    let oY = box.y + boxPadV;

    optionLines[idx].forEach((line, li) => {
      const y = oY + li * oLineH;
      const isLast = li === optionLines[idx].length - 1 && idx === 3;
      const lineNext = isLast ? 'reveal_done' : `ht${idx}_${li}`;

      if (li === 0) {
        const lblNext = `htl${idx}`;
        filters.push(
          `[${layer}]drawtext=fontfile='${fontFile}':text='${escapeDrawtext(`${label})`)}':` +
          `fontsize=${oFontSize}:fontcolor=${labelColor}:` +
          `x=${hPad}:y=${y}:` +
          `enable='${escapeCommasInFilterExpr(`between(t,${arStart},${arEnd})`)}'[${lblNext}]`
        );
        filters.push(
          `[${lblNext}]drawtext=fontfile='${fontFile}':text='${escapeDrawtext(line)}':` +
          `fontsize=${oFontSize}:fontcolor=${textColor}:` +
          `x=${hPad + labelWidth}:y=${y}:` +
          `enable='${escapeCommasInFilterExpr(`between(t,${arStart},${arEnd})`)}'[${lineNext}]`
        );
      } else {
        filters.push(
          `[${layer}]drawtext=fontfile='${fontFile}':text='${escapeDrawtext(line)}':` +
          `fontsize=${oFontSize}:fontcolor=${textColor}:` +
          `x=${hPad + labelWidth}:y=${y}:` +
          `enable='${escapeCommasInFilterExpr(`between(t,${arStart},${arEnd})`)}'[${lineNext}]`
        );
      }
      layer = lineNext;
    });
  }

  // "Correct!" badge at the bottom instead of the old distant answer label
  filters.push(
    `[${layer}]drawtext=fontfile='${fontFile}':text='${escapeDrawtext('Correct!')}':` +
    `fontsize=56:fontcolor=0x27AE60:x=(w-text_w)/2:y=${countdownY}:` +
    `enable='${escapeCommasInFilterExpr(`between(t,${arStart},${arEnd})`)}'[final]`
  );

  // ── Encode ──
  const filterComplex = filters.join(';');
  const command = [
    'ffmpeg',
    `-f lavfi -i color=c=${bgColor}:s=${width}x${height}:d=${duration}`,
    `-filter_complex "${filterComplex}"`,
    `-map "[final]"`,
    `-r ${fps}`,
    '-c:v libx264 -profile:v baseline -preset medium -pix_fmt yuv420p',
    '-y',
    `"${outputFile}"`
  ].join(' ');

  try {
    await execAsync(command);
  } catch (error: any) {
    console.warn('Complex filter failed, using simpler version:', error.message);
    await renderSilentVideoSimple(outputFile, duration, width, height, fps, textConfig, config);
  }
}

/**
 * Simplified video rendering (fallback) — same visual style as the main
 * renderer but without complex animations for maximum FFmpeg compatibility.
 */
async function renderSilentVideoSimple(
  outputFile: string,
  duration: number,
  width: number,
  height: number,
  fps: number,
  textConfig: {
    question: string;
    options: [string, string, string, string];
    answerIndex: number;
    explanation: string;
    timing: {
      question: { start: number; end: number };
      options: [{ start: number; end: number }, { start: number; end: number }, { start: number; end: number }, { start: number; end: number }];
      countdown: { start: number; end: number };
      answerReveal: { start: number; end: number };
    };
  },
  config: {
    fontFile: string;
    safeMargin: { top: number; bottom: number; left: number; right: number };
    layoutDensity?: number;
    headerTitle?: string;
  }
): Promise<void> {
  const { question, options, answerIndex, timing } = textConfig;
  const { fontFile, safeMargin } = config;
  const layoutDensity = config.layoutDensity ?? 1;
  const headerTitle =
    (config.headerTitle || "QUIZ").replace(/\s+/g, " ").trim().slice(0, 32) || "QUIZ";

  const layout = computeLayout(width, height, safeMargin, question, options, layoutDensity);
  const {
    hPad,
    qFontSize, oFontSize,
    qLineH, oLineH, optGap,
    questionLines, optionLines,
    questionYStart, optionYStart, countdownY,
    headerY, headerHeight,
  } = layout;

  const escapedQuestionLines = questionLines.map(l => escapeDrawtext(l));
  const labelWidth = Math.round(oFontSize * 0.52 * 3) + 10;
  const bgColor = '0x0B0A1A';

  // ── Smooth gradient background ──
  const grad = buildGradientFilters(width, height, duration, {
    accentLineY: headerY + headerHeight + 4,
    glowCenterY: questionYStart + Math.round(questionLines.length * qLineH / 2),
    glowHeight: Math.round(questionLines.length * qLineH + 120),
  });
  const filters: string[] = [...grad.filters];

  // ── Header bar ──
  const headerBarY = headerY - 10;
  filters.push(
    `[${grad.outputLabel}]drawbox=x=0:y=${headerBarY}:w=${width}:h=${headerHeight}:` +
    `color=0x00BFFF@0.15:t=fill[hdr_bg]`
  );
  filters.push(
    `[hdr_bg]drawtext=fontfile='${fontFile}':text='${escapeDrawtext(headerTitle)}':` +
    `fontsize=38:fontcolor=0x00BFFF:x=(w-text_w)/2:y=${headerY + 10}[hdr]`
  );

  let layer = 'hdr';

  // ── Question card (stays visible through answer reveal) ──
  const qStart = timing.question.start;
  const qVisibleEnd = timing.answerReveal.end;
  const qBoxPadV = 16;
  const qBoxPadH = 20;
  const qBoxX = hPad - qBoxPadH;
  const qBoxW = width - 2 * qBoxX;
  const qBoxY = questionYStart - qBoxPadV;
  const qBoxH = questionLines.length * qLineH + qBoxPadV * 2;

  filters.push(
    `[${layer}]drawbox=x=${qBoxX}:y=${qBoxY}:w=${qBoxW}:h=${qBoxH}:` +
    `color=0x1e1e3e@0.8:t=fill:` +
    `enable='${escapeCommasInFilterExpr(`between(t,${qStart},${qVisibleEnd})`)}'[q_box]`
  );
  layer = 'q_box';

  questionLines.forEach((_l, i) => {
    const y = questionYStart + i * qLineH;
    const next = i === questionLines.length - 1 ? 'q' : `q_l${i}`;
    filters.push(
      `[${layer}]drawtext=fontfile='${fontFile}':text='${escapedQuestionLines[i]}':` +
      `fontsize=${qFontSize}:fontcolor=white:x=(w-text_w)/2:y=${y}:` +
      `enable='${escapeCommasInFilterExpr(`between(t,${qStart},${qVisibleEnd})`)}'[${next}]`
    );
    layer = next;
  });

  // ── Options with card boxes ──
  const boxPadV = 12;
  const boxPadH = 20;
  const boxX = hPad - boxPadH;
  const boxW = width - 2 * boxX;

  let yPos = optionYStart;
  const optionBoxes: Array<{ y: number; h: number }> = [];

  options.forEach((_opt, idx) => {
    const oStart = timing.options[idx].start;
    const oEnd = timing.options[idx].end;
    const label = String.fromCharCode(65 + idx);
    const lineCount = optionLines[idx].length;
    const boxH = lineCount * oLineH + boxPadV * 2;
    const boxY = yPos - boxPadV;

    optionBoxes.push({ y: boxY, h: boxH });

    filters.push(
      `[${layer}]drawbox=x=${boxX}:y=${boxY}:w=${boxW}:h=${boxH}:` +
      `color=0x1e1e3e@0.75:t=fill:` +
      `enable='${escapeCommasInFilterExpr(`between(t,${oStart},${oEnd})`)}'[boxf${idx}]`
    );
    filters.push(
      `[boxf${idx}]drawbox=x=${boxX}:y=${boxY}:w=${boxW}:h=${boxH}:` +
      `color=0x00BFFF@0.3:t=2:` +
      `enable='${escapeCommasInFilterExpr(`between(t,${oStart},${oEnd})`)}'[box${idx}]`
    );
    layer = `box${idx}`;

    optionLines[idx].forEach((line, li) => {
      const y = yPos + li * oLineH;
      const isLast = li === optionLines[idx].length - 1;
      const isLastOpt = idx === 3;
      const next = isLast
        ? (isLastOpt ? 'opt_done' : `opt${idx}`)
        : `o${idx}_l${li}`;

      if (li === 0) {
        const labelTxt = escapeDrawtext(`${label})`);
        const lineTxt = escapeDrawtext(line);
        const labelNext = `lbl${idx}`;
        filters.push(
          `[${layer}]drawtext=fontfile='${fontFile}':text='${labelTxt}':` +
          `fontsize=${oFontSize}:fontcolor=0x00BFFF:` +
          `x=${hPad}:y=${y}:` +
          `enable='${escapeCommasInFilterExpr(`between(t,${oStart},${oEnd})`)}'[${labelNext}]`
        );
        filters.push(
          `[${labelNext}]drawtext=fontfile='${fontFile}':text='${lineTxt}':` +
          `fontsize=${oFontSize}:fontcolor=white:` +
          `x=${hPad + labelWidth}:y=${y}:` +
          `enable='${escapeCommasInFilterExpr(`between(t,${oStart},${oEnd})`)}'[${next}]`
        );
      } else {
        const txt = escapeDrawtext(line);
        filters.push(
          `[${layer}]drawtext=fontfile='${fontFile}':text='${txt}':` +
          `fontsize=${oFontSize}:fontcolor=white:x=${hPad + labelWidth}:y=${y}:` +
          `enable='${escapeCommasInFilterExpr(`between(t,${oStart},${oEnd})`)}'[${next}]`
        );
      }
      layer = next;
    });
    yPos += lineCount * oLineH + optGap;
  });

  // ── Countdown with pulse overlay (gold numbers + dark pulse each tick) ──
  const cdEach = (timing.countdown.end - timing.countdown.start) / 3;
  for (let i = 0; i < 3; i++) {
    const num = 3 - i;
    const s = timing.countdown.start + i * cdEach;
    const e = s + cdEach;
    const pulseMid = s + cdEach * 0.15;
    const prev = i === 0 ? layer : `cd${i}`;
    const pulseLabel = `cdp${i}`;
    const next = i === 2 ? 'cd_done' : `cd${i + 1}`;
    filters.push(
      `[${prev}]drawbox=x=0:y=0:w=${width}:h=${height}:` +
      `color=0x000000@0.15:t=fill:` +
      `enable='${escapeCommasInFilterExpr(`between(t,${s},${pulseMid})`)}'[${pulseLabel}]`
    );
    filters.push(
      `[${pulseLabel}]drawtext=fontfile='${fontFile}':text='${num}':` +
      `fontsize=100:fontcolor=0xFFD700:x=(w-text_w)/2:y=${countdownY}:` +
      `enable='${escapeCommasInFilterExpr(`between(t,${s},${e})`)}'[${next}]`
    );
  }

  // ── Answer reveal flash + green/red boxes + "Correct!" badge ──
  const arStart = timing.answerReveal.start;
  const arEnd = timing.answerReveal.end;
  const flashEnd = arStart + 0.15;

  filters.push(
    `[cd_done]drawbox=x=0:y=0:w=${width}:h=${height}:` +
    `color=0xFFFFFF@0.12:t=fill:` +
    `enable='${escapeCommasInFilterExpr(`between(t,${arStart},${flashEnd})`)}'[flash]`
  );
  layer = 'flash';

  for (let idx = 0; idx < 4; idx++) {
    const box = optionBoxes[idx];
    const isCorrect = idx === answerIndex;
    const boxColor = isCorrect ? '0x27AE60@0.85' : '0xE74C3C@0.45';
    const next = `hl${idx}`;
    filters.push(
      `[${layer}]drawbox=x=${boxX}:y=${box.y}:w=${boxW}:h=${box.h}:` +
      `color=${boxColor}:t=fill:` +
      `enable='${escapeCommasInFilterExpr(`between(t,${arStart},${arEnd})`)}'[${next}]`
    );
    layer = next;

    const label = String.fromCharCode(65 + idx);
    const textColor = isCorrect ? '0xFFFFFF' : '0xcccccc';
    const labelColor = isCorrect ? '0xFFD700' : '0xcccccc';
    let oY = box.y + boxPadV;

    optionLines[idx].forEach((line, li) => {
      const y = oY + li * oLineH;
      const isLast = li === optionLines[idx].length - 1 && idx === 3;
      const lineNext = isLast ? 'reveal_done' : `ht${idx}_${li}`;

      if (li === 0) {
        const lblNext = `htl${idx}`;
        filters.push(
          `[${layer}]drawtext=fontfile='${fontFile}':text='${escapeDrawtext(`${label})`)}':` +
          `fontsize=${oFontSize}:fontcolor=${labelColor}:` +
          `x=${hPad}:y=${y}:` +
          `enable='${escapeCommasInFilterExpr(`between(t,${arStart},${arEnd})`)}'[${lblNext}]`
        );
        filters.push(
          `[${lblNext}]drawtext=fontfile='${fontFile}':text='${escapeDrawtext(line)}':` +
          `fontsize=${oFontSize}:fontcolor=${textColor}:` +
          `x=${hPad + labelWidth}:y=${y}:` +
          `enable='${escapeCommasInFilterExpr(`between(t,${arStart},${arEnd})`)}'[${lineNext}]`
        );
      } else {
        filters.push(
          `[${layer}]drawtext=fontfile='${fontFile}':text='${escapeDrawtext(line)}':` +
          `fontsize=${oFontSize}:fontcolor=${textColor}:` +
          `x=${hPad + labelWidth}:y=${y}:` +
          `enable='${escapeCommasInFilterExpr(`between(t,${arStart},${arEnd})`)}'[${lineNext}]`
        );
      }
      layer = lineNext;
    });
  }

  // "Correct!" badge
  filters.push(
    `[${layer}]drawtext=fontfile='${fontFile}':text='${escapeDrawtext('Correct!')}':` +
    `fontsize=56:fontcolor=0x27AE60:x=(w-text_w)/2:y=${countdownY}:` +
    `enable='${escapeCommasInFilterExpr(`between(t,${arStart},${arEnd})`)}'[final]`
  );

  const filterComplex = filters.join(';');
  const command = [
    'ffmpeg',
    `-f lavfi -i color=c=${bgColor}:s=${width}x${height}:d=${duration}`,
    `-filter_complex "${filterComplex}"`,
    `-map "[final]"`,
    `-r ${fps}`,
    '-c:v libx264 -profile:v baseline -preset medium -pix_fmt yuv420p',
    '-y',
    `"${outputFile}"`
  ].join(' ');

  await execAsync(command);
}

/**
 * Mix background music under voice audio.
 * BGM is looped to match voice duration and mixed at low volume.
 * Uses normalize=0 to prevent amix from dividing voice volume.
 */
export async function mixBgmWithVoice(
  voiceFile: string,
  bgmFile: string,
  outputFile: string,
  bgmVolume: number = 0.12
): Promise<void> {
  const command = [
    'ffmpeg',
    `-i "${voiceFile}"`,
    `-stream_loop -1 -i "${bgmFile}"`,
    `-filter_complex "[0]volume=1.0[voice];[1]volume=${bgmVolume}[bgm];[voice][bgm]amix=inputs=2:duration=first:dropout_transition=2:normalize=0"`,
    '-ar 44100 -ac 2',
    '-y',
    `"${outputFile}"`
  ].join(' ');

  try {
    await execAsync(command);
  } catch (error: any) {
    console.warn(`BGM mixing failed, using voice-only audio: ${error.message}`);
    await fs.copyFile(voiceFile, outputFile);
  }
}

/**
 * Overlay sound effects at precise timestamps on a base audio track.
 * Each SFX entry has a file path, offset in milliseconds, and optional volume.
 *
 * Uses normalize=0 to keep the base voice track at full volume.
 * SFX are pre-scaled via their volume parameter so they layer on top
 * without reducing the voice.
 */
export async function overlaySfx(
  baseFile: string,
  sfxEntries: Array<{ file: string; offsetMs: number; volume?: number }>,
  outputFile: string
): Promise<void> {
  if (sfxEntries.length === 0) {
    await fs.copyFile(baseFile, outputFile);
    return;
  }

  const inputs = [`-i "${baseFile}"`];
  const filterParts: string[] = [];

  sfxEntries.forEach((sfx, i) => {
    inputs.push(`-i "${sfx.file}"`);
    const vol = sfx.volume ?? 0.5;
    filterParts.push(
      `[${i + 1}]volume=${vol},adelay=${sfx.offsetMs}|${sfx.offsetMs}[sfx${i}]`
    );
  });

  const mixInputs = ['[0]', ...sfxEntries.map((_, i) => `[sfx${i}]`)].join('');
  const totalInputs = sfxEntries.length + 1;
  filterParts.push(
    `${mixInputs}amix=inputs=${totalInputs}:duration=first:dropout_transition=0:normalize=0`
  );

  const command = [
    'ffmpeg',
    ...inputs,
    `-filter_complex "${filterParts.join(';')}"`,
    '-ar 44100 -ac 2',
    '-y',
    `"${outputFile}"`
  ].join(' ');

  try {
    await execAsync(command);
  } catch (error: any) {
    console.warn(`SFX overlay failed, using base audio: ${error.message}`);
    await fs.copyFile(baseFile, outputFile);
  }
}

/**
 * Render intro slide with topic name, "Can you answer this?" text,
 * voice-over, BGM, and optional ding SFX.
 * Duration adapts to the voice file length (minimum 2.5s).
 */
export async function renderIntroSlide(
  outputFile: string,
  topic: string,
  config: {
    width: number;
    height: number;
    fps: number;
    fontFile: string;
    voiceFile?: string;
    bgmFile?: string;
    dingFile?: string;
  }
): Promise<void> {
  const { width, height, fps, fontFile } = config;

  // Duration adapts to voice length + padding, minimum 2.5s
  let dur = 2.5;
  if (config.voiceFile) {
    const voiceDur = await extractDuration(config.voiceFile);
    dur = Math.max(2.5, voiceDur + 1.0);
  }

  const bgColor = '0x0B0A1A';
  const escapedTopic = escapeDrawtext(topic);
  const subtitle = escapeDrawtext('Can you answer this?');

  const grad = buildGradientFilters(width, height, dur, {
    showAccent: false,
    glowCenterY: Math.round(height * 0.5),
    glowHeight: Math.round(height * 0.25),
  });
  const filters = [
    ...grad.filters,
    `[${grad.outputLabel}]drawtext=fontfile='${fontFile}':text='${escapedTopic}':fontsize=52:fontcolor=white:x=(w-text_w)/2:y=(h-text_h)/2-60[t1]`,
    `[t1]drawtext=fontfile='${fontFile}':text='${subtitle}':fontsize=36:fontcolor=0x00BFFF:x=(w-text_w)/2:y=(h-text_h)/2+40[final]`,
  ];

  const silentVideo = outputFile.replace(/\.mp4$/, '_silent.mp4');
  const videoCmd = [
    'ffmpeg',
    `-f lavfi -i color=c=${bgColor}:s=${width}x${height}:d=${dur}`,
    `-filter_complex "${filters.join(';')}"`,
    `-map "[final]"`,
    `-r ${fps}`,
    '-c:v libx264 -profile:v baseline -preset medium -pix_fmt yuv420p',
    '-y',
    `"${silentVideo}"`
  ].join(' ');
  await execAsync(videoCmd);

  // Build audio: voice + BGM + optional ding, layered
  const audioFile = outputFile.replace(/\.mp4$/, '_audio.mp3');
  const bgmTrack = outputFile.replace(/\.mp4$/, '_bgm.mp3');

  // Step 1: Create BGM bed (or silence)
  if (config.bgmFile) {
    const bgmCmd = [
      'ffmpeg',
      `-stream_loop -1 -i "${config.bgmFile}"`,
      `-af "volume=0.20,afade=t=in:st=0:d=0.5,afade=t=out:st=${dur - 0.5}:d=0.5"`,
      `-t ${dur}`,
      '-ar 44100 -ac 2 -y',
      `"${bgmTrack}"`
    ].join(' ');
    await execAsync(bgmCmd);
  } else {
    await execAsync(`ffmpeg -f lavfi -i anullsrc=channel_layout=stereo:sample_rate=44100 -t ${dur} -y "${bgmTrack}"`);
  }

  // Step 2: Layer voice (delayed 0.4s for a beat before speaking) + ding on top of BGM
  const sfxEntries: Array<{ file: string; offsetMs: number; volume?: number }> = [];
  if (config.voiceFile) {
    sfxEntries.push({ file: config.voiceFile, offsetMs: 400, volume: 1.0 });
  }
  if (config.dingFile) {
    sfxEntries.push({ file: config.dingFile, offsetMs: 100, volume: 0.6 });
  }

  if (sfxEntries.length > 0) {
    await overlaySfx(bgmTrack, sfxEntries, audioFile);
  } else {
    await fs.copyFile(bgmTrack, audioFile);
  }

  // Step 3: Mux video + audio
  const muxCmd = [
    'ffmpeg',
    `-i "${silentVideo}"`,
    `-i "${audioFile}"`,
    '-c:v copy -c:a aac -shortest',
    '-y',
    `"${outputFile}"`
  ].join(' ');
  await execAsync(muxCmd);

  await fs.unlink(silentVideo).catch(() => {});
  await fs.unlink(audioFile).catch(() => {});
  await fs.unlink(bgmTrack).catch(() => {});
}

/**
 * Render outro slide with "Follow for more quizzes!" text,
 * voice-over, and BGM.
 * Duration adapts to the voice file length (minimum 2.5s).
 */
export async function renderOutroSlide(
  outputFile: string,
  config: {
    width: number;
    height: number;
    fps: number;
    fontFile: string;
    voiceFile?: string;
    bgmFile?: string;
  }
): Promise<void> {
  const { width, height, fps, fontFile } = config;

  let dur = 2.5;
  if (config.voiceFile) {
    const voiceDur = await extractDuration(config.voiceFile);
    dur = Math.max(2.5, voiceDur + 1.0);
  }

  const bgColor = '0x0B0A1A';
  const line1 = escapeDrawtext('Follow for more quizzes!');
  const line2 = escapeDrawtext('Like & Subscribe');

  const grad = buildGradientFilters(width, height, dur, {
    showAccent: false,
    glowCenterY: Math.round(height * 0.5),
    glowHeight: Math.round(height * 0.25),
  });
  const filters = [
    ...grad.filters,
    `[${grad.outputLabel}]drawtext=fontfile='${fontFile}':text='${line1}':fontsize=48:fontcolor=0xFFD700:x=(w-text_w)/2:y=(h-text_h)/2-40[t1]`,
    `[t1]drawtext=fontfile='${fontFile}':text='${line2}':fontsize=34:fontcolor=0x00BFFF:x=(w-text_w)/2:y=(h-text_h)/2+40[final]`,
  ];

  const silentVideo = outputFile.replace(/\.mp4$/, '_silent.mp4');
  const videoCmd = [
    'ffmpeg',
    `-f lavfi -i color=c=${bgColor}:s=${width}x${height}:d=${dur}`,
    `-filter_complex "${filters.join(';')}"`,
    `-map "[final]"`,
    `-r ${fps}`,
    '-c:v libx264 -profile:v baseline -preset medium -pix_fmt yuv420p',
    '-y',
    `"${silentVideo}"`
  ].join(' ');
  await execAsync(videoCmd);

  const audioFile = outputFile.replace(/\.mp4$/, '_audio.mp3');
  const bgmTrack = outputFile.replace(/\.mp4$/, '_bgm.mp3');

  if (config.bgmFile) {
    const bgmCmd = [
      'ffmpeg',
      `-stream_loop -1 -i "${config.bgmFile}"`,
      `-af "volume=0.20,afade=t=in:st=0:d=0.3,afade=t=out:st=${dur - 1.0}:d=1.0"`,
      `-t ${dur}`,
      '-ar 44100 -ac 2 -y',
      `"${bgmTrack}"`
    ].join(' ');
    await execAsync(bgmCmd);
  } else {
    await execAsync(`ffmpeg -f lavfi -i anullsrc=channel_layout=stereo:sample_rate=44100 -t ${dur} -y "${bgmTrack}"`);
  }

  if (config.voiceFile) {
    await overlaySfx(bgmTrack, [{ file: config.voiceFile, offsetMs: 300, volume: 1.0 }], audioFile);
  } else {
    await fs.copyFile(bgmTrack, audioFile);
  }

  const muxCmd = [
    'ffmpeg',
    `-i "${silentVideo}"`,
    `-i "${audioFile}"`,
    '-c:v copy -c:a aac -shortest',
    '-y',
    `"${outputFile}"`
  ].join(' ');
  await execAsync(muxCmd);

  await fs.unlink(silentVideo).catch(() => {});
  await fs.unlink(audioFile).catch(() => {});
  await fs.unlink(bgmTrack).catch(() => {});
}

/**
 * Mux audio and video together
 * Audio is MASTER - video is trimmed if longer
 * Uses -shortest flag to prevent overrun
 */
export async function muxAudioVideo(
  videoFile: string,
  audioFile: string,
  outputFile: string,
  audioBitrate: number = 192000
): Promise<void> {
  const command = [
    'ffmpeg',
    `-i "${videoFile}"`,
    `-i "${audioFile}"`,
    '-c:v copy',
    '-c:a aac',
    `-b:a ${audioBitrate}`,
    '-shortest', // Stop when shortest stream ends (audio is master)
    '-y',
    `"${outputFile}"`
  ].join(' ');
  
  try {
    await execAsync(command);
  } catch (error: any) {
    throw new Error(`Audio-video muxing failed: ${error.message}`);
  }
}

export type ConcatVideosOptions = {
  fps?: number;
};

/**
 * Concatenate video segments with one continuous A/V timeline.
 * Uses the concat *filter* (decode + re-encode) instead of concat demuxer + stream copy,
 * which can leave video duration longer than audio (broken playback / silent tail).
 */
export async function concatVideos(
  inputFiles: string[],
  outputFile: string,
  options?: ConcatVideosOptions
): Promise<void> {
  const files = inputFiles.filter((f): f is string => Boolean(f));
  if (files.length === 0) {
    throw new Error('No valid segments to concatenate');
  }
  if (files.length === 1) {
    // Even for a single segment, ensure "fast start" so mobile browsers can play
    // without downloading the entire file first (moov atom at the front).
    const input = path.resolve(files[0]);
    const out = path.resolve(outputFile);
    const command = [
      'ffmpeg',
      '-y',
      `-i "${input}"`,
      '-c',
      'copy',
      '-movflags',
      '+faststart',
      `"${out}"`,
    ].join(' ');
    await execAsync(command);
    return;
  }

  const n = files.length;
  const fps = options?.fps ?? 30;
  const inputs = files.map((f) => `-i "${path.resolve(f)}"`).join(' ');
  const filterParts: string[] = [];
  for (let i = 0; i < n; i++) {
    filterParts.push(`[${i}:v][${i}:a]`);
  }
  const filterComplex = `${filterParts.join('')}concat=n=${n}:v=1:a=1[outv][outa]`;

  const command = [
    'ffmpeg',
    '-y',
    inputs,
    '-filter_complex',
    `"${filterComplex}"`,
    '-map',
    '"[outv]"',
    '-map',
    '"[outa]"',
    '-c:v',
    'libx264',
    '-crf',
    '22',
    '-preset',
    'medium',
    '-pix_fmt',
    'yuv420p',
    '-r',
    String(fps),
    '-c:a',
    'aac',
    '-b:a',
    '192k',
    '-ar',
    '44100',
    '-ac',
    '2',
    '-movflags',
    '+faststart',
    `"${path.resolve(outputFile)}"`,
  ].join(' ');

  try {
    await execAsync(command);
  } catch (error: any) {
    throw new Error(`Video concatenation failed: ${error.message}`);
  }
}

/**
 * Speed up video (if total duration exceeds limit)
 */
export async function speedUpVideo(
  inputFile: string,
  outputFile: string,
  speedFactor: number = 1.1
): Promise<void> {
  const command = [
    'ffmpeg',
    `-i "${inputFile}"`,
    `-filter_complex "[0:v]setpts=PTS/${speedFactor}[v];[0:a]atempo=${speedFactor}[a]"`,
    '-map "[v]"',
    '-map "[a]"',
    '-y',
    `"${outputFile}"`
  ].join(' ');
  
  try {
    await execAsync(command);
  } catch (error: any) {
    throw new Error(`Video speed-up failed: ${error.message}`);
  }
}

/**
 * Validate video file format (codec, resolution, fps)
 */
export async function validateVideoFormat(
  filePath: string,
  expectedWidth: number,
  expectedHeight: number,
  expectedFps: number
): Promise<{ valid: boolean; error?: string }> {
  try {
    const command = `ffprobe -v error -select_streams v:0 -show_entries stream=width,height,r_frame_rate,codec_name -of json "${filePath}"`;
    const { stdout } = await execAsync(command);
    const data = JSON.parse(stdout);
    
    const stream = data.streams?.[0];
    if (!stream) {
      return { valid: false, error: 'No video stream found' };
    }
    
    if (stream.width !== expectedWidth || stream.height !== expectedHeight) {
      return { valid: false, error: `Resolution mismatch: expected ${expectedWidth}x${expectedHeight}, got ${stream.width}x${stream.height}` };
    }
    
    // Parse frame rate (e.g., "30/1" -> 30)
    const [num, den] = stream.r_frame_rate.split('/').map(Number);
    const fps = num / den;
    if (Math.abs(fps - expectedFps) > 0.1) {
      return { valid: false, error: `FPS mismatch: expected ${expectedFps}, got ${fps}` };
    }
    
    return { valid: true };
  } catch (error: any) {
    return { valid: false, error: error.message };
  }
}
