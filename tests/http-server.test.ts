import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Logger } from '../src/logger';
import { startVideoServer, type VideoServer } from '../src/server/http-server';
import { createToken, videoPath, type VideoSession } from '../src/server/session';

const PAYLOAD = Buffer.from('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ');

describe('video http server', () => {
  let directory: string;
  let filePath: string;
  let server: VideoServer;
  let session: VideoSession;
  let url: string;

  beforeAll(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'vlvp-test-'));
    filePath = path.join(directory, 'sample.mp4');
    await writeFile(filePath, PAYLOAD);

    session = {
      token: createToken(),
      filePath,
      fileName: 'sample.mp4',
      extension: '.mp4',
      mimeType: 'video/mp4',
      size: PAYLOAD.length,
      mtimeMs: Date.now(),
    };

    server = await startVideoServer({
      session,
      logger: new Logger({ level: 'error' }),
    });
    url = `${server.url}${videoPath(session.token, session.extension)}`;
  });

  afterAll(async () => {
    await server.close();
    await rm(directory, { recursive: true, force: true });
  });

  it('serves the whole file with range support advertised', async () => {
    const response = await fetch(url);
    expect(response.status).toBe(200);
    expect(response.headers.get('accept-ranges')).toBe('bytes');
    expect(response.headers.get('content-type')).toBe('video/mp4');
    expect(response.headers.get('content-length')).toBe(String(PAYLOAD.length));
    const body = Buffer.from(await response.arrayBuffer());
    expect(body.equals(PAYLOAD)).toBe(true);
  });

  it('answers HEAD without a body', async () => {
    const response = await fetch(url, { method: 'HEAD' });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-length')).toBe(String(PAYLOAD.length));
    expect((await response.arrayBuffer()).byteLength).toBe(0);
  });

  it('answers 206 for a closed range', async () => {
    const response = await fetch(url, { headers: { Range: 'bytes=0-9' } });
    expect(response.status).toBe(206);
    expect(response.headers.get('content-range')).toBe(`bytes 0-9/${PAYLOAD.length}`);
    expect(response.headers.get('content-length')).toBe('10');
    const body = Buffer.from(await response.arrayBuffer());
    expect(body.equals(PAYLOAD.subarray(0, 10))).toBe(true);
  });

  it('answers 206 for an open ended range', async () => {
    const response = await fetch(url, { headers: { Range: 'bytes=30-' } });
    expect(response.status).toBe(206);
    expect(response.headers.get('content-range')).toBe(`bytes 30-${PAYLOAD.length - 1}/${PAYLOAD.length}`);
    const body = Buffer.from(await response.arrayBuffer());
    expect(body.equals(PAYLOAD.subarray(30))).toBe(true);
  });

  it('answers 206 for a suffix range', async () => {
    const response = await fetch(url, { headers: { Range: 'bytes=-5' } });
    expect(response.status).toBe(206);
    const body = Buffer.from(await response.arrayBuffer());
    expect(body.equals(PAYLOAD.subarray(PAYLOAD.length - 5))).toBe(true);
  });

  it('answers 416 for an unsatisfiable range', async () => {
    const response = await fetch(url, { headers: { Range: 'bytes=9999-' } });
    expect(response.status).toBe(416);
    expect(response.headers.get('content-range')).toBe(`bytes */${PAYLOAD.length}`);
  });

  it('does not expose any other path', async () => {
    expect((await fetch(`${server.url}/`)).status).toBe(404);
    expect((await fetch(`${server.url}/etc/passwd`)).status).toBe(404);
    expect((await fetch(`${server.url}/v/otro-token/video.mp4`)).status).toBe(404);
    expect((await fetch(`${server.url}/v/${session.token}/video.mp4/../../secret`)).status).toBe(404);
  });

  it('rejects other HTTP methods', async () => {
    const response = await fetch(url, { method: 'POST' });
    expect(response.status).toBe(405);
  });
});
