import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { open } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  inspectMp4FastStart,
  isAudioCodecSupported,
  isVideoCodecSupported,
  readMp4Codecs,
  readMp4Duration,
} from '../src/video/probe';

function box(type: string, payload: Buffer): Buffer {
  const header = Buffer.alloc(8);
  header.writeUInt32BE(8 + payload.length, 0);
  header.write(type, 4, 4, 'latin1');
  return Buffer.concat([header, payload]);
}

function mvhd(timescale: number, duration: number): Buffer {
  const payload = Buffer.alloc(100);
  payload.writeUInt8(0, 0);
  payload.writeUInt32BE(timescale, 12);
  payload.writeUInt32BE(duration, 16);
  return box('mvhd', payload);
}

function hdlr(handlerType: string): Buffer {
  const payload = Buffer.alloc(24);
  payload.write(handlerType, 8, 4, 'latin1');
  return box('hdlr', payload);
}

function stsd(format: string): Buffer {
  const payload = Buffer.alloc(16);
  payload.writeUInt32BE(1, 4);
  payload.writeUInt32BE(16, 8);
  payload.write(format, 12, 4, 'latin1');
  return box('stsd', payload);
}

function trak(handlerType: string, format: string): Buffer {
  const mdia = box(
    'mdia',
    Buffer.concat([
      hdlr(handlerType),
      box('minf', box('stbl', stsd(format))),
    ]),
  );
  return box('trak', mdia);
}

function buildMp4(options: {
  timescale: number;
  duration: number;
  payloadSize: number;
  fastStart?: boolean;
}): Buffer {
  const moov = box(
    'moov',
    Buffer.concat([
      mvhd(options.timescale, options.duration),
      trak('vide', 'avc1'),
      trak('soun', 'mp4a'),
    ]),
  );

  const ftyp = box('ftyp', Buffer.alloc(8));
  const mdat = box('mdat', Buffer.alloc(options.payloadSize));

  return options.fastStart === false
    ? Buffer.concat([ftyp, mdat, moov])
    : Buffer.concat([ftyp, moov, mdat]);
}

describe('mp4 probing', () => {
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'vlvp-probe-'));
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it('reads the duration from the mvhd box', async () => {
    const filePath = path.join(directory, 'movie.mp4');
    await writeFile(filePath, buildMp4({ timescale: 1000, duration: 60_000, payloadSize: 512 }));

    const handle = await open(filePath, 'r');
    try {
      const stats = await handle.stat();
      const duration = await readMp4Duration(handle, stats.size);
      expect(duration).toBe(60);
    } finally {
      await handle.close();
    }
  });

  it('reads the video and audio codecs', async () => {
    const filePath = path.join(directory, 'movie.mp4');
    await writeFile(filePath, buildMp4({ timescale: 1000, duration: 60_000, payloadSize: 512 }));

    const handle = await open(filePath, 'r');
    try {
      const stats = await handle.stat();
      const codecs = await readMp4Codecs(handle, stats.size);
      expect(codecs.video).toBe('avc1');
      expect(codecs.audio).toBe('mp4a');
    } finally {
      await handle.close();
    }
  });

  it('detects fast start', async () => {
    const fastPath = path.join(directory, 'fast.mp4');
    await writeFile(
      fastPath,
      buildMp4({ timescale: 1000, duration: 1000, payloadSize: 64, fastStart: true }),
    );
    expect(await inspectMp4FastStart(fastPath)).toBe(true);

    const slowPath = path.join(directory, 'slow.mp4');
    await writeFile(
      slowPath,
      buildMp4({ timescale: 1000, duration: 1000, payloadSize: 64, fastStart: false }),
    );
    expect(await inspectMp4FastStart(slowPath)).toBe(false);
  });
});

describe('codec support', () => {
  it('accepts the codecs VRChat can play', () => {
    expect(isVideoCodecSupported('avc1')).toBe(true);
    expect(isVideoCodecSupported('avc3')).toBe(true);
    expect(isVideoCodecSupported('h264')).toBe(true);
    expect(isVideoCodecSupported('vp09')).toBe(true);
    expect(isVideoCodecSupported('vp9')).toBe(true);
    expect(isVideoCodecSupported('vp8')).toBe(true);
  });

  it('rejects the codecs VRChat cannot play', () => {
    expect(isVideoCodecSupported('hvc1')).toBe(false);
    expect(isVideoCodecSupported('hev1')).toBe(false);
    expect(isVideoCodecSupported('hevc')).toBe(false);
    expect(isVideoCodecSupported('av01')).toBe(false);
    expect(isVideoCodecSupported('mp4v')).toBe(false);
  });

  it('returns null when the codec is unknown', () => {
    expect(isVideoCodecSupported(null)).toBeNull();
    expect(isVideoCodecSupported('xyz')).toBeNull();
  });

  it('checks audio codecs', () => {
    expect(isAudioCodecSupported('mp4a')).toBe(true);
    expect(isAudioCodecSupported('aac')).toBe(true);
    expect(isAudioCodecSupported('opus')).toBe(true);
    expect(isAudioCodecSupported(null)).toBeNull();
  });
});
