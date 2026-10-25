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
  /** null when it cannot be determined (e.g. webm). */
  fastStart: boolean | null;
}

export async function validateVideoFile(inputPath: string): Promise<ValidatedVideo> {
  const filePath = path.resolve(inputPath);

  let stats;
  try {
    stats = await stat(filePath);
  } catch {
    throw new AppError(
      `No se encontró el archivo: ${filePath}`,
      'Revisá la ruta. Podés arrastrar el archivo sobre la consola o usar --file "<ruta>".',
    );
  }

  if (!stats.isFile()) {
    throw new AppError(`La ruta no es un archivo: ${filePath}`);
  }

  if (stats.size === 0) {
    throw new AppError(`El archivo está vacío: ${videoFileName(filePath)}`);
  }

  const extension = path.extname(filePath).toLowerCase();
  if (extension !== '.mp4' && extension !== '.webm') {
    throw new AppError(
      `Extensión no soportada: "${extension || 'sin extensión'}"`,
      'VRChat reproduce .mp4 (H.264 + AAC) y .webm (VP8/VP9 + Opus).',
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
