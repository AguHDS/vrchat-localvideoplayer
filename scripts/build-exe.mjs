#!/usr/bin/env node
/**
 * Builds a self contained executable using the official Node.js
 * "single executable application" (SEA) mechanism.
 *
 * The result embeds the application and the cloudflared binary, so it can
 * run on a machine without Node.js installed.
 *
 * Windows and Linux builds never overwrite each other: the intermediate
 * artifacts are suffixed with the target OS and each one produces its own
 * executable name in the repository root.
 */
import { spawn } from 'node:child_process';
import { chmod, copyFile, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import postject from 'postject';
import {
  CLOUDFLARED_VERSION,
  buildSuffix,
  executableName,
  localFileName,
} from './cloudflared-version.mjs';

const { inject } = postject;

const SENTINEL_FUSE = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2';
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');

function argValue(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit', ...options });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} terminó con código ${code ?? '?'}`));
    });
  });
}

async function fileExists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Node.js binaries are signed. Injecting the SEA blob invalidates that
 * signature, so it is removed beforehand when signtool is available.
 */
async function findSignTool() {
  if (process.platform !== 'win32') return null;

  const candidates = [];
  const kitsRoot = path.join(process.env['ProgramFiles(x86)'] ?? '', 'Windows Kits', '10', 'bin');

  try {
    const versions = await readdir(kitsRoot);
    versions.sort().reverse();
    for (const version of versions) {
      candidates.push(path.join(kitsRoot, version, 'x64', 'signtool.exe'));
    }
  } catch {
    // The Windows SDK is not installed.
  }

  for (const candidate of candidates) {
    if (await fileExists(candidate)) return candidate;
  }

  return null;
}

async function removeAuthenticodeSignature(executablePath) {
  const signTool = await findSignTool();
  if (signTool === null) {
    console.log('   (signtool no encontrado: se deja la firma original, Windows la invalida al inyectar)');
    return;
  }

  await new Promise((resolve) => {
    const child = spawn(signTool, ['remove', '/s', executablePath], { stdio: 'ignore' });
    child.on('error', () => resolve());
    child.on('close', () => resolve());
  });
}

async function main() {
  const requested = argValue('--platform') ?? process.platform;

  if (requested !== process.platform) {
    console.error(
      `No se puede compilar para "${requested}" desde "${process.platform}".`,
      'Ejecutá el build en el sistema operativo destino.',
    );
    process.exitCode = 1;
    return;
  }

  const isWindows = process.platform === 'win32';
  const suffix = buildSuffix();
  const vendorFile = path.join(repoRoot, 'vendor', localFileName());

  if (!(await fileExists(vendorFile))) {
    console.log('cloudflared no está descargado, ejecutando el setup...');
    await run(process.execPath, [path.join(scriptDir, 'setup-cloudflared.mjs')]);
  }

  const distDir = path.join(repoRoot, 'dist');
  await mkdir(distDir, { recursive: true });

  console.log(`1/4 Compilando TypeScript (${suffix})...`);
  const bundlePath = path.join(distDir, `main.${suffix}.cjs`);
  await build({
    entryPoints: [path.join(repoRoot, 'src', 'cli.ts')],
    bundle: true,
    platform: 'node',
    target: 'node22',
    format: 'cjs',
    outfile: bundlePath,
    legalComments: 'none',
    logLevel: 'warning',
  });

  console.log(`2/4 Preparando el blob de la Single Executable Application (${suffix})...`);
  const metaPath = path.join(distDir, `cloudflared-meta.${suffix}.json`);
  await writeFile(
    metaPath,
    `${JSON.stringify(
      {
        version: CLOUDFLARED_VERSION,
        fileName: localFileName(),
        platform: process.platform,
      },
      null,
      2,
    )}\n`,
    'utf8',
  );

  const seaConfig = {
    main: bundlePath,
    output: path.join(distDir, `sea-prep.${suffix}.blob`),
    disableExperimentalSEAWarning: true,
    assets: {
      cloudflared: vendorFile,
      'cloudflared-meta.json': metaPath,
    },
  };
  const seaConfigPath = path.join(distDir, `sea-config.${suffix}.json`);
  await writeFile(seaConfigPath, `${JSON.stringify(seaConfig, null, 2)}\n`, 'utf8');

  try {
    await run(process.execPath, ['--experimental-sea-config', seaConfigPath]);
  } catch {
    // Node >= 25.5 replaced the flag with a dedicated command.
    await run(process.execPath, ['--build-sea', seaConfigPath]);
  }

  console.log('3/4 Inyectando el blob en el ejecutable...');
  const outputPath = path.join(repoRoot, executableName());

  await copyFile(process.execPath, outputPath);
  await removeAuthenticodeSignature(outputPath);
  const blob = await readFile(seaConfig.output);
  await inject(outputPath, 'NODE_SEA_BLOB', blob, { sentinelFuse: SENTINEL_FUSE });

  if (!isWindows) {
    await chmod(outputPath, 0o755);
  }

  console.log('4/4 Verificando el ejecutable...');
  const version = await new Promise((resolve, reject) => {
    const child = spawn(outputPath, ['--version'], { stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', (chunk) => {
      output += String(chunk);
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve(output.trim());
      else reject(new Error(`El ejecutable arrancó con código ${code ?? '?'}`));
    });
  });

  const size = (await stat(outputPath)).size;
  console.log('');
  console.log('Listo.');
  console.log(`  ejecutable: ${outputPath}`);
  console.log(`  tamaño:     ${(size / (1024 * 1024)).toFixed(1)} MB`);
  console.log(`  versión:    ${version}`);
}

await main().catch((error) => {
  console.error(`Error durante el build: ${error.message}`);
  process.exitCode = 1;
});
