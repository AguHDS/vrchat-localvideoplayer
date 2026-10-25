import { Command } from 'commander';
import { startApp, type RunningApp } from './app';
import { AppError } from './errors';
import { runWatchdog } from './lifecycle/watchdog';
import { Logger, type LogLevel } from './logger';

const WATCHDOG_FLAG = '--internal-watchdog';

async function main(): Promise<number> {
  const watchdogIndex = process.argv.indexOf(WATCHDOG_FLAG);
  if (watchdogIndex !== -1) {
    const parentPid = Number(process.argv[watchdogIndex + 1]);
    const childPid = Number(process.argv[watchdogIndex + 2]);
    if (Number.isSafeInteger(parentPid) && Number.isSafeInteger(childPid)) {
      await runWatchdog(parentPid, childPid);
    }
    return 0;
  }

  const program = new Command();
  program
    .name('vrchat-local-video-player')
    .description(
      'Sirve un video local de tu PC y genera una URL HTTPS pública para reproducirlo en VRChat.',
    )
    .version('1.0.0')
    .option('-f, --file <path>', 'Ruta del video a servir (omite el selector)')
    .option('--no-picker', 'No abrir el selector de archivos')
    .option('--no-tunnel', 'No crear el túnel público (solo para pruebas locales)')
    .option(
      '-p, --port <number>',
      'Puerto local del servidor HTTP',
      (value: string) => Number.parseInt(value, 10),
    )
    .option('-v, --verbose', 'Mostrar logs detallados')
    .option('-q, --quiet', 'Mostrar solamente la URL y los errores')
    .option('--log-file <path>', 'Guardar el log de la sesión en un archivo')
    .option(
      '--viewers <number>',
      'Cuántos espectadores van a mirar (solo afecta los avisos de bitrate)',
      (value: string) => Number.parseInt(value, 10),
    )
    .option(
      '--max-upload-mbps <number>',
      'Tu velocidad de subida en Mbps (solo afecta los avisos de bitrate)',
      (value: string) => Number.parseInt(value, 10),
    );

  program.parse(process.argv);
  const options = program.opts();

  const level: LogLevel = options.quiet ? 'warn' : options.verbose ? 'debug' : 'info';
  const logger = new Logger({
    level,
    quiet: Boolean(options.quiet),
    logFile: typeof options.logFile === 'string' ? options.logFile : undefined,
  });

  const app = await startApp({
    file: typeof options.file === 'string' ? options.file : undefined,
    usePicker: options.picker !== false,
    useTunnel: options.tunnel !== false,
    port: typeof options.port === 'number' ? options.port : undefined,
    viewers: typeof options.viewers === 'number' ? options.viewers : 3,
    maxUploadMbps: typeof options.maxUploadMbps === 'number' ? options.maxUploadMbps : 60,
    logger,
  });

  if (app === null) return 0;

  await waitForStop(app);
  return 0;
}

function waitForStop(app: RunningApp): Promise<void> {
  return new Promise<void>((resolve) => {
    let finished = false;

    const finish = (): void => {
      if (finished) return;
      finished = true;
      process.off('SIGINT', finish);
      process.off('SIGTERM', finish);
      process.stdin.off('data', onData);
      process.stdin.pause();
      void app.stop().finally(() => resolve());
    };

    const onData = (chunk: Buffer | string): void => {
      const text = String(chunk).trim().toLowerCase();
      if (text === 'q' || text === 'exit' || text === 'salir') finish();
    };

    process.on('SIGINT', finish);
    process.on('SIGTERM', finish);
    process.stdin.on('data', onData);
    process.stdin.resume();
  });
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
      if (error.hint !== undefined) logger.error(`Ayuda: ${error.hint}`);
    } else if (error instanceof Error) {
      logger.error(`Error inesperado: ${error.message}`);
      if (error.stack !== undefined && process.env['DEBUG'] !== undefined) {
        logger.error(error.stack);
      }
    } else {
      logger.error(`Error inesperado: ${String(error)}`);
    }
    process.exitCode = 1;
  });
