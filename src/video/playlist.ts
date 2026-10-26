import { execFile, spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { AppError } from '../errors';
import { registerTemporaryDirectory } from '../lifecycle/temp-files';
import type { Logger } from '../logger';
import { killProcessTree } from '../platform/process-tree';
import { validateVideoFile, type ValidatedVideo } from './validate';

export interface MediaStreamInfo {
  index: number;
  codecType: string;
  codecName: string;
  width: number | null;
  height: number | null;
  durationSeconds: number | null;
}

export interface MediaInfo {
  durationSeconds: number;
  video: MediaStreamInfo;
  audio: MediaStreamInfo | null;
}

export interface PlaylistTarget {
  width: number;
  height: number;
  fps: number;
}

export interface PreparedPlaylist {
  video: ValidatedVideo;
  cleanup: () => Promise<void>;
}

interface RawFfprobeStream {
  index?: unknown;
  codec_type?: unknown;
  codec_name?: unknown;
  width?: unknown;
  height?: unknown;
  duration?: unknown;
}

interface RawFfprobeFormat {
  duration?: unknown;
}

export function parseFfprobeOutput(raw: string): MediaInfo {
  let parsed: { format?: RawFfprobeFormat; streams?: RawFfprobeStream[] };
  try {
    parsed = JSON.parse(raw) as { format?: RawFfprobeFormat; streams?: RawFfprobeStream[] };
  } catch {
    throw new AppError('ffprobe returned invalid JSON.');
  }

  const streams = Array.isArray(parsed.streams) ? parsed.streams : [];
  const video = streams.find((stream) => stream.codec_type === 'video');
  if (video === undefined) {
    throw new AppError('The file does not contain a video stream.');
  }

  const audio = streams.find((stream) => stream.codec_type === 'audio');
  const durationSeconds =
    positiveNumber(parsed.format?.duration) ?? positiveNumber(video.duration);
  if (durationSeconds === null) {
    throw new AppError('The video duration could not be determined.');
  }

  return {
    durationSeconds,
    video: parseStream(video, streams.indexOf(video)),
    audio: audio === undefined ? null : parseStream(audio, streams.indexOf(audio)),
  };
}

export function choosePlaylistTarget(inputs: MediaInfo[]): PlaylistTarget {
  const first = inputs[0];
  if (first === undefined) {
    throw new AppError('The playlist is empty.');
  }

  const sourceWidth = first.video.width ?? 1920;
  const sourceHeight = first.video.height ?? 1080;
  const scale = Math.min(1, 1920 / sourceWidth, 1080 / sourceHeight);
  const width = Math.max(2, Math.floor((sourceWidth * scale) / 2) * 2);
  const height = Math.max(2, Math.floor((sourceHeight * scale) / 2) * 2);

  return { width, height, fps: 30 };
}

export function buildPlaylistFilterGraph(
  inputs: MediaInfo[],
  target: PlaylistTarget,
): string {
  if (inputs.length === 0) {
    throw new AppError('The playlist is empty.');
  }

  const filters: string[] = [];
  const concatInputs: string[] = [];

  inputs.forEach((input, index) => {
    const videoLabel = `v${index}`;
    const audioLabel = `a${index}`;
    filters.push(
      `[${index}:${input.video.index}]fps=${target.fps},scale=${target.width}:${target.height}:force_original_aspect_ratio=decrease,pad=${target.width}:${target.height}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,format=yuv420p[${videoLabel}]`,
    );

    if (input.audio !== null) {
      filters.push(
        `[${index}:${input.audio.index}]aresample=48000,aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,asetpts=PTS-STARTPTS[${audioLabel}]`,
      );
    } else {
      filters.push(
        `anullsrc=r=48000:cl=stereo,atrim=duration=${input.durationSeconds},asetpts=PTS-STARTPTS[${audioLabel}]`,
      );
    }

    concatInputs.push(`[${videoLabel}]`, `[${audioLabel}]`);
  });

  filters.push(`${concatInputs.join('')}concat=n=${inputs.length}:v=1:a=1[vout][aout]`);
  return filters.join(';');
}

export function buildFfmpegArgs(
  inputs: ValidatedVideo[],
  filterGraph: string,
  outputPath: string,
): string[] {
  const args = [
    '-hide_banner',
    '-loglevel',
    'error',
    '-nostdin',
    '-y',
    '-progress',
    'pipe:1',
    '-nostats',
  ];

  for (const input of inputs) {
    args.push('-i', input.filePath);
  }

  args.push(
    '-filter_complex',
    filterGraph,
    '-map',
    '[vout]',
    '-map',
    '[aout]',
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '23',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-b:a',
    '160k',
    '-ar',
    '48000',
    '-ac',
    '2',
    '-map_metadata',
    '-1',
    '-map_chapters',
    '-1',
    '-movflags',
    '+faststart',
    outputPath,
  );

  return args;
}

export async function preparePlaylistVideo(
  videos: ValidatedVideo[],
  options: { logger: Logger; signal?: AbortSignal | undefined },
): Promise<PreparedPlaylist> {
  if (videos.length < 2) {
    throw new AppError('A playlist needs at least two videos.');
  }

  await ensureFfmpegTools();

  const media: MediaInfo[] = [];
  for (let index = 0; index < videos.length; index += 1) {
    const video = videos[index];
    if (video === undefined) continue;
    try {
      media.push(await probeMedia(video.filePath));
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new AppError(`Video ${index + 1} of ${videos.length} could not be read: ${reason}`);
    }
  }

  const target = choosePlaylistTarget(media);
  const filterGraph = buildPlaylistFilterGraph(media, target);
  const totalDuration = media.reduce((sum, input) => sum + input.durationSeconds, 0);
  const temporaryDirectory = await mkdtemp(
    path.join(os.tmpdir(), 'vrchat-local-video-player-playlist-'),
  );
  const outputPath = path.join(temporaryDirectory, 'playlist.mp4');
  const trackedDirectory = registerTemporaryDirectory(temporaryDirectory);
  let cleaned = false;

  const cleanup = async (): Promise<void> => {
    if (cleaned) return;
    cleaned = true;
    trackedDirectory.cleanupSync();
    await rm(temporaryDirectory, { recursive: true, force: true });
  };

  try {
    options.logger.info(
      `Preparing playlist with ${videos.length} videos (${totalDuration.toFixed(1)} seconds)...`,
    );
    await runFfmpeg(
      buildFfmpegArgs(videos, filterGraph, outputPath),
      {
        signal: options.signal,
        totalDuration,
        onProgress: (percent) => options.logger.info(`Playlist encoding: ${percent}%`),
      },
    );

    const outputMedia = await probeMedia(outputPath);
    if (outputMedia.video.codecName !== 'h264' || outputMedia.audio?.codecName !== 'aac') {
      throw new AppError('The generated playlist did not contain the expected H.264/AAC streams.');
    }

    const tolerance = Math.max(2, totalDuration * 0.02);
    if (Math.abs(outputMedia.durationSeconds - totalDuration) > tolerance) {
      throw new AppError('The generated playlist duration did not match the selected videos.');
    }

    const video = await validateVideoFile(outputPath);
    if (video.fastStart !== true) {
      throw new AppError('The generated playlist did not have faststart enabled.');
    }

    options.logger.info(`Playlist ready: ${video.fileName} (${video.size} bytes)`);
    return { video, cleanup };
  } catch (error) {
    await cleanup();
    throw error;
  }
}

function parseStream(stream: RawFfprobeStream, fallbackIndex: number): MediaStreamInfo {
  return {
    index: typeof stream.index === 'number' ? stream.index : fallbackIndex,
    codecType: typeof stream.codec_type === 'string' ? stream.codec_type : 'unknown',
    codecName: typeof stream.codec_name === 'string' ? stream.codec_name : 'unknown',
    width: typeof stream.width === 'number' ? stream.width : null,
    height: typeof stream.height === 'number' ? stream.height : null,
    durationSeconds: positiveNumber(stream.duration),
  };
}

function positiveNumber(value: unknown): number | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const parsed = typeof value === 'number' ? value : Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function ffmpegInstallInstructions(
  platform: NodeJS.Platform = process.platform,
  wsl = isWslEnvironment(),
): string {
  if (platform === 'win32') {
    return [
      'Windows:',
      '1. Open PowerShell.',
      '2. Run:',
      '   winget install --id Gyan.FFmpeg --exact --accept-source-agreements --accept-package-agreements',
      '3. Close and reopen the terminal so the updated PATH is loaded.',
      '4. Verify the installation:',
      '   ffmpeg -version',
      '   ffprobe -version',
      '5. Start the player again.',
    ].join('\n');
  }

  if (platform === 'linux' && wsl) {
    return [
      'WSL2 (Debian/Ubuntu):',
      '1. Open your WSL distribution, for example Ubuntu.',
      '2. Run:',
      '   sudo apt update',
      '   sudo apt install -y ffmpeg',
      '3. Verify the installation:',
      '   ffmpeg -version',
      '   ffprobe -version',
      '4. Start the player again from the same WSL environment.',
    ].join('\n');
  }

  if (platform === 'linux') {
    return [
      'Linux:',
      '1. Open a terminal.',
      '2. Install FFmpeg with your package manager:',
      '   Debian/Ubuntu: sudo apt update && sudo apt install -y ffmpeg',
      '   Fedora/RHEL: sudo dnf install -y ffmpeg',
      '   Arch: sudo pacman -S ffmpeg',
      '3. Verify the installation:',
      '   ffmpeg -version',
      '   ffprobe -version',
      '4. Start the player again.',
    ].join('\n');
  }

  if (platform === 'darwin') {
    return [
      'macOS:',
      '1. Open Terminal.',
      '2. Run:',
      '   brew install ffmpeg',
      '3. Verify the installation:',
      '   ffmpeg -version',
      '   ffprobe -version',
      '4. Start the player again.',
    ].join('\n');
  }

  return [
    'Install FFmpeg and make sure both ffmpeg and ffprobe are available in PATH.',
    'Verify the installation with:',
    '   ffmpeg -version',
    '   ffprobe -version',
  ].join('\n');
}

function isWslEnvironment(): boolean {
  return (
    process.platform === 'linux' &&
    (process.env['WSL_DISTRO_NAME'] !== undefined ||
      process.env['WSL_INTEROP'] !== undefined)
  );
}

async function ensureFfmpegTools(): Promise<void> {
  try {
    await executeFile('ffmpeg', ['-version'], 10_000);
    await executeFile('ffprobe', ['-version'], 10_000);
  } catch {
    throw new AppError(
      'FFmpeg is required to build a playlist.',
      ffmpegInstallInstructions(),
    );
  }
}

async function probeMedia(filePath: string): Promise<MediaInfo> {
  const raw = await executeFile(
    'ffprobe',
    ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', filePath],
    30_000,
  );
  return parseFfprobeOutput(raw);
}

function executeFile(
  command: string,
  args: string[],
  timeout: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      command,
      args,
      { encoding: 'utf8', timeout, windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
      (error, stdoutData, stderrData) => {
        if (error === null) {
          resolve(stdoutData);
          return;
        }
        const detail = stderrData.trim();
        reject(new Error(detail === '' ? error.message : detail));
      },
    );
  });
}

async function runFfmpeg(
  args: string[],
  options: {
    signal?: AbortSignal | undefined;
    totalDuration: number;
    onProgress: (percent: number) => void;
  },
): Promise<void> {
  if (options.signal?.aborted === true) {
    throw new AppError('Playlist preparation was cancelled.');
  }

  await new Promise<void>((resolve, reject) => {
    const child = spawn('ffmpeg', args, {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
    });
    let settled = false;
    let stderr = '';
    let lastProgress = -1;

    const finish = (error?: Error): void => {
      if (settled) return;
      settled = true;
      options.signal?.removeEventListener('abort', onAbort);
      if (error === undefined) {
        resolve();
      } else {
        reject(error);
      }
    };

    const onAbort = (): void => {
      if (child.pid !== undefined) {
        void killProcessTree(child.pid);
      }
    };

    options.signal?.addEventListener('abort', onAbort, { once: true });

    child.stdout?.on('data', (chunk: Buffer | string) => {
      const match = /out_time_us=(\d+)/.exec(String(chunk));
      if (match?.[1] === undefined) return;
      const elapsed = Number.parseInt(match[1], 10);
      if (!Number.isFinite(elapsed) || options.totalDuration <= 0) return;
      const percent = Math.max(0, Math.min(100, Math.floor((elapsed / 1_000_000 / options.totalDuration) * 100)));
      if (percent >= lastProgress + 5) {
        lastProgress = percent;
        options.onProgress(percent);
      }
    });

    child.stderr?.on('data', (chunk: Buffer | string) => {
      stderr = `${stderr}${String(chunk)}`.slice(-64 * 1024);
    });

    child.on('error', (error) => {
      finish(new AppError(`Could not execute FFmpeg: ${error.message}`));
    });

    child.on('close', (code) => {
      if (options.signal?.aborted === true) {
        finish(new AppError('Playlist preparation was cancelled.'));
        return;
      }
      if (code === 0) {
        finish();
        return;
      }
      const detail = stderr.trim();
      finish(
        new AppError(
          `FFmpeg could not build the playlist${detail === '' ? '.' : `: ${detail}`}`,
        ),
      );
    });
  });
}
