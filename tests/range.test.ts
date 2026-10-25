import { describe, expect, it } from 'vitest';
import { formatContentRange, parseRangeHeader } from '../src/server/range';

describe('parseRangeHeader', () => {
  it('returns none when there is no header', () => {
    expect(parseRangeHeader(undefined, 100)).toEqual({ kind: 'none' });
    expect(parseRangeHeader('', 100)).toEqual({ kind: 'none' });
  });

  it('parses a closed range', () => {
    expect(parseRangeHeader('bytes=0-499', 1000)).toEqual({ kind: 'partial', start: 0, end: 499 });
  });

  it('parses an open ended range', () => {
    expect(parseRangeHeader('bytes=500-', 1000)).toEqual({ kind: 'partial', start: 500, end: 999 });
  });

  it('parses a suffix range', () => {
    expect(parseRangeHeader('bytes=-500', 1000)).toEqual({ kind: 'partial', start: 500, end: 999 });
  });

  it('clamps a suffix range bigger than the file', () => {
    expect(parseRangeHeader('bytes=-5000', 1000)).toEqual({ kind: 'partial', start: 0, end: 999 });
  });

  it('clamps the end of the range to the file size', () => {
    expect(parseRangeHeader('bytes=900-5000', 1000)).toEqual({ kind: 'partial', start: 900, end: 999 });
  });

  it('reports unsatisfiable ranges', () => {
    expect(parseRangeHeader('bytes=1000-', 1000)).toEqual({ kind: 'unsatisfiable' });
    expect(parseRangeHeader('bytes=5000-6000', 1000)).toEqual({ kind: 'unsatisfiable' });
    expect(parseRangeHeader('bytes=200-100', 1000)).toEqual({ kind: 'unsatisfiable' });
    expect(parseRangeHeader('bytes=-0', 1000)).toEqual({ kind: 'unsatisfiable' });
  });

  it('ignores malformed or unsupported headers', () => {
    expect(parseRangeHeader('items=0-10', 1000)).toEqual({ kind: 'none' });
    expect(parseRangeHeader('bytes=abc-def', 1000)).toEqual({ kind: 'none' });
    expect(parseRangeHeader('bytes=0-10,20-30', 1000)).toEqual({ kind: 'none' });
    expect(parseRangeHeader('bytes=-', 1000)).toEqual({ kind: 'none' });
  });
});

describe('formatContentRange', () => {
  it('formats the header value', () => {
    expect(formatContentRange(0, 999, 1000)).toBe('bytes 0-999/1000');
  });
});
