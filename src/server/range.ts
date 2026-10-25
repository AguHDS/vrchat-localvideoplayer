export type RangeResult =
  | { kind: 'none' }
  | { kind: 'partial'; start: number; end: number }
  | { kind: 'unsatisfiable' };

/**
 * Parses a single-range "Range: bytes=..." header
 *
 * `none` = no (or unsupported) range, the full body must be sent
 * `partial` = a satisfiable range, inclusive on both ends
 * `unsatisfiable`= well formed but outside the file, answer with 416
 */
export function parseRangeHeader(
  header: string | undefined | null,
  size: number,
): RangeResult {
  if (!header) return { kind: 'none' };

  const match = /^bytes=(.+)$/i.exec(header.trim());
  if (!match) return { kind: 'none' };

  const spec = (match[1] ?? '').trim();
  if (spec === '' || spec.includes(',')) {
    // multi ranges are not supported by the players we target. Ignoring the header is allowed by RFC 9110 and keeps them working
    return { kind: 'none' };
  }

  const parts = /^(\d*)-(\d*)$/.exec(spec);
  if (!parts) return { kind: 'none' };

  const rawStart = parts[1] ?? '';
  const rawEnd = parts[2] ?? '';
  if (rawStart === '' && rawEnd === '') return { kind: 'none' };

  if (rawStart === '') {
    // suffix range: last N bytes
    const suffix = Number(rawEnd);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return { kind: 'unsatisfiable' };
    const length = Math.min(suffix, size);
    if (length <= 0) return { kind: 'unsatisfiable' };
    return { kind: 'partial', start: size - length, end: size - 1 };
  }

  const start = Number(rawStart);
  if (!Number.isSafeInteger(start)) return { kind: 'none' };
  if (size <= 0 || start >= size) return { kind: 'unsatisfiable' };

  if (rawEnd === '') {
    return { kind: 'partial', start, end: size - 1 };
  }

  const end = Number(rawEnd);
  if (!Number.isSafeInteger(end)) return { kind: 'none' };
  if (end < start) return { kind: 'unsatisfiable' };
  return { kind: 'partial', start, end: Math.min(end, size - 1) };
}

export function formatContentRange(start: number, end: number, size: number): string {
  return `bytes ${start}-${end}/${size}`;
}
