const TUNNEL_URL_PATTERN = /https:\/\/[a-z0-9][a-z0-9-]*\.trycloudflare\.com/i;

/** Extracts the public https URL printed by `cloudflared`. */
export function parseTunnelUrl(text: string): string | null {
  const match = TUNNEL_URL_PATTERN.exec(text);
  if (!match) return null;
  return match[0].replace(/\/+$/, '');
}

export function isValidTunnelUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && parsed.hostname.endsWith('.trycloudflare.com');
  } catch {
    return false;
  }
}
