import { describe, expect, it } from 'vitest';
import { formatBytes, formatDuration } from '../src/util/format';

describe('formatBytes', () => {
  it('formats sizes in human readable units', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1024)).toBe('1.0 KB');
    expect(formatBytes(1024 * 1024 * 1.5)).toBe('1.5 MB');
    expect(formatBytes(1024 ** 3)).toBe('1.0 GB');
    expect(formatBytes(1024 ** 3 * 1.02)).toBe('1.0 GB');
  });
});

describe('formatDuration', () => {
  it('formats minutes and seconds', () => {
    expect(formatDuration(59)).toBe('0:59');
    expect(formatDuration(60)).toBe('1:00');
    expect(formatDuration(754)).toBe('12:34');
  });

  it('formats hours when needed', () => {
    expect(formatDuration(3600)).toBe('1:00:00');
    expect(formatDuration(6130)).toBe('1:42:10');
  });

  it('handles unknown durations', () => {
    expect(formatDuration(null)).toBe('desconocida');
    expect(formatDuration(0)).toBe('desconocida');
    expect(formatDuration(Number.NaN)).toBe('desconocida');
  });
});
