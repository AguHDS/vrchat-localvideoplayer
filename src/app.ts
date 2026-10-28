import { AppError } from './errors';
import { CleanupManager } from './lifecycle/cleanup';
import { cleanupStaleTemporaryDirectories } from './lifecycle/temp-files';
import { spawnWatchdog } from './lifecycle/watchdog';
import type { Logger } from './logger';
import { copyToClipboard } from './platform/clipboard';
import { resolveCloudflaredBinary } from './platform/cloudflared-binary';
import { selectVideoFiles } from './platform/picker';
import { startVideoServer } from './server/http-server';
import { createToken, videoPath, type VideoSession } from './server/session';
import { startCloudflareQuickTunnel } from './tunnel/cloudflare-quick';
import { formatBytes, formatDuration } from './util/format';
import { preparePlaylistVideo } from './video/playlist';
import { inspectVideo, isAudioCodecSupported, isVideoCodecSupported } from './video/probe';
import { validateVideoFiles, type ValidatedVideo } from './video/validate';

export interface AppOptions {
  files: string[];
  usePicker: boolean;
  useTunnel: boolean;
  port?: number | undefined;
  viewers: number;
  maxUploadMbps: number;
  logger: Logger;
  signal?: AbortSignal | undefined;
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

  try {
    const staleDirectories = cleanupStaleTemporaryDirectories();
    if (staleDirectories > 0) {
      logger.info(`Removed ${staleDirectories} stale temporary director${staleDirectories === 1 ? 'y' : 'ies'}.`);
    }
    logger.printAlways('VRChat Local Video Player');

    let selectedPaths = options.files;
    if (selectedPaths.length === 0) {
      if (!options.usePicker) {
        throw new AppError(
          'No video file was specified.',
          'Use `--file "C:\\ruta\\video.mp4"` or remove `--no-picker` to open the file picker.',
        );
      }
      logger.printAlways('Opening file picker...');
      const selected = await selectVideoFiles(logger);
      if (selected === null) {
        logger.info('Selection cancelled. Nothing to serve.');
        return null;
      }
      selectedPaths = selected;
    }

    const videos = await validateVideoFiles(selectedPaths);
    for (const sourceVideo of videos) {
      logger.info(`File: ${sourceVideo.fileName} (${formatBytes(sourceVideo.size)})`);
      if (videos.length > 1) {
        await reportVideoQuality(sourceVideo, options, logger, false);
      }
    }

    let video = videos[0];
    if (video === undefined) {
      throw new AppError('No video file was selected.');
    }

    if (videos.length > 1) {
      const prepared = await preparePlaylistVideo(videos, {
        logger,
        signal: options.signal,
      });
      cleanup.add(prepared.cleanup);
      video = prepared.video;
    } else if (video.fastStart === false) {
      logger.warn(
        'The MP4 does not have "faststart": playback may start slower and seeking may fail.',
        'Use: ffmpeg -i in.mp4 -c copy -movflags +faststart out.mp4',
      );
    }

    await reportVideoQuality(video, options, logger, true);

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
    logger.info(`Local server: ${server.url}${videoPath(token, video.extension)}`);

    let publicUrl: string;

    if (options.useTunnel) {
      logger.info('Starting cloudflare tunnel...');
      const binary = await resolveCloudflaredBinary(logger);
      cleanup.add(() => binary.cleanup());

      const tunnel = await startCloudflareQuickTunnel({
        localUrl: server.url,
        binaryPath: binary.path,
        logger,
        onUnexpectedExit: (code) => {
          logger.error(`The Cloudflare tunnel closed unexpectedly (code ${code ?? '?'}).`);
          logger.error('The public URL is no longer working. Restart the application to obtain a new one.');
          void stop();
        },
      });

      cleanup.add(() => tunnel.stop());

      if (tunnel.pid !== undefined) {
        spawnWatchdog({
          parentPid: process.pid,
          childPid: tunnel.pid,
          cleanupPath: binary.temporaryDirectory,
        });
      }

      publicUrl = `${tunnel.baseUrl}${videoPath(token, video.extension)}`;
      logger.info(`Tunnel ready: ${tunnel.baseUrl}`);
    } else {
      publicUrl = `${server.url}${videoPath(token, video.extension)}`;
    }

    const cyan = '\x1b[36m';
    const yellow = '\x1b[33m';
    const green = '\x1b[32m';
    const bold = '\x1b[1m';
    const reset = '\x1b[0m';

    logger.printAlways('');
    logger.printAlways(`${cyan}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${reset}`);
    logger.printAlways('');
    logger.printAlways(`${cyan}${bold}URL FOR VRCHAT READY:${reset}`);
    logger.printAlways(`${yellow}${bold}${publicUrl}${reset}`);
    logger.printAlways('');
    logger.printAlways(`${cyan}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${reset}`);
    logger.printAlways('');

    const copied = await copyToClipboard(publicUrl);
    if (copied) {
      logger.printAlways(`${green}URL copied to clipboard${reset}`);
    } else {
      logger.debug('Could not copy to clipboard (no clipboard tool available)');
    }

    logger.printAlways('Press Ctrl+C (or type "q" and Enter) to stop everything');

    return { publicUrl, stop };
  } catch (error) {
    await cleanup.runAll();
    throw error;
  }
}

async function reportVideoQuality(
  video: ValidatedVideo,
  options: AppOptions,
  logger: Logger,
  reportBandwidth: boolean,
): Promise<void> {
  const info = await inspectVideo(video.filePath, video.size, video.extension);

  if (info === null) {
    logger.debug('Could not estimate the duration or bitrate of the video.');
    return;
  }

  if (info.durationSeconds !== null) {
    const bitrate =
      info.bitrateMbps !== null ? ` · Estimated bitrate: ${info.bitrateMbps.toFixed(1)} Mbps` : '';
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

  if (!reportBandwidth || info.bitrateMbps === null) return;

  const viewers = Math.max(1, options.viewers);
  const needed = info.bitrateMbps * viewers;

  if (needed <= options.maxUploadMbps) {
    logger.info(
      `Required upload speed: ~${needed.toFixed(0)} Mbps for ${viewers} spectator(s) (you have ${options.maxUploadMbps} Mbps)`,
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
}
