#!/usr/bin/env node
/**
 * Downloads the official cloudflared binary for the current platform and verifies its SHA-256 checksum before storing it in vendor/.
 * No account, no API key, no manual configuration.
 *
 * The file name is platform specific (cloudflared.exe / cloudflared) so the Windows and the Linux binaries can live side by side 
 * in the same repo
 */
import { createHash } from 'node:crypto';
import { chmod, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CLOUDFLARED_TARGETS,
  CLOUDFLARED_VERSION,
  localFileName,
  targetKey,
} from './cloudflared-version.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const vendorDir = path.join(repoRoot, 'vendor');

const RELEASE_API = `https://api.github.com/repos/cloudflare/cloudflared/releases/tags/${CLOUDFLARED_VERSION}`;

async function sha256(filePath) {
  const hash = createHash('sha256');
  hash.update(await readFile(filePath));
  return hash.digest('hex');
}

async function fileExists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const key = targetKey();
  const target = CLOUDFLARED_TARGETS[key];

  if (!target) {
    console.error(`Platform not supported: ${key}`);
    console.error('Supported platforms: win32-x64, win32-ia32, linux-x64, linux-arm64.');
    process.exitCode = 1;
    return;
  }

  const fileName = localFileName();
  const targetPath = path.join(vendorDir, fileName);

  if (await fileExists(targetPath)) {
    const current = await sha256(targetPath);
    if (current === target.sha256) {
      console.log(`cloudflared ${CLOUDFLARED_VERSION} is already downloaded and verified.`);
      await writeManifest(target);
      return;
    }
    console.log('The existing binary does not match the expected checksum, redownloading...');
  }

  console.log(`Downloading cloudflared ${CLOUDFLARED_VERSION} (${target.asset})...`);

  const releaseResponse = await fetch(RELEASE_API, {
    headers: { 'User-Agent': 'vrchat-local-video-player' },
  });

  if (!releaseResponse.ok) {
    console.error(
      `Failed to fetch the official release (HTTP ${releaseResponse.status}).`,
      'Please check your internet connection or try again later.',
    );
    process.exitCode = 1;
    return;
  }

  const release = await releaseResponse.json();
  const asset = (release.assets ?? []).find((item) => item.name === target.asset);

  if (!asset) {
    console.error(`The release ${CLOUDFLARED_VERSION} does not contain ${target.asset}.`);
    process.exitCode = 1;
    return;
  }

  const expected = target.sha256 ?? (asset.digest ?? '').replace(/^sha256:/, '');

  if (!expected) {
    console.error('No checksum available to verify the download.');
    process.exitCode = 1;
    return;
  }

  await mkdir(vendorDir, { recursive: true });

  const download = await fetch(asset.browser_download_url, {
    headers: { 'User-Agent': 'vrchat-local-video-player' },
  });

  if (!download.ok || !download.body) {
    console.error(`Falló la descarga (HTTP ${download.status}).`);
    process.exitCode = 1;
    return;
  }

  const temporaryPath = `${targetPath}.download`;
  await pipeline(Readable.fromWeb(download.body), createWriteStream(temporaryPath));

  const downloadedHash = await sha256(temporaryPath);

  if (downloadedHash !== expected) {
    await rm(temporaryPath, { force: true });
    console.error('The checksum does not match: the download was discarded.');
    console.error(`expected: ${expected}`);
    console.error(`obtained: ${downloadedHash}`);
    process.exitCode = 1;
    return;
  }

  await rm(targetPath, { force: true });
  await rename(temporaryPath, targetPath);

  if (process.platform !== 'win32') {
    await chmod(targetPath, 0o755);
  }

  console.log('OK: cloudflared downloaded and verified.');
  console.log(`file: ${targetPath}`);
  console.log(`version: ${CLOUDFLARED_VERSION}`);
  console.log(`sha256: ${downloadedHash}`);

  await writeManifest(target);
}

async function writeManifest(target) {
  const manifest = {
    version: CLOUDFLARED_VERSION,
    platform: targetKey(),
    fileName: localFileName(),
    assetName: target.asset,
    sha256: target.sha256,
    source: 'https://github.com/cloudflare/cloudflared/releases',
  };
  await mkdir(vendorDir, { recursive: true });
  await writeFile(
    path.join(vendorDir, 'cloudflared.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8',
  );
}

await main();
