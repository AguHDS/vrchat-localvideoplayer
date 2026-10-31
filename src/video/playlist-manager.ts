import { createToken, type VideoSession } from '../server/session';
import type { Logger } from '../logger';
import { shuffle } from '../util/shuffle';
import { preparePlaylistVideo, type PreparedPlaylist } from './playlist';
import { validateVideoFiles, type ValidatedVideo } from './validate';

export type PlaylistBuilder = (
  videos: ValidatedVideo[],
  options: { logger: Logger; signal?: AbortSignal | undefined },
) => Promise<PreparedPlaylist>;

export interface PlaylistManagerOptions {
  logger: Logger;
  signal?: AbortSignal | undefined;
  prepare?: PlaylistBuilder;
  random?: () => number;
}

export interface PlaylistBuild {
  video: ValidatedVideo;
  session: VideoSession;
  cleanup: (() => Promise<void>) | null;
}

export interface PlaylistChange {
  added: ValidatedVideo[];
  build: PlaylistBuild;
}

export class PlaylistManager {
  private sources: ValidatedVideo[] = [];
  private readonly cleanups: Array<() => Promise<void>> = [];
  private readonly logger: Logger;
  private readonly signal: AbortSignal | undefined;
  private readonly prepare: PlaylistBuilder;
  private readonly random: () => number;

  constructor(options: PlaylistManagerOptions) {
    this.logger = options.logger;
    this.signal = options.signal;
    this.prepare = options.prepare ?? preparePlaylistVideo;
    this.random = options.random ?? Math.random;
  }

  get sourceCount(): number {
    return this.sources.length;
  }

  list(): string[] {
    return this.sources.map(
      (video, index) => `${index + 1}. ${video.fileName} (${formatSize(video.size)})`,
    );
  }

  async start(paths: string[]): Promise<PlaylistChange> {
    const videos = await validateVideoFiles(paths);
    this.sources = this.order(videos);
    const build = await this.build();
    this.logOrder(videos.length);
    return { added: this.sources, build };
  }

  async replace(paths: string[]): Promise<PlaylistChange> {
    const videos = await validateVideoFiles(paths);
    const previous = this.sources;
    this.sources = this.order(videos);
    try {
      const build = await this.build();
      this.logOrder(videos.length);
      return { added: this.sources, build };
    } catch (error) {
      this.sources = previous;
      throw error;
    }
  }

  /** Orders the videos in the playlist for randomization purposes */
  private order(videos: ValidatedVideo[]): ValidatedVideo[] {
    if (videos.length < 2) return videos;
    return shuffle(videos, this.random);
  }

  private logOrder(count: number): void {
    if (count < 2) return;
    this.logger.info(`Playlist order randomized (${count} videos).`);
  }

  async dispose(): Promise<void> {
    const cleanups = [...this.cleanups].reverse();
    this.cleanups.length = 0;
    for (const cleanup of cleanups) {
      try {
        await cleanup();
      } catch {
        // cleanup must never throw
      }
    }
  }

  private async build(): Promise<PlaylistBuild> {
    const only = this.sources[0];
    if (this.sources.length === 1 && only !== undefined) {
      return { video: only, session: createSession(only), cleanup: null };
    }

    const prepared = await this.prepare(this.sources, {
      logger: this.logger,
      signal: this.signal,
    });
    this.cleanups.push(prepared.cleanup);
    return { video: prepared.video, session: createSession(prepared.video), cleanup: prepared.cleanup };
  }
}

function createSession(video: ValidatedVideo): VideoSession {
  return {
    token: createToken(),
    filePath: video.filePath,
    fileName: video.fileName,
    extension: video.extension,
    mimeType: video.mimeType,
    size: video.size,
    mtimeMs: video.mtimeMs,
  };
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}
