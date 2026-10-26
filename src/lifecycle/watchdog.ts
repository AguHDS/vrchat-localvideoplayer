import { spawn } from 'node:child_process';
import { rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { isSingleExecutable } from '../platform/sea';
import { isProcessAlive, killProcessTree } from '../platform/process-tree';

export interface WatchdogOptions {
  parentPid: number;
  childPid: number;
  cleanupPath?: string | undefined;
}

/**
 * Spawns a detached helper that kills the tunnel if the main process dies
 */
export function spawnWatchdog(options: WatchdogOptions): void {
  try {
    const child = spawn(process.execPath, watchdogArgs(options), {
      detached: true,
      windowsHide: true,
      stdio: 'ignore',
    });
    child.unref();
  } catch {
    // effort: the normal shutdown path still works
  }
}

function watchdogArgs(options: WatchdogOptions): string[] {
  const tail = ['--internal-watchdog', String(options.parentPid), String(options.childPid)];
  if (options.cleanupPath !== undefined) tail.push(options.cleanupPath);
  if (isSingleExecutable()) return tail;
  const entry = process.argv[1];
  return entry ? [entry, ...tail] : tail;
}

/**
 * Watchdog loop: waits until the parent process disappears and then kills the whole process tree of the tunnel
 */
export async function runWatchdog(
  parentPid: number,
  childPid: number,
  cleanupPath?: string | undefined,
): Promise<void> {
  for (; ;) {
    if (!isProcessAlive(parentPid)) {
      await killProcessTree(childPid);
      if (cleanupPath !== undefined && isSafeCleanupPath(cleanupPath)) {
        await rm(cleanupPath, {
          recursive: true,
          force: true,
          maxRetries: 10,
          retryDelay: 100,
        }).catch(() => undefined);
      }
      return;
    }
    if (!isProcessAlive(childPid)) {
      return;
    }
    await delay(400);
  }
}

/** Checks if the cleanup path is safe to use (for temporary files) */
function isSafeCleanupPath(cleanupPath: string): boolean {
  const temporaryRoot = path.resolve(os.tmpdir());
  const resolved = path.resolve(cleanupPath);
  const relative = path.relative(temporaryRoot, resolved);
  return (
    relative !== '' &&
    !relative.includes(path.sep) &&
    !path.isAbsolute(relative) &&
    path.basename(resolved).startsWith('vrchat-local-video-player-')
  );
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
