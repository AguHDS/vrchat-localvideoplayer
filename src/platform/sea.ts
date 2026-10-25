import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

export interface SeaModule {
  isSea: () => boolean;
  getAssetAsBlob: (key: string, options?: { type?: string }) => Blob;
  getAsset: (key: string, encoding: string) => string;
}

let cached: SeaModule | null | undefined;

/**
 * Returns the node:sea module when the process runs as a single executable application, otherwise null
 */
export function loadSea(): SeaModule | null {
  if (cached !== undefined) return cached;
  try {
    const requireCjs = createRequire(pathToFileURL(process.execPath).href);
    const loaded: unknown = requireCjs('node:sea');
    if (typeof loaded !== 'object' || loaded === null) {
      cached = null;
      return cached;
    }
    const candidate = loaded as Partial<SeaModule>;
    if (typeof candidate.isSea !== 'function' || typeof candidate.getAssetAsBlob !== 'function') {
      cached = null;
      return cached;
    }
    cached = candidate as SeaModule;
    return cached;
  } catch {
    cached = null;
    return cached;
  }
}

export function isSingleExecutable(): boolean {
  const sea = loadSea();
  return sea !== null && sea.isSea();
}
