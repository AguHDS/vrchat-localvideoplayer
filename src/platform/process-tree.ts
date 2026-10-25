import { spawn } from 'node:child_process';

export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Terminates a process and every process it spawned
 * Windows uses `taskkill /T`. Linux kills the whole process group
 */
export async function killProcessTree(pid: number): Promise<void> {
  if (!Number.isSafeInteger(pid) || pid <= 0) return;
  if (!isProcessAlive(pid)) return;

  if (process.platform === 'win32') {
    await runCommand('taskkill', ['/PID', String(pid), '/T', '/F']);
    return;
  }

  try {
    process.kill(-pid, 'SIGKILL');
  } catch {
    await runCommand('pkill', ['-P', String(pid), '-9']);
    await runCommand('kill', ['-9', String(pid)]);
  }
}

function runCommand(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve) => {
    try {
      const child = spawn(cmd, args, { windowsHide: true, stdio: 'ignore' });
      child.on('error', () => resolve());
      child.on('close', () => resolve());
    } catch {
      resolve();
    }
  });
}
