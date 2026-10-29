import { AppError } from './errors';
import { CleanupManager } from './lifecycle/cleanup';
import { cleanupStaleTemporaryDirectories } from './lifecycle/temp-files';
import { spawnWatchdog } from './lifecycle/watchdog';
import type { Logger } from './logger';
import { copyToClipboard } from './platform/clipboard';
import { resolveCloudflaredBinary } from './platform/cloudflared-binary';
import { selectVideoFiles } from './platform/picker';
import { startVideoServer } from './server/http-server';
import { SessionRegistry, videoPath } from './server/session';
import { startCloudflareQuickTunnel } from './tunnel/cloudflare-quick';
import { formatBytes, formatDuration } from './util/format';
import { PlaylistManager } from './video/playlist-manager';
import { inspectVideo, isAudioCodecSupported, isVideoCodecSupported } from './video/probe';
import type { ValidatedVideo } from './video/validate';
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
  addVideos: () => Promise<void>;
  listVideos: () => void;
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

    const manager = new PlaylistManager({ logger, signal: options.signal });
    cleanup.add(() => manager.dispose());

    let selectedPaths = options.files;
    if (selectedPaths.length === 0) {
      if (!options.usePicker) {
        throw new AppError(
          'No video file was specified.',
          'Use `--file "C:\\ruta\\video.mp4"` or remove `--no-picker` to open the file picker.',
        );
      }
      logger.info('Opening file picker...');
      const selected = await selectVideoFiles(logger);
      if (selected === null) {
        logger.info('Selection cancelled. Nothing to serve.');
        return null;
      }
      selectedPaths = selected;
    }

    const initial = await manager.start(selectedPaths);
    const video = initial.build.video;

    for (const sourceVideo of initial.added) {
      logger.info(`File: ${sourceVideo.fileName} (${formatBytes(sourceVideo.size)})`);
      if (initial.added.length > 1) {
        await reportVideoQuality(sourceVideo, options, logger, false);
      }
    }

    if (video.fastStart === false) {
      logger.warn(
        'The MP4 does not have "faststart": playback may start slower and seeking may fail.',
        'Use: ffmpeg -i in.mp4 -c copy -movflags +faststart out.mp4',
      );
    }

    await reportVideoQuality(video, options, logger, true);

    const sessions = new SessionRegistry();
    sessions.add(initial.build.session);

    const server = await startVideoServer({
      sessions,
      logger,
      port: options.port,
    });
    cleanup.add(() => server.close());
    logger.info(`Local server: ${server.url}${videoPath(initial.build.session.token, initial.build.session.extension)}`);

    let publicBase = server.url;
    let publicUrl = '';

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

      publicBase = tunnel.baseUrl;
      logger.info(`Tunnel ready: ${tunnel.baseUrl}`);
    }

    publicUrl = `${publicBase}${videoPath(initial.build.session.token, initial.build.session.extension)}`;
    printUrl(publicUrl, logger, 'URL FOR VRCHAT READY');
    await copyAndReport(publicUrl, logger);

    let busy = false;

    const addVideos = async (): Promise<void> => {
      if (busy) {
        logger.warn('Another operation is already running.');
        return;
      }
      if (!options.usePicker) {
        logger.warn('The file picker is disabled, so no more videos can be added.');
        return;
      }
      busy = true;
      try {
        logger.info('Opening file picker to select a new playlist...');
        const selected = await selectVideoFiles(logger);
        if (selected === null) {
          logger.info('Selection cancelled.');
          return;
        }

        const change = await manager.replace(selected);
        for (const added of change.added) {
          logger.info(`Selected: ${added.fileName} (${formatBytes(added.size)})`);
        }

        sessions.add(change.build.session);
        const newUrl = `${publicBase}${videoPath(change.build.session.token, change.build.session.extension)}`;
        logger.info(`The new playlist has ${manager.sourceCount} video(s).`);
        await reportVideoQuality(change.build.video, options, logger, true);
        printUrl(newUrl, logger, 'NEW URL FOR VRCHAT');
        logger.printAlways('The previous URL keeps working for the viewers that are already connected.');
        await copyAndReport(newUrl, logger);
        publicUrl = newUrl;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error(`Could not add the videos: ${message}`);
        if (error instanceof AppError && error.hint !== undefined) {
          logger.error(`Help: ${error.hint}`);
        }
      } finally {
        busy = false;
      }
    };

    const listVideos = (): void => {
      logger.info(`Playlist (${manager.sourceCount} video(s)):`);
      for (const line of manager.list()) {
        logger.info(`  ${line}`);
      }
      logger.info(`Current URL: ${publicUrl}`);
    };

    return { publicUrl, stop, addVideos, listVideos };
  } catch (error) {
    await cleanup.runAll();
    throw error;
  }
}

function printUrl(url: string, logger: Logger, title: string): void {
  const cyan = '\x1b[36m';
  const yellow = '\x1b[33m';
  const bold = '\x1b[1m';
  const reset = '\x1b[0m';

  logger.printAlways('');
  logger.printAlways(`${cyan}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${reset}`);
  logger.printAlways('');
  logger.printAlways(`${cyan}${bold}${title}:${reset}`);
  logger.printAlways(`${yellow}${bold}${url}${reset}`);
  logger.printAlways('');
  logger.printAlways(`${cyan}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${reset}`);
  logger.printAlways('');
}

async function copyAndReport(url: string, logger: Logger): Promise<void> {
  const green = '\x1b[32m';
  const reset = '\x1b[0m';
  const copied = await copyToClipboard(url);
  if (copied) {
    logger.printAlways(`${green}URL copied to clipboard${reset}`);
  } else {
    logger.debug('Could not copy to clipboard (no clipboard tool available)');
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
