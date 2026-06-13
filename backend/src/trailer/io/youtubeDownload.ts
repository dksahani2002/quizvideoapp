/**
 * Download YouTube videos via yt-dlp for trailer breakdown ingestion.
 */
import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';

const execFileAsync = promisify(execFile);

const YOUTUBE_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be', 'www.youtu.be']);

/** Returns true for youtube.com / youtu.be URLs. */
export function isValidYoutubeUrl(raw: string): boolean {
  try {
    const u = new URL(raw.trim());
    const host = u.hostname.toLowerCase();
    return YOUTUBE_HOSTS.has(host);
  } catch {
    return false;
  }
}

export type YoutubeDownloadResult = {
  videoPath: string;
  title: string;
};

function isSslCertError(msg: string): boolean {
  return /CERTIFICATE_VERIFY_FAILED|certificate verify failed|SSL.*verify/i.test(msg);
}

function insecureSslAllowed(): boolean {
  const v = process.env.YT_DLP_NO_CHECK_CERTIFICATE?.trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

/** Resolve a CA bundle for Python/yt-dlp (macOS pip installs often lack one). */
async function resolveSslCertFile(): Promise<string | undefined> {
  if (process.env.SSL_CERT_FILE?.trim()) {
    return process.env.SSL_CERT_FILE.trim();
  }
  try {
    const { stdout } = await execFileAsync(
      'python3',
      ['-c', 'import certifi; print(certifi.where())'],
      { timeout: 5000 }
    );
    const certPath = stdout.trim();
    if (certPath) {
      await fs.access(certPath);
      return certPath;
    }
  } catch {
    /* certifi not installed — fall through */
  }
  return undefined;
}

async function buildYtdlpEnv(): Promise<NodeJS.ProcessEnv> {
  const env = { ...process.env };
  const certFile = await resolveSslCertFile();
  if (certFile) {
    env.SSL_CERT_FILE = certFile;
    env.REQUESTS_CA_BUNDLE = certFile;
  }
  return env;
}

type YtdlpRunResult = { stdout: string; stderr: string };

async function runYtdlp(args: string[], env: NodeJS.ProcessEnv): Promise<YtdlpRunResult> {
  return execFileAsync('yt-dlp', args, {
    timeout: 300_000,
    maxBuffer: 10 * 1024 * 1024,
    env,
  });
}

/**
 * Run yt-dlp; on macOS SSL failures retry with --no-check-certificates
 * (or use YT_DLP_NO_CHECK_CERTIFICATE=1 to skip verification up front).
 */
async function ytdlpExec(args: string[]): Promise<YtdlpRunResult> {
  const env = await buildYtdlpEnv();
  const baseArgs = insecureSslAllowed() ? ['--no-check-certificates', ...args] : args;

  try {
    return await runYtdlp(baseArgs, env);
  } catch (e: unknown) {
    const err = e as { message?: string; stderr?: string };
    const msg = `${err.message || ''} ${err.stderr || ''}`;
    if (/ENOENT|not found/i.test(msg)) {
      throw new Error('yt-dlp is not installed. Install it (pip install yt-dlp) and retry.');
    }
    if (!insecureSslAllowed() && isSslCertError(msg)) {
      console.warn(
        '[trailer-breakdown] yt-dlp SSL verification failed; retrying with --no-check-certificates. ' +
          'Fix permanently: pip install certifi, or set SSL_CERT_FILE, or YT_DLP_NO_CHECK_CERTIFICATE=1'
      );
      return runYtdlp(['--no-check-certificates', ...args], env);
    }
    throw e;
  }
}

/**
 * Download a YouTube video to `workDir/source.mp4` (best ≤1080p).
 *
 * @throws if yt-dlp fails or no output file is produced
 */
export async function downloadYoutubeVideo(
  youtubeUrl: string,
  workDir: string
): Promise<YoutubeDownloadResult> {
  if (!isValidYoutubeUrl(youtubeUrl)) {
    throw new Error('Invalid YouTube URL. Use a youtube.com or youtu.be link.');
  }

  await fs.mkdir(workDir, { recursive: true });
  const outputTemplate = path.join(workDir, 'source.%(ext)s');
  const url = youtubeUrl.trim();

  try {
    await ytdlpExec([
      '-f',
      'bestvideo[height<=1080]+bestaudio/best[height<=1080]/best',
      '--merge-output-format',
      'mp4',
      '-o',
      outputTemplate,
      '--no-playlist',
      '--socket-timeout',
      '30',
      url,
    ]);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`YouTube download failed: ${msg.slice(0, 400)}`);
  }

  const entries = await fs.readdir(workDir);
  const sourceFile = entries.find((f) => f.startsWith('source.'));
  if (!sourceFile) {
    throw new Error('YouTube download completed but no output file was found.');
  }

  const downloadedPath = path.join(workDir, sourceFile);
  const targetPath = path.join(workDir, 'source.mp4');
  if (downloadedPath !== targetPath) {
    await fs.rename(downloadedPath, targetPath);
  }

  let title = '';
  try {
    const { stdout } = await ytdlpExec(['--print', 'title', '--no-download', url]);
    title = stdout.trim().split('\n').pop()?.trim() || '';
  } catch {
    title = '';
  }

  return { videoPath: targetPath, title };
}
