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
        logger.info('Closing tunnel and server.');
        await cleanup.runAll();
        logger.info('All closed.');
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
        'No video file was specified.',
        'Use `--file "C:\\ruta\\video.mp4"` or remove `--no-picker` to open the file picker.',
      );
    }
    logger.info('Opening file picker...');
    const selected = await selectVideoFile(logger);
    if (selected === null) {
      logger.info('Selection cancelled. Nothing to serve.');
      return null;
    }
    filePath = selected;
  }

  const video = await validateVideoFile(filePath);
  logger.info(`File: ${video.fileName} (${formatBytes(video.size)})`);

  if (video.fastStart === false) {
    logger.warn(
      'The MP4 does not have "faststart": playback may start slower and seeking may fail.',
      'See README (section "Optimize the video") or use: ffmpeg -i in.mp4 -c copy -movflags +faststart out.mp4',
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
    logger.info('Starting Cloudflare tunnel...');
    const binary = await resolveCloudflaredBinary(logger);
    cleanup.add(() => binary.cleanup());

    const tunnel = await startCloudflareQuickTunnel({
      localUrl: server.url,
      binaryPath: binary.path,
      logger,
      onUnexpectedExit: (code) => {
        logger.error(`The Cloudflare tunnel closed unexpectedly (code ${code ?? '?'}).`);
        logger.error('The public URL is no longer working. Please restart the application to obtain a new one.');
        void stop();
      },
    });

    cleanup.add(() => tunnel.stop());

    if (tunnel.pid !== undefined) {
      spawnWatchdog({ parentPid: process.pid, childPid: tunnel.pid });
    }

    publicUrl = `${tunnel.baseUrl}${videoPath(token, video.extension)}`;
    logger.info(`Tunnel ready: ${tunnel.baseUrl}`);
  } else {
    publicUrl = `${server.url}${videoPath(token, video.extension)}`;
  }

  logger.info('');
  logger.info('URL for VRChat:');
  logger.printAlways(publicUrl);
  logger.info('');

  if (options.useTunnel) {
    logger.warn('All participants must enable Settings > Allow Untrusted URLs in VRChat.');
    logger.warn('Works in private instances. In public instances, the world must allow the domain.');
  }

  const copied = await copyToClipboard(publicUrl);
  if (copied) {
    logger.info('URL copied to clipboard.');
  } else {
    logger.debug('Could not copy to clipboard (no clipboard tool available).');
  }

  logger.info('Press Ctrl+C (or type "q" and Enter) to stop everything.');

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
    logger.debug('Could not estimate the duration or bitrate of the video.');
    return;
  }

  if (info.durationSeconds !== null) {
    const bitrate =
      info.bitrateMbps !== null ? ` · Estimed bitrate : ${info.bitrateMbps.toFixed(1)} Mbps` : '';
    logger.info(`Duration: ${formatDuration(info.durationSeconds)}${bitrate}`);
  }

  if (isVideoCodecSupported(info.videoCodec) === false) {
    logger.warn(
      `The video codec "${info.videoCodec}" may not be supported by VRChat players.`,
      'Use H.264 (avc1) + AAC (mp4a) within an .mp4 container.',
    );
  }

  if (isAudioCodecSupported(info.audioCodec) === false) {
    logger.warn(
      `The audio codec "${info.audioCodec}" may not be supported.`,
      'Use AAC (mp4a) or Opus.',
    );
  }

  if (info.bitrateMbps === null) return;

  const viewers = Math.max(1, options.viewers);
  const needed = info.bitrateMbps * viewers;

  if (needed <= options.maxUploadMbps) {
    logger.info(
      `Required upload speed: ~${needed.toFixed(0)} Mbps for ${viewers} spectator(s) (you have ${options.maxUploadMbps} Mbps).`,
    );
    return;
  }

  const recommended = Math.max(
    2,
    Math.min(12, Math.floor((options.maxUploadMbps / viewers) * 0.8)),
  );

  logger.warn(
    `For ${viewers} spectator(s), you need ~${needed.toFixed(0)} Mbps of upload speed and have ${options.maxUploadMbps} Mbps: the video will buffer.`,
    `Aim for a bitrate of ${recommended} Mbps or less per spectator.`,
  );
  logger.info(
    `  ffmpeg -i "${video.fileName}" -c:v libx264 -preset slow -crf 22 -maxrate ${recommended}M -bufsize ${recommended * 2}M -c:a aac -b:a 128k -movflags +faststart "video-optimizado.mp4"`,
  );
}
