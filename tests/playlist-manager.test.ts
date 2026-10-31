import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Logger } from '../src/logger';
import { PlaylistManager, type PlaylistBuilder } from '../src/video/playlist-manager';
import type { ValidatedVideo } from '../src/video/validate';

function video(filePath: string, name: string): ValidatedVideo {
  return {
    filePath,
    fileName: name,
    extension: '.mp4',
    mimeType: 'video/mp4',
    size: 10,
    mtimeMs: 0,
    fastStart: true,
  };
}

describe('PlaylistManager', () => {
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'vlvp-manager-'));
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it('serves a single video without creating a temporary file', async () => {
    const filePath = path.join(directory, 'one.mp4');
    await writeFile(filePath, Buffer.alloc(1));
    let prepared = 0;
    const manager = new PlaylistManager({
      logger: new Logger({ level: 'error' }),
      prepare: async () => {
        prepared += 1;
        throw new Error('should not be called');
      },
    });

    const change = await manager.start([filePath]);
    expect(prepared).toBe(0);
    expect(change.build.cleanup).toBeNull();
    expect(change.build.video.filePath).toBe(filePath);
    expect(change.build.session.token.length).toBeGreaterThanOrEqual(32);
  });

  it('replaces the previous videos when a new playlist is selected', async () => {
    const first = path.join(directory, 'one.mp4');
    const second = path.join(directory, 'two.mp4');
    const third = path.join(directory, 'three.mp4');
    await writeFile(first, Buffer.alloc(1));
    await writeFile(second, Buffer.alloc(1));
    await writeFile(third, Buffer.alloc(1));

    const builder: PlaylistBuilder = async () => ({
      video: video(path.join(directory, 'playlist.mp4'), 'playlist.mp4'),
      cleanup: async () => undefined,
    });
    const manager = new PlaylistManager({
      logger: new Logger({ level: 'error' }),
      prepare: builder,
    });

    const initial = await manager.start([first, second]);
    const change = await manager.replace([third]);

    expect(manager.sourceCount).toBe(1);
    expect(change.added).toHaveLength(1);
    expect(change.build.session.token).not.toBe(initial.build.session.token);
    expect(manager.list()).toHaveLength(1);
    expect(manager.list()[0]).toContain('three.mp4');
  });

  it('keeps the previous sources when the new selection is invalid', async () => {
    const first = path.join(directory, 'one.mp4');
    await writeFile(first, Buffer.alloc(1));

    const manager = new PlaylistManager({
      logger: new Logger({ level: 'error' }),
      prepare: async () => {
        throw new Error('should not be called');
      },
    });

    await manager.start([first]);
    await expect(manager.replace([path.join(directory, 'missing.mp4')])).rejects.toThrow();
    expect(manager.sourceCount).toBe(1);
  });

  it('randomizes the order of the videos in a playlist', async () => {
    const first = path.join(directory, 'one.mp4');
    const second = path.join(directory, 'two.mp4');
    const third = path.join(directory, 'three.mp4');
    await writeFile(first, Buffer.alloc(1));
    await writeFile(second, Buffer.alloc(1));
    await writeFile(third, Buffer.alloc(1));

    const manager = new PlaylistManager({
      logger: new Logger({ level: 'error' }),
      random: () => 0,
      prepare: async () => ({
        video: video(path.join(directory, 'playlist.mp4'), 'playlist.mp4'),
        cleanup: async () => undefined,
      }),
    });

    await manager.start([first, second, third]);
    expect(manager.list().map((line) => line.split(' ')[1])).toEqual([
      'two.mp4',
      'three.mp4',
      'one.mp4',
    ]);
  });

  it('keeps the order of a single video', async () => {
    const only = path.join(directory, 'only.mp4');
    await writeFile(only, Buffer.alloc(1));

    const manager = new PlaylistManager({
      logger: new Logger({ level: 'error' }),
      random: () => 0,
    });

    await manager.start([only]);
    expect(manager.list()[0]).toContain('only.mp4');
  });

  it('runs every temporary cleanup on dispose', async () => {
    const first = path.join(directory, 'one.mp4');
    const second = path.join(directory, 'two.mp4');
    const third = path.join(directory, 'three.mp4');
    const fourth = path.join(directory, 'four.mp4');
    await writeFile(first, Buffer.alloc(1));
    await writeFile(second, Buffer.alloc(1));
    await writeFile(third, Buffer.alloc(1));
    await writeFile(fourth, Buffer.alloc(1));

    let cleaned = 0;
    const manager = new PlaylistManager({
      logger: new Logger({ level: 'error' }),
      prepare: async () => ({
        video: video(path.join(directory, 'playlist.mp4'), 'playlist.mp4'),
        cleanup: async () => {
          cleaned += 1;
        },
      }),
    });

    await manager.start([first, second]);
    await manager.replace([third, fourth]);
    expect(cleaned).toBe(0);

    await manager.dispose();
    expect(cleaned).toBe(2);
  });
});
