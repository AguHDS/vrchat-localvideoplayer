import { randomBytes, timingSafeEqual } from 'node:crypto';

export type VideoExtension = '.mp4' | '.webm';

export interface VideoSession {
  /** unguessable path segment */
  token: string;
  /** absolute path of the selected file */
  filePath: string;
  fileName: string;
  extension: VideoExtension;
  mimeType: string;
  size: number;
  mtimeMs: number;
}

export function createToken(): string {
  return randomBytes(24).toString('base64url');
}

/** The single path the server is allowed to answer */
export function videoPath(token: string, extension: VideoExtension): string {
  return `/v/${token}/video${extension}`;
}

export function matchesVideoPath(
  pathname: string,
  token: string,
  extension: VideoExtension,
): boolean {
  if (pathname.length !== videoPath(token, extension).length) return false;
  return safeEqual(pathname, videoPath(token, extension));
}

export function safeEqual(a: string, b: string): boolean {
  const bufferA = Buffer.from(a, 'utf8');
  const bufferB = Buffer.from(b, 'utf8');
  if (bufferA.length !== bufferB.length) return false;
  return timingSafeEqual(bufferA, bufferB);
}

/**
 * Keeps every published generation of the served video.
 * Each generation has its own token, so its URL stays valid while newer ones are added
 */
export class SessionRegistry {
  private readonly sessions: VideoSession[] = [];

  add(session: VideoSession): void {
    this.sessions.push(session);
  }

  get count(): number {
    return this.sessions.length;
  }

  match(pathname: string): VideoSession | null {
    for (const session of this.sessions) {
      if (matchesVideoPath(pathname, session.token, session.extension)) return session;
    }
    return null;
  }
}
