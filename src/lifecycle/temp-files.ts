import {
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isProcessAlive } from '../platform/process-tree';

const TEMP_DIRECTORY_PREFIX = 'vrchat-local-video-player-';
const OWNER_FILE = '.owner-pid';
const LEGACY_TEMP_MAX_AGE_MS = 60 * 60 * 1000;

export interface TrackedTemporaryDirectory {
  unregister: () => void;
  cleanupSync: () => void;
}

const trackedDirectories = new Map<string, TrackedTemporaryDirectory>();
let exitHandlerInstalled = false;

export function registerTemporaryDirectory(directory: string): TrackedTemporaryDirectory {
  const tracked: TrackedTemporaryDirectory = {
    unregister: () => {
      trackedDirectories.delete(directory);
    },
    cleanupSync: () => {
      trackedDirectories.delete(directory);
      try {
        rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
      } catch {
        return;
      }
    },
  };

  trackedDirectories.set(directory, tracked);
  try {
    writeFileSync(path.join(directory, OWNER_FILE), String(process.pid), 'utf8');
  } catch (error) {
    void error;
  }

  if (!exitHandlerInstalled) {
    exitHandlerInstalled = true;
    process.once('exit', cleanupTrackedDirectoriesSync);
  }

  return tracked;
}

export function cleanupTrackedDirectoriesSync(): void {
  for (const tracked of [...trackedDirectories.values()]) {
    tracked.cleanupSync();
  }
}

export function cleanupStaleTemporaryDirectories(root = os.tmpdir()): number {
  let removed = 0;

  try {
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory() || !entry.name.startsWith(TEMP_DIRECTORY_PREFIX)) continue;
      const directory = path.join(root, entry.name);
      const ownerPid = readOwnerPid(directory);
      if (ownerPid !== null && isProcessAlive(ownerPid)) continue;
      if (ownerPid === null && !isLegacyDirectoryExpired(directory)) continue;

      try {
        rmSync(directory, { recursive: true, force: true });
        removed += 1;
      } catch {
        continue;
      }
    }
  } catch {
    return removed;
  }

  return removed;
}

function readOwnerPid(directory: string): number | null {
  try {
    const value = Number.parseInt(readFileSync(path.join(directory, OWNER_FILE), 'utf8'), 10);
    return Number.isSafeInteger(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

function isLegacyDirectoryExpired(directory: string): boolean {
  try {
    return Date.now() - statSync(directory).mtimeMs >= LEGACY_TEMP_MAX_AGE_MS;
  } catch {
    return true;
  }
}
