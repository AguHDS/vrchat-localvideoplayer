import { describe, expect, it } from 'vitest';
import { createToken, matchesVideoPath, safeEqual, videoPath } from '../src/server/session';

describe('session helpers', () => {
  it('creates unique unguessable tokens', () => {
    const tokens = new Set(Array.from({ length: 50 }, () => createToken()));
    expect(tokens.size).toBe(50);
    for (const token of tokens) {
      expect(token.length).toBeGreaterThanOrEqual(32);
      expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    }
  });

  it('builds the only allowed path', () => {
    const token = createToken();
    expect(videoPath(token, '.mp4')).toBe(`/v/${token}/video.mp4`);
    expect(matchesVideoPath(`/v/${token}/video.mp4`, token, '.mp4')).toBe(true);
    expect(matchesVideoPath(`/v/${token}/video.webm`, token, '.mp4')).toBe(false);
    expect(matchesVideoPath(`/v/${token}/video.mp4/`, token, '.mp4')).toBe(false);
    expect(matchesVideoPath(`/v/${token}x/video.mp4`, token, '.mp4')).toBe(false);
  });

  it('compares strings safely', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
  });
});
