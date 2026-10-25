import { describe, expect, it } from 'vitest';
import { isValidTunnelUrl, parseTunnelUrl } from '../src/tunnel/parse-tunnel-url';

describe('parseTunnelUrl', () => {
  it('extracts the url printed by cloudflared', () => {
    const line =
      '2026-10-24T12:00:00Z INF |  https://random-words-here.trycloudflare.com  https://random-words-here.trycloudflare.com';
    expect(parseTunnelUrl(line)).toBe('https://random-words-here.trycloudflare.com');
  });

  it('returns null when there is no url', () => {
    expect(parseTunnelUrl('INF Starting tunnel')).toBeNull();
    expect(parseTunnelUrl('INF https://example.com')).toBeNull();
  });

  it('validates the tunnel url', () => {
    expect(isValidTunnelUrl('https://abc.trycloudflare.com')).toBe(true);
    expect(isValidTunnelUrl('http://abc.trycloudflare.com')).toBe(false);
    expect(isValidTunnelUrl('https://abc.example.com')).toBe(false);
    expect(isValidTunnelUrl('not a url')).toBe(false);
  });
});
