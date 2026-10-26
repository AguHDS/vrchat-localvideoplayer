import { describe, expect, it } from 'vitest';
import { parseSelectedPaths, parseZenityPaths } from '../src/platform/picker';

describe('parseSelectedPaths', () => {
  it('parses multiple Windows paths and removes the BOM', () => {
    expect(parseSelectedPaths('\uFEFFC:\\first video.mp4\r\nD:\\second.mp4\r\n')).toEqual([
      'C:\\first video.mp4',
      'D:\\second.mp4',
    ]);
  });

  it('parses multiple Linux paths in order', () => {
    expect(parseSelectedPaths('/home/user/one.mp4\n/home/user/two.webm\n')).toEqual([
      '/home/user/one.mp4',
      '/home/user/two.webm',
    ]);
  });

  it('parses Zenity multiple selection output', () => {
    expect(parseZenityPaths('/home/user/one.mp4|/home/user/two.webm')).toEqual([
      '/home/user/one.mp4',
      '/home/user/two.webm',
    ]);
  });

  it('returns an empty list for empty output', () => {
    expect(parseSelectedPaths('')).toEqual([]);
  });
});
