import { Command } from 'commander';
import { startApp, type RunningApp } from './app';
import { AppError } from './errors';
import { runWatchdog } from './lifecycle/watchdog';
import { Logger, type LogLevel } from './logger';

const WATCHDOG_FLAG = '--internal-watchdog';

function collectFile(value: string, previous: string[]): string[] {
  return [...previous, value];
}

export function createProgram(): Command {
  return new Command()
    .name('vrchat-local-video-player')
    .description(
      'Serve local videos from your PC and generate a public HTTPS URL to play them in VRChat.',
    )
    .version('1.0.0')
    .option(
      '-f, --file <path>',
      'Path to a video file. Repeat the option to create a playlist',
      collectFile,
      [],
    )
    .option('--no-picker', 'Do not open the file picker')
    .option('--no-tunnel', 'Do not create a public tunnel (for local testing only)')
    .option(
      '-p, --port <number>',
      'Local port of the HTTP server',
      (value: string) => Number.parseInt(value, 10),
    )
    .option('-v, --verbose', 'Show detailed logs')
    .option('-q, --quiet', 'Show only the URL and errors')
    .option('--log-file <path>', 'Save the session log to a file')
    .option(
      '--viewers <number>',
      'How many viewers will watch (only affects bitrate warnings)',
      (value: string) => Number.parseInt(value, 10),
    )
    .option(
      '--max-upload-mbps <number>',
      'Your upload speed in Mbps (only affects bitrate warnings)',
      (value: string) => Number.parseInt(value, 10),
    );
}

async function main(): Promise<number> {
  const watchdogIndex = process.argv.indexOf(WATCHDOG_FLAG);
  if (watchdogIndex !== -1) {
    const parentPid = Number(process.argv[watchdogIndex + 1]);
    const childPid = Number(process.argv[watchdogIndex + 2]);
    const cleanupPath = process.argv[watchdogIndex + 3];
    if (Number.isSafeInteger(parentPid) && Number.isSafeInteger(childPid)) {
      await runWatchdog(parentPid, childPid, cleanupPath);
    }
    return 0;
  }

  const program = createProgram();
  program.parse(process.argv);
  const options = program.opts();

  const level: LogLevel = options.quiet ? 'warn' : options.verbose ? 'debug' : 'info';
  const logger = new Logger({
    level,
    quiet: Boolean(options.quiet),
    logFile: typeof options.logFile === 'string' ? options.logFile : undefined,
  });

  const files = Array.isArray(options.file)
    ? options.file.filter((value): value is string => typeof value === 'string')
    : typeof options.file === 'string'
      ? [options.file]
      : [];
  const abortController = new AbortController();
  let app: RunningApp | null = null;
  let stopRequested = false;
  let resolveStop = (): void => undefined;
  const stopped = new Promise<void>((resolve) => {
    resolveStop = resolve;
  });

  const requestStop = (): void => {
    if (stopRequested) return;
    stopRequested = true;
    abortController.abort();
    if (app === null) {
      resolveStop();
    } else {
      void app.stop().finally(resolveStop);
    }
  };

  const onData = (chunk: Buffer | string): void => {
    const text = String(chunk).trim().toLowerCase();
    if (text === 'q' || text === 'exit' || text === 'salir') requestStop();
  };

  process.on('SIGINT', requestStop);
  process.on('SIGTERM', requestStop);
  process.on('SIGHUP', requestStop);
  if (process.platform === 'win32') process.on('SIGBREAK', requestStop);
  process.stdin.on('data', onData);
  process.stdin.resume();

  try {
    try {
      app = await startApp({
        files,
        usePicker: options.picker !== false,
        useTunnel: options.tunnel !== false,
        port: typeof options.port === 'number' ? options.port : undefined,
        viewers: typeof options.viewers === 'number' ? options.viewers : 3,
        maxUploadMbps:
          typeof options.maxUploadMbps === 'number' ? options.maxUploadMbps : 60,
        logger,
        signal: abortController.signal,
      });
    } catch (error) {
      if (stopRequested) return 0;
      throw error;
    }

    if (app === null) return 0;
    if (stopRequested) {
      await app.stop();
    } else {
      await stopped;
    }
    return 0;
  } finally {
    process.off('SIGINT', requestStop);
    process.off('SIGTERM', requestStop);
    process.off('SIGHUP', requestStop);
    if (process.platform === 'win32') process.off('SIGBREAK', requestStop);
    process.stdin.off('data', onData);
    process.stdin.pause();
  }
}

main()
  .then((code) => {
    process.exitCode = code;
    const guard = setTimeout(() => {
      process.exit(code);
    }, 2000);
    guard.unref();
  })
  .catch((error: unknown) => {
    const logger = new Logger({ level: 'info' });
    if (error instanceof AppError) {
      logger.error(error.message);
      if (error.hint !== undefined) {
        const [firstLine, ...remainingLines] = error.hint.split('\n');
        logger.error(`Help: ${firstLine ?? ''}`);
        for (const line of remainingLines) logger.error(line);
      }
    } else if (error instanceof Error) {
      logger.error(`Unexpected error: ${error.message}`);
      if (error.stack !== undefined && process.env['DEBUG'] !== undefined) {
        logger.error(error.stack);
      }
    } else {
      logger.error(`Unexpected error: ${String(error)}`);
    }
    process.exitCode = 1;
    logger.info('The window closes in 8 seconds. Read the message above before it disappears.');
    setTimeout(() => {
      process.exit(1);
    }, 8000);
  });
