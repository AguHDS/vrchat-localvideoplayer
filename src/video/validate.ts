import { stat } from 'node:fs/promises';
import path from 'node:path';
import { AppError } from '../errors';
import type { VideoExtension } from '../server/session';
import { inspectMp4FastStart } from './probe';

const MIME_TYPES: Record<VideoExtension, string> = {
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
};

export interface ValidatedVideo {
  filePath: string;
  fileName: string;
  extension: VideoExtension;
  mimeType: string;
  size: number;
  mtimeMs: number;
  /** null when it cannot be determined */
  fastStart: boolean | null;
}

export async function validateVideoFiles(inputPaths: string[]): Promise<ValidatedVideo[]> {
  if (inputPaths.length === 0) {
    throw new AppError('No video files were specified.');
  }

  const videos: ValidatedVideo[] = [];
  for (let index = 0; index < inputPaths.length; index += 1) {
    const inputPath = inputPaths[index];
    if (inputPath === undefined) continue;
    try {
      videos.push(await validateVideoFile(inputPath));
    } catch (error) {
      if (error instanceof AppError) {
        throw new AppError(
          `Video ${index + 1} of ${inputPaths.length} is invalid (${inputPath}): ${error.message}`,
          error.hint,
        );
      }
      throw error;
    }
  }
  return videos;
}

export async function validateVideoFile(inputPath: string): Promise<ValidatedVideo> {
  const filePath = path.resolve(inputPath);

  let stats;
  try {
    stats = await stat(filePath);
  } catch {
    throw new AppError(
      `File not found: ${filePath}`,
      'Check the route again. You can also drag the file over the console or use --file "<ruta>".',
    );
  }

  if (!stats.isFile()) {
    throw new AppError(`The path is not a file: ${filePath}`);
  }

  if (stats.size === 0) {
    throw new AppError(`The file is empty: ${videoFileName(filePath)}`);
  }

  const extension = path.extname(filePath).toLowerCase();
  if (extension !== '.mp4' && extension !== '.webm') {
    throw new AppError(
      `Unsupported extension: "${extension || 'no extension'}"`,
      'VRChat plays .mp4 (H.264 + AAC) and .webm (VP8/VP9 + Opus).',
    );
  }

  const fastStart = extension === '.mp4' ? await inspectMp4FastStart(filePath) : null;

  return {
    filePath,
    fileName: path.basename(filePath),
    extension,
    mimeType: MIME_TYPES[extension],
    size: stats.size,
    mtimeMs: stats.mtimeMs,
    fastStart,
  };
}

function videoFileName(filePath: string): string {
  return path.basename(filePath);
}
