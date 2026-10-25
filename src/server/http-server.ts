import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import type { Logger } from '../logger';
import { formatContentRange, parseRangeHeader } from './range';
import { matchesVideoPath, type VideoSession } from './session';

export interface VideoServerOptions {
  session: VideoSession;
  logger: Logger;
  host?: string;
  port?: number;
}

export interface VideoServer {
  host: string;
  port: number;
  url: string;
  bytesServed: number;
  close: () => Promise<void>;
}

export async function startVideoServer(options: VideoServerOptions): Promise<VideoServer> {
  const { session, logger } = options;
  const host = options.host ?? '127.0.0.1';
  let bytesServed = 0;

  const server: Server = createServer((req, res) => {
    void handleRequest(req, res).catch((error: unknown) => {
      logger.error(`Error inesperado al atender una petición: ${describe(error)}`);
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
  });

  async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const pathname = url.pathname;

    if (!matchesVideoPath(pathname, session.token, session.extension)) {
      res.writeHead(404, {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-store',
      });
      res.end('Not found\n');
      return;
    }

    const method = (req.method ?? 'GET').toUpperCase();
    if (method !== 'GET' && method !== 'HEAD') {
      res.writeHead(405, { Allow: 'GET, HEAD' });
      res.end();
      return;
    }

    let size = session.size;
    let mtimeMs = session.mtimeMs;
    try {
      const stats = await stat(session.filePath);
      size = stats.size;
      mtimeMs = stats.mtimeMs;
    } catch {
      logger.warn('No se pudo refrescar la metadata del archivo, se usan los valores de inicio.');
    }

    const headers: Record<string, string> = {
      'Accept-Ranges': 'bytes',
      'Content-Type': session.mimeType,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      'Last-Modified': new Date(mtimeMs).toUTCString(),
      ETag: `"${size.toString(16)}-${Math.floor(mtimeMs).toString(16)}"`,
    };

    const range = parseRangeHeader(req.headers.range, size);

    if (range.kind === 'unsatisfiable') {
      res.writeHead(416, { ...headers, 'Content-Range': `bytes */${size}` });
      res.end();
      return;
    }

    const partial = range.kind === 'partial';
    const start = partial ? range.start : 0;
    const end = partial ? range.end : Math.max(size - 1, 0);
    const length = size === 0 ? 0 : end - start + 1;

    const responseHeaders: Record<string, string> = {
      ...headers,
      'Content-Length': String(length),
    };
    if (partial) responseHeaders['Content-Range'] = formatContentRange(start, end, size);

    res.writeHead(partial ? 206 : 200, responseHeaders);

    if (method === 'HEAD') {
      res.end();
      return;
    }

    const stream = createReadStream(session.filePath, { start, end });
    stream.on('data', (chunk: string | Buffer) => {
      bytesServed += typeof chunk === 'string' ? Buffer.byteLength(chunk) : chunk.length;
    });
    stream.on('error', (error: unknown) => {
      logger.error(`Error leyendo el video: ${describe(error)}`);
      res.destroy();
    });
    res.on('close', () => {
      stream.destroy();
    });
    stream.pipe(res);
  }

  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error): void => reject(error);
    server.once('error', onError);
    server.listen(options.port ?? 0, host, () => {
      server.off('error', onError);
      resolve();
    });
  });

  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : (options.port ?? 0);
  const url = `http://${host}:${port}`;

  return {
    host,
    port,
    url,
    get bytesServed() {
      return bytesServed;
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections?.();
      }),
  };
}

function describe(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
