import { chmod, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { AppError } from '../errors';
import { registerTemporaryDirectory } from '../lifecycle/temp-files';
import type { Logger } from '../logger';
import { isSingleExecutable, loadSea } from './sea';

export interface CloudflaredBinary {
  path: string;
  version: string;
  temporaryDirectory?: string | undefined;
  cleanup: () => Promise<void>;
}

/**
 * Root of the installation:
 * - single executable: the folder that contains the .exe
 * - development: the repository root (one level above src or dist)
 */
export function appRoot(): string {
  if (isSingleExecutable()) return path.dirname(process.execPath);
  const entry = process.argv[1];
  if (!entry) return process.cwd();
  return path.resolve(path.dirname(entry), '..');
}

export async function resolveCloudflaredBinary(logger: Logger): Promise<CloudflaredBinary> {
  const sea = loadSea();

  if (sea !== null && sea.isSea()) {
    return extractEmbeddedCloudflared(sea, logger);
  }

  const fileName = process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared';
  const candidate = path.join(appRoot(), 'vendor', fileName);

  try {
    await stat(candidate);
  } catch {
    throw new AppError(
      'Cloudflared binary not found.',
      'Run `npm run setup:cloudflared` to download and verify it',
    );
  }

  return { path: candidate, version: 'vendor', cleanup: async () => undefined };
}

interface EmbeddedMeta {
  fileName: string;
  version: string;
}

async function extractEmbeddedCloudflared(
  sea: NonNullable<ReturnType<typeof loadSea>>,
  logger: Logger,
): Promise<CloudflaredBinary> {
  let meta: EmbeddedMeta;
  try {
    meta = JSON.parse(sea.getAsset('cloudflared-meta.json', 'utf8')) as EmbeddedMeta;
  } catch (error) {
    throw new AppError(
      `The executable does not include the cloudflared binary: ${String(error)}`,
      'Reconstruct the .exe with `npm run build:exe`.',
    );
  }

  const blob = sea.getAssetAsBlob('cloudflared', { type: 'application/octet-stream' });
  const directory = await mkdtemp(path.join(os.tmpdir(), 'vrchat-local-video-player-'));
  const trackedDirectory = registerTemporaryDirectory(directory);
  const target = path.join(directory, meta.fileName);

  await writeFile(target, Buffer.from(await blob.arrayBuffer()));
  if (process.platform !== 'win32') {
    await chmod(target, 0o755).catch(() => undefined);
  }

  logger.debug(`Cloudflared ${meta.version} extracted to ${target}`);

  return {
    path: target,
    version: meta.version,
    temporaryDirectory: directory,
    cleanup: async () => {
      trackedDirectory.cleanupSync();
      await rm(directory, {
        recursive: true,
        force: true,
        maxRetries: 20,
        retryDelay: 250,
      }).catch(() => undefined);
    },
  };
}
