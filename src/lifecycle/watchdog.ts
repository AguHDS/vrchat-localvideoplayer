import { spawn } from 'node:child_process';
import { isSingleExecutable } from '../platform/sea';
import { isProcessAlive, killProcessTree } from '../platform/process-tree';

export interface WatchdogOptions {
  parentPid: number;
  childPid: number;
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
  if (isSingleExecutable()) return tail;
  const entry = process.argv[1];
  return entry ? [entry, ...tail] : tail;
}

/**
 * Watchdog loop: waits until the parent process disappears and then kills the whole process tree of the tunnel
 */
export async function runWatchdog(parentPid: number, childPid: number): Promise<void> {
  for (; ;) {
    if (!isProcessAlive(parentPid)) {
      await killProcessTree(childPid);
      return;
    }
    if (!isProcessAlive(childPid)) {
      return;
    }
    await delay(400);
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
