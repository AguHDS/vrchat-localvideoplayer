import { spawn } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { isProcessAlive, killProcessTree } from '../src/platform/process-tree';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('process tree helpers', () => {
  it('detects running and dead processes', async () => {
    expect(isProcessAlive(process.pid)).toBe(true);
    expect(isProcessAlive(999_999)).toBe(false);
  });

  it('kills a child process tree', async () => {
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
      stdio: 'ignore',
      detached: process.platform !== 'win32',
    });

    await sleep(700);
    const pid = child.pid;
    expect(pid).toBeDefined();
    expect(isProcessAlive(pid as number)).toBe(true);

    await killProcessTree(pid as number);
    await sleep(700);

    expect(isProcessAlive(pid as number)).toBe(false);
  });
});
