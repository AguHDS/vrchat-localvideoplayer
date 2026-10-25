/**
 * Shared metadata for the cloudflared binaries.
 *
 * The Windows and the Linux builds never share files: the binary is stored
 * with a platform specific name and the intermediate build artifacts are
 * suffixed with the target OS.
 */
export const CLOUDFLARED_VERSION = '2026.10.3';

export const CLOUDFLARED_TARGETS = {
  'win32-x64': {
    asset: 'cloudflared-windows-amd64.exe',
    sha256: '76b2805253d0d6ffacb092a7acfbee99e7af6917835c0c5410e23f3ef5052da2',
  },
  'win32-ia32': {
    asset: 'cloudflared-windows-386.exe',
    sha256: '84be6271133004dc103d71b1a2b6b80cf204685ebf277e2504082793507922cf',
  },
  'linux-x64': {
    asset: 'cloudflared-linux-amd64',
    sha256: '053b80b0a23031a038fdbf3c073f59f82b8f1f152aa67971d7383ffafc0dbab0',
  },
  'linux-arm64': {
    asset: 'cloudflared-linux-arm64',
    sha256: '89297ebfb9e8c99c0dc013a1140601453cf3798d8306c5591651f4a3f5210be8',
  },
};

export function targetKey(platform = process.platform, arch = process.arch) {
  return `${platform}-${arch}`;
}

/** Local file name used inside vendor/ and inside the extracted temporary file. */
export function localFileName(platform = process.platform) {
  return platform === 'win32' ? 'cloudflared.exe' : 'cloudflared';
}

/** Suffix used for the intermediate build artifacts (dist/). */
export function buildSuffix(platform = process.platform) {
  return platform === 'win32' ? 'win' : 'linux';
}

/** Name of the final executable for the given platform. */
export function executableName(platform = process.platform) {
  return platform === 'win32' ? 'vrchat-local-video-player.exe' : 'vrchat-local-video-player-linux';
}
