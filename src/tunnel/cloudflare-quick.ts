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
 * Starts a Cloudflare quick tunnel
 */
export async function startCloudflareQuickTunnel(options: TunnelOptions): Promise<Tunnel> {
  const { logger } = options;
  const timeoutMs = options.timeoutMs ?? 60_000;
  const args = ['tunnel', '--no-autoupdate', '--url', options.localUrl];

  logger.debug(`Executing: ${options.binaryPath} ${args.join(' ')}`);

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
          'The Cloudflare tunnel did not return a URL in time.',
          'Check your internet connection. If you are using a proxy or firewall, try with --protocol http2 manually.',
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
          `Couldn't execute cloudflared: ${error.message}`,
          'Execute `npm run setup:cloudflared` to download and verify it.',
        ),
      );
    });

    child.on('exit', (code: number | null) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(
          new AppError(
            `cloudflared terminated before creating the tunnel (code ${code ?? 'unknown'}).`,
            'check your internet connection or the firewall/proxy of your network.',
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
