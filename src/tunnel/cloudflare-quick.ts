import { spawn } from 'node:child_process';
import { AppError } from '../errors';
import type { Logger } from '../logger';
import { killProcessTree } from '../platform/process-tree';
import { isValidTunnelUrl, parseTunnelUrl } from './parse-tunnel-url';

export interface TunnelOptions {
  localUrl: string;
  binaryPath: string;
  logger: Logger;
  timeoutMs?: number;
  onUnexpectedExit?: (code: number | null) => void;
}

export interface Tunnel {
  baseUrl: string;
  pid: number | undefined;
  stop: () => Promise<void>;
}

/**
 * Starts a Cloudflare Quick Tunnel: a temporary public HTTPS URL that
 * forwards to the local http server. No account and no domain required.
 */
export async function startCloudflareQuickTunnel(options: TunnelOptions): Promise<Tunnel> {
  const { logger } = options;
  const timeoutMs = options.timeoutMs ?? 60_000;
  const args = ['tunnel', '--no-autoupdate', '--url', options.localUrl];

  logger.debug(`Ejecutando: ${options.binaryPath} ${args.join(' ')}`);

  const child = spawn(options.binaryPath, args, {
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
  });

  let settled = false;
  let stopping = false;
  let baseUrl: string;

  const baseUrlPromise = new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(
        new AppError(
          'El túnel de Cloudflare no entregó una URL a tiempo.',
          'Revisá tu conexión a internet. Si usás proxy o firewall, probá con --protocol http2 en forma manual.',
        ),
      );
    }, timeoutMs);

    const onData = (chunk: Buffer): void => {
      const text = chunk.toString('utf8');
      logger.debug(`[cloudflared] ${text.trimEnd()}`);
      if (settled) return;
      const found = parseTunnelUrl(text);
      if (found && isValidTunnelUrl(found)) {
        settled = true;
        clearTimeout(timer);
        resolve(found);
      }
    };

    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);

    child.on('error', (error: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(
        new AppError(
          `No se pudo ejecutar cloudflared: ${error.message}`,
          'Ejecutá `npm run setup:cloudflared` para descargarlo y verificarlo.',
        ),
      );
    });

    child.on('exit', (code: number | null) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(
          new AppError(
            `cloudflared terminó antes de crear el túnel (código ${code ?? 'desconocido'}).`,
            'Revisá tu conexión a internet o el firewall/proxy de tu red.',
          ),
        );
        return;
      }
      if (stopping) return;
      options.onUnexpectedExit?.(code);
    });
  });

  try {
    baseUrl = await baseUrlPromise;
  } catch (error) {
    if (child.pid !== undefined) await killProcessTree(child.pid);
    throw error;
  }

  const url = baseUrl;

  return {
    baseUrl: url,
    pid: child.pid,
    stop: async () => {
      stopping = true;
      if (child.pid !== undefined) {
        await killProcessTree(child.pid);
      }
    },
  };
}
