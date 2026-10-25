import { execFile } from 'node:child_process';
import { open } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';

export interface Box {
  type: string;
  size: number;
  headerSize: number;
  start: number;
  dataStart: number;
}

export interface VideoInfo {
  durationSeconds: number | null;
  /** Average bitrate of the container in megabits per second. */
  bitrateMbps: number | null;
  videoCodec: string | null;
  audioCodec: string | null;
  source: 'ffprobe' | 'mp4';
}

/**
 * Inspects the top level MP4 boxes to find out whether the `moov` atom
 * (the index that a player needs to start decoding) is stored before the
 * `mdat` atom (the media payload).
 *
 * `moov` before `mdat` is what "fast start" means and it is what allows a
 * player to start playing and to seek without downloading the whole file.
 *
 * @returns true = fast start, false = not fast start, null = unknown.
 */
export async function inspectMp4FastStart(filePath: string): Promise<boolean | null> {
  let handle;
  try {
    handle = await open(filePath, 'r');
  } catch {
    return null;
  }

  try {
    const stats = await handle.stat();
    let position = 0;
    let moovOffset: number | null = null;
    let mdatOffset: number | null = null;
    let boxes = 0;

    while (position < stats.size && boxes < 10_000) {
      const box = await readBoxHeader(handle, position, stats.size);
      if (box === null) break;

      if (box.type === 'moov' && moovOffset === null) moovOffset = position;
      if (box.type === 'mdat' && mdatOffset === null) mdatOffset = position;
      if (moovOffset !== null && mdatOffset !== null) break;

      position += box.size;
      boxes += 1;
    }

    if (moovOffset === null) return null;
    if (mdatOffset === null) return true;
    return moovOffset < mdatOffset;
  } catch {
    return null;
  } finally {
    await handle.close().catch(() => undefined);
  }
}

/**
 * Reads duration and codecs of the selected video.
 *
 * Uses ffprobe when it is available (exact values), otherwise falls back to
 * the MP4 box parser (duration + codec fourcc).
 */
export async function inspectVideo(
  filePath: string,
  size: number,
  extension: '.mp4' | '.webm',
): Promise<VideoInfo | null> {
  const withFfprobe = await probeWithFfprobe(filePath);
  if (withFfprobe !== null) return withFfprobe;

  if (extension !== '.mp4') return null;

  let handle;
  try {
    handle = await open(filePath, 'r');
  } catch {
    return null;
  }

  try {
    const stats = await handle.stat();
    const durationSeconds = await readMp4Duration(handle, stats.size);
    const codecs = await readMp4Codecs(handle, stats.size);
    const bitrateMbps =
      durationSeconds !== null && durationSeconds > 0
        ? (size * 8) / durationSeconds / 1_000_000
        : null;

    return {
      durationSeconds,
      bitrateMbps,
      videoCodec: codecs.video,
      audioCodec: codecs.audio,
      source: 'mp4',
    };
  } catch {
    return null;
  } finally {
    await handle.close().catch(() => undefined);
  }
}

/** Uses ffprobe when installed. Returns null when it is not available. */
export async function probeWithFfprobe(filePath: string): Promise<VideoInfo | null> {
  const args = [
    '-v',
    'quiet',
    '-print_format',
    'json',
    '-show_format',
    '-show_streams',
    filePath,
  ];

  const output = await new Promise<string | null>((resolve) => {
    execFile(
      'ffprobe',
      args,
      { maxBuffer: 4 * 1024 * 1024, timeout: 30_000, windowsHide: true },
      (error, stdoutData) => {
        resolve(error ? null : stdoutData);
      },
    );
  });

  if (output === null || output.trim() === '') return null;

  try {
    const parsed = JSON.parse(output) as {
      format?: { duration?: string; bit_rate?: string };
      streams?: Array<{ codec_type?: string; codec_name?: string }>;
    };
    const format = parsed.format ?? {};
    const streams = parsed.streams ?? [];
    const videoStream = streams.find((stream) => stream.codec_type === 'video');
    const audioStream = streams.find((stream) => stream.codec_type === 'audio');

    const duration = Number(format.duration);
    const bitrate = Number(format.bit_rate);

    return {
      durationSeconds: Number.isFinite(duration) && duration > 0 ? duration : null,
      bitrateMbps: Number.isFinite(bitrate) && bitrate > 0 ? bitrate / 1_000_000 : null,
      videoCodec: videoStream?.codec_name ?? null,
      audioCodec: audioStream?.codec_name ?? null,
      source: 'ffprobe',
    };
  } catch {
    return null;
  }
}

/** Reads the duration in seconds from the `mvhd` box. */
export async function readMp4Duration(
  handle: FileHandle,
  fileSize: number,
): Promise<number | null> {
  const moov = await findTopLevelBox(handle, 'moov', fileSize);
  if (moov === null) return null;

  const mvhd = await findChildBox(handle, moov, 'mvhd', fileSize);
  if (mvhd === null) return null;

  const data = Buffer.alloc(32);
  const { bytesRead } = await handle.read(data, 0, 32, mvhd.dataStart);
  if (bytesRead < 20) return null;

  const version = data.readUInt8(0);

  if (version === 1) {
    if (bytesRead < 32) return null;
    const timescale = data.readUInt32BE(20);
    const duration = Number(data.readBigUInt64BE(24));
    if (timescale === 0) return null;
    return duration / timescale;
  }

  const timescale = data.readUInt32BE(12);
  const duration = data.readUInt32BE(16);
  if (timescale === 0) return null;
  return duration / timescale;
}

/** Reads the video and audio codec identifiers from the track headers. */
export async function readMp4Codecs(
  handle: FileHandle,
  fileSize: number,
): Promise<{ video: string | null; audio: string | null }> {
  const moov = await findTopLevelBox(handle, 'moov', fileSize);
  if (moov === null) return { video: null, audio: null };

  let video: string | null = null;
  let audio: string | null = null;
  let position = moov.dataStart;
  const end = moov.start + moov.size;

  while (position < end) {
    const trak = await readBoxHeader(handle, position, fileSize);
    if (trak === null) break;

    if (trak.type === 'trak') {
      const mdia = await findChildBox(handle, trak, 'mdia', fileSize);
      if (mdia !== null) {
        const hdlr = await findChildBox(handle, mdia, 'hdlr', fileSize);
        const handlerType =
          hdlr === null ? null : await readAscii(handle, hdlr.dataStart + 8, 4);
        const codec = await readTrackCodec(handle, mdia, fileSize);

        if (handlerType === 'vide') video = codec ?? video;
        else if (handlerType === 'soun') audio = codec ?? audio;
      }
    }

    if (trak.size <= 0) break;
    position += trak.size;
  }

  return { video, audio };
}

/**
 * Checks whether a codec identifier is known to work with the VRChat video
 * players. Returns null when the codec could not be determined.
 */
export function isVideoCodecSupported(codec: string | null): boolean | null {
  if (codec === null) return null;
  const value = codec.toLowerCase();

  if (value.startsWith('avc1') || value.startsWith('avc3') || value.startsWith('h264')) {
    return true;
  }
  if (
    value.startsWith('vp09') ||
    value.startsWith('vp08') ||
    value.startsWith('vp9') ||
    value.startsWith('vp8')
  ) {
    return true;
  }
  if (value.startsWith('hvc1') || value.startsWith('hev1') || value.startsWith('hevc')) {
    return false;
  }
  if (value.startsWith('av01') || value.startsWith('av1')) return false;
  if (value.startsWith('mp4v') || value.startsWith('mpeg4')) return false;

  return null;
}

export function isAudioCodecSupported(codec: string | null): boolean | null {
  if (codec === null) return null;
  const value = codec.toLowerCase();

  if (value.startsWith('mp4a') || value.startsWith('aac')) return true;
  if (value.startsWith('opus')) return true;
  if (value.startsWith('ac-3') || value.startsWith('ac3')) return true;

  return null;
}

async function readTrackCodec(
  handle: FileHandle,
  mdia: Box,
  fileSize: number,
): Promise<string | null> {
  const minf = await findChildBox(handle, mdia, 'minf', fileSize);
  if (minf === null) return null;

  const stbl = await findChildBox(handle, minf, 'stbl', fileSize);
  if (stbl === null) return null;

  const stsd = await findChildBox(handle, stbl, 'stsd', fileSize);
  if (stsd === null) return null;

  // stsd payload: version+flags (4) + entry_count (4) + sample entry size (4) + format (4)
  const buffer = Buffer.alloc(16);
  const { bytesRead } = await handle.read(buffer, 0, 16, stsd.dataStart);
  if (bytesRead < 16) return null;

  return buffer.toString('latin1', 12, 16);
}

async function readAscii(
  handle: FileHandle,
  position: number,
  length: number,
): Promise<string | null> {
  const buffer = Buffer.alloc(length);
  const { bytesRead } = await handle.read(buffer, 0, length, position);
  if (bytesRead < length) return null;
  return buffer.toString('latin1', 0, length);
}

async function readBoxHeader(
  handle: FileHandle,
  position: number,
  fileSize: number,
): Promise<Box | null> {
  const header = Buffer.alloc(16);
  const { bytesRead } = await handle.read(header, 0, 16, position);
  if (bytesRead < 8) return null;

  const declaredSize = header.readUInt32BE(0);
  const type = header.toString('latin1', 4, 8);
  let headerSize = 8;
  let size = declaredSize;

  if (declaredSize === 1) {
    if (bytesRead < 16) return null;
    size = Number(header.readBigUInt64BE(8));
    headerSize = 16;
  } else if (declaredSize === 0) {
    size = fileSize - position;
  }

  if (!Number.isSafeInteger(size) || size < headerSize) return null;

  return { type, size, headerSize, start: position, dataStart: position + headerSize };
}

async function findTopLevelBox(
  handle: FileHandle,
  type: string,
  fileSize: number,
): Promise<Box | null> {
  let position = 0;

  while (position < fileSize) {
    const box = await readBoxHeader(handle, position, fileSize);
    if (box === null) return null;
    if (box.type === type) return box;
    if (box.size <= 0) return null;
    position += box.size;
  }

  return null;
}

async function findChildBox(
  handle: FileHandle,
  parent: Box,
  type: string,
  fileSize: number,
): Promise<Box | null> {
  let position = parent.dataStart;
  const end = parent.start + parent.size;

  while (position < end) {
    const box = await readBoxHeader(handle, position, fileSize);
    if (box === null) return null;
    if (box.type === type) return box;
    if (box.size <= 0) return null;
    position += box.size;
  }

  return null;
}
