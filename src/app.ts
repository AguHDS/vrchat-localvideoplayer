import { AppError } from './errors';
import { CleanupManager } from './lifecycle/cleanup';
import { spawnWatchdog } from './lifecycle/watchdog';
import type { Logger } from './logger';
import { copyToClipboard } from './platform/clipboard';
import { resolveCloudflaredBinary } from './platform/cloudflared-binary';
import { selectVideoFile } from './platform/picker';
import { startVideoServer } from './server/http-server';
import { createToken, videoPath, type VideoSession } from './server/session';
import { startCloudflareQuickTunnel } from './tunnel/cloudflare-quick';
import { formatBytes, formatDuration } from './util/format';
import { inspectVideo, isAudioCodecSupported, isVideoCodecSupported } from './video/probe';
import { validateVideoFile, type ValidatedVideo } from './video/validate';

export interface AppOptions {
  file?: string | undefined;
  usePicker: boolean;
  useTunnel: boolean;
  port?: number | undefined;
  viewers: number;
  maxUploadMbps: number;
  logger: Logger;
}

export interface RunningApp {
  publicUrl: string | null;
  stop: () => Promise<void>;
}

export async function startApp(options: AppOptions): Promise<RunningApp | null> {
  const { logger } = options;
  const cleanup = new CleanupManager();
  let stopping: Promise<void> | null = null;

  const stop = async (): Promise<void> => {
    if (stopping === null) {
      stopping = (async () => {
        logger.info('Cerrando servidor y túnel...');
        await cleanup.runAll();
        logger.info('Todo cerrado. Chau.');
      })();
    }
    return stopping;
  };

  logger.info('VRChat Local Video Player');
  logger.info('');

  let filePath = options.file;

  if (filePath === undefined || filePath === '') {
    if (!options.usePicker) {
      throw new AppError(
        'No se indicó ningún archivo de video.',
        'Usá `--file "C:\\ruta\\video.mp4"` o quitá `--no-picker` para abrir el selector.',
      );
    }
    logger.info('Abriendo el selector de archivos...');
    const selected = await selectVideoFile(logger);
    if (selected === null) {
      logger.info('Selección cancelada. No hay nada que servir.');
      return null;
    }
    filePath = selected;
  }

  const video = await validateVideoFile(filePath);
  logger.info(`Archivo: ${video.fileName} (${formatBytes(video.size)})`);

  if (video.fastStart === false) {
    logger.warn(
      'El MP4 no tiene "faststart": la reproducción puede arrancar más lento y la búsqueda puede fallar.',
      'Ver README (sección "Optimizar el video") o usar: ffmpeg -i in.mp4 -c copy -movflags +faststart out.mp4',
    );
  }

  await reportVideoQuality(video, options, logger);

  const token = createToken();
  const session: VideoSession = {
    token,
    filePath: video.filePath,
    fileName: video.fileName,
    extension: video.extension,
    mimeType: video.mimeType,
    size: video.size,
    mtimeMs: video.mtimeMs,
  };

  const server = await startVideoServer({
    session,
    logger,
    port: options.port,
  });
  cleanup.add(() => server.close());
  logger.info(`Servidor local: ${server.url}${videoPath(token, video.extension)}`);

  let publicUrl: string;

  if (options.useTunnel) {
    logger.info('Levantando el túnel de Cloudflare...');
    const binary = await resolveCloudflaredBinary(logger);
    cleanup.add(() => binary.cleanup());

    const tunnel = await startCloudflareQuickTunnel({
      localUrl: server.url,
      binaryPath: binary.path,
      logger,
      onUnexpectedExit: (code) => {
        logger.error(`El túnel de Cloudflare se cerró inesperadamente (código ${code ?? '?'}).`);
        logger.error('La URL pública ya no funciona. Volvé a ejecutar la aplicación para obtener una nueva.');
        void stop();
      },
    });

    cleanup.add(() => tunnel.stop());

    if (tunnel.pid !== undefined) {
      spawnWatchdog({ parentPid: process.pid, childPid: tunnel.pid });
    }

    publicUrl = `${tunnel.baseUrl}${videoPath(token, video.extension)}`;
    logger.info(`Túnel listo: ${tunnel.baseUrl}`);
  } else {
    publicUrl = `${server.url}${videoPath(token, video.extension)}`;
  }

  logger.info('');
  logger.info('URL para VRChat:');
  logger.printAlways(publicUrl);
  logger.info('');

  if (options.useTunnel) {
    logger.warn('Todos los participantes deben activar Settings > Allow Untrusted URLs en VRChat.');
    logger.warn('Funciona en instancias privadas. En instancias públicas el mundo debe permitir el dominio.');
  }

  const copied = await copyToClipboard(publicUrl);
  if (copied) {
    logger.info('URL copiada al portapapeles.');
  } else {
    logger.debug('No se pudo copiar al portapapeles (no hay herramienta de clipboard disponible).');
  }

  logger.info('Presioná Ctrl+C (o escribí "q" y Enter) para detener todo.');

  return { publicUrl, stop };
}

/**
 * Prints the duration and the estimated bitrate of the selected video and
 * warns when the upload bandwidth is not enough for the expected viewers.
 */
async function reportVideoQuality(
  video: ValidatedVideo,
  options: AppOptions,
  logger: Logger,
): Promise<void> {
  const info = await inspectVideo(video.filePath, video.size, video.extension);

  if (info === null) {
    logger.debug('No se pudo estimar la duración ni el bitrate del video.');
    return;
  }

  if (info.durationSeconds !== null) {
    const bitrate =
      info.bitrateMbps !== null ? ` · Bitrate estimado: ${info.bitrateMbps.toFixed(1)} Mbps` : '';
    logger.info(`Duración: ${formatDuration(info.durationSeconds)}${bitrate}`);
  }

  if (isVideoCodecSupported(info.videoCodec) === false) {
    logger.warn(
      `El códec de video "${info.videoCodec}" puede no ser soportado por los reproductores de VRChat.`,
      'Usá H.264 (avc1) + AAC (mp4a) dentro de un contenedor .mp4.',
    );
  }

  if (isAudioCodecSupported(info.audioCodec) === false) {
    logger.warn(
      `El códec de audio "${info.audioCodec}" puede no ser soportado.`,
      'Usá AAC (mp4a) u Opus.',
    );
  }

  if (info.bitrateMbps === null) return;

  const viewers = Math.max(1, options.viewers);
  const needed = info.bitrateMbps * viewers;

  if (needed <= options.maxUploadMbps) {
    logger.info(
      `Subida necesaria: ~${needed.toFixed(0)} Mbps para ${viewers} spectator(s) (tenés ${options.maxUploadMbps} Mbps).`,
    );
    return;
  }

  const recommended = Math.max(
    2,
    Math.min(12, Math.floor((options.maxUploadMbps / viewers) * 0.8)),
  );

  logger.warn(
    `Con ${viewers} spectator(s) necesitás ~${needed.toFixed(0)} Mbps de subida y tenés ${options.maxUploadMbps} Mbps: el video va a bufferizar.`,
    `Apuntá a un bitrate de ${recommended} Mbps o menos por espectador.`,
  );
  logger.info(
    `  ffmpeg -i "${video.fileName}" -c:v libx264 -preset slow -crf 22 -maxrate ${recommended}M -bufsize ${recommended * 2}M -c:a aac -b:a 128k -movflags +faststart "video-optimizado.mp4"`,
  );
}
