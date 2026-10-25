import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AppError } from '../src/errors';
import { validateVideoFile } from '../src/video/validate';

function mp4Box(type: string, payloadSize = 0): Buffer {
  const size = 8 + payloadSize;
  const header = Buffer.alloc(8);
  header.writeUInt32BE(size, 0);
  header.write(type, 4, 4, 'latin1');
  return Buffer.concat([header, Buffer.alloc(payloadSize)]);
}

describe('validateVideoFile', () => {
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'vlvp-validate-'));
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it('accepts a valid mp4', async () => {
    const filePath = path.join(directory, 'movie.mp4');
    await writeFile(
      filePath,
      Buffer.concat([mp4Box('ftyp', 8), mp4Box('moov', 16), mp4Box('mdat', 56)]),
    );

    const video = await validateVideoFile(filePath);
    expect(video.extension).toBe('.mp4');
    expect(video.mimeType).toBe('video/mp4');
    expect(video.fastStart).toBe(true);
  });

  it('detects mp4 files without fast start', async () => {
    const filePath = path.join(directory, 'slow.mp4');
    await writeFile(
      filePath,
      Buffer.concat([mp4Box('ftyp', 8), mp4Box('mdat', 56), mp4Box('moov', 16)]),
    );

    const video = await validateVideoFile(filePath);
    expect(video.fastStart).toBe(false);
  });

  it('accepts webm files', async () => {
    const filePath = path.join(directory, 'movie.webm');
    await writeFile(filePath, Buffer.alloc(128));
    const video = await validateVideoFile(filePath);
    expect(video.mimeType).toBe('video/webm');
  });

  it('rejects unknown extensions', async () => {
    const filePath = path.join(directory, 'movie.avi');
    await writeFile(filePath, Buffer.alloc(128));
    await expect(validateVideoFile(filePath)).rejects.toBeInstanceOf(AppError);
  });

  it('rejects missing files', async () => {
    await expect(validateVideoFile(path.join(directory, 'nope.mp4'))).rejects.toBeInstanceOf(AppError);
  });

  it('rejects empty files', async () => {
    const filePath = path.join(directory, 'empty.mp4');
    await writeFile(filePath, Buffer.alloc(0));
    await expect(validateVideoFile(filePath)).rejects.toBeInstanceOf(AppError);
  });
});
