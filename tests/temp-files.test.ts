import { access, mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  cleanupStaleTemporaryDirectories,
  registerTemporaryDirectory,
} from '../src/lifecycle/temp-files';

describe('temporary directories', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'vlvp-temp-test-'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('removes directories owned by a dead process', async () => {
    const directory = path.join(root, 'vrchat-local-video-player-dead');
    await mkdir(directory);
    await writeFile(path.join(directory, '.owner-pid'), '99999999');

    expect(cleanupStaleTemporaryDirectories(root)).toBe(1);
    await expect(access(directory)).rejects.toThrow();
  });

  it('keeps directories owned by a running process', async () => {
    const directory = path.join(root, 'vrchat-local-video-player-alive');
    await mkdir(directory);
    await writeFile(path.join(directory, '.owner-pid'), String(process.pid));

    expect(cleanupStaleTemporaryDirectories(root)).toBe(0);
    await expect(access(directory)).resolves.toBeUndefined();
  });

  it('removes old directories without an owner marker', async () => {
    const directory = path.join(root, 'vrchat-local-video-player-legacy');
    await mkdir(directory);
    const old = new Date(Date.now() - 2 * 60 * 60 * 1000);
    await utimes(directory, old, old);

    expect(cleanupStaleTemporaryDirectories(root)).toBe(1);
    await expect(access(directory)).rejects.toThrow();
  });

  it('removes a tracked directory synchronously', async () => {
    const directory = path.join(root, 'vrchat-local-video-player-tracked');
    await mkdir(directory);
    const tracked = registerTemporaryDirectory(directory);

    tracked.cleanupSync();
    await expect(access(directory)).rejects.toThrow();
  });
});
