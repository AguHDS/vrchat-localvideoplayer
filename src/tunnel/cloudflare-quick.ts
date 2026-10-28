import { spawn } from 'node:child_process';
import { lookup } from 'node:dns/promises';
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

  await assertCloudflareDns();

  logger.debug(`Executing: ${options.binaryPath} ${args.join(' ')}`);

  const child = spawn(options.binaryPath, args, {
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
  });

  let settled = false;
  let stopping = false;
  let stderrTail = '';
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

    const onData = (chunk: Buffer, isError: boolean): void => {
      const text = chunk.toString('utf8');
      if (isError) stderrTail = `${stderrTail}${text}`.slice(-4000);
      logger.debug(`[cloudflared] ${text.trimEnd()}`);
      if (settled) return;
      const found = parseTunnelUrl(text);
      if (found && isValidTunnelUrl(found)) {
        settled = true;
        clearTimeout(timer);
        resolve(found);
      }
    };

    child.stdout?.on('data', (chunk: Buffer) => onData(chunk, false));
    child.stderr?.on('data', (chunk: Buffer) => onData(chunk, true));

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
        const reason = lastErrorLine(stderrTail);
        reject(
          new AppError(
            `cloudflared could not create the tunnel (code ${code ?? 'unknown'})${reason === null ? '.' : `: ${reason}`}`,
            'Check your internet connection, DNS and firewall/proxy. api.trycloudflare.com must resolve; if it does not, use a public DNS such as 1.1.1.1 or 8.8.8.8.',
          ),
        );
        return;
      }
      if (stopping) return;
      const reason = lastErrorLine(stderrTail);
      if (reason !== null) logger.error(`[cloudflared] ${reason}`);
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

async function assertCloudflareDns(): Promise<void> {
  try {
    await lookup('api.trycloudflare.com');
  } catch {
    throw new AppError(
      'Your DNS cannot resolve api.trycloudflare.com, so the tunnel cannot be created.',
      'Change your DNS to a public resolver (1.1.1.1 or 8.8.8.8) and try again. Check the guide in https://github.com/AguHDS/vrchat-localvideoplayer',
    );
  }
}

function lastErrorLine(stderr: string): string | null {
  const lines = stderr
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '');
  const failure = lines.find((line) => /failed|error|refused|denied|no such host/i.test(line));
  const chosen = failure ?? lines[lines.length - 1];
  return chosen === undefined ? null : chosen;
}
