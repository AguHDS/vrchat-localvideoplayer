#!/usr/bin/env node
/**
 * Builds the Linux executable. It must run on Linux (WSL included).
 * The result is written to the repository root as
 * vrchat-local-video-player-linux
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));

if (process.platform !== 'linux') {
  console.error('Este build solo puede ejecutarse en Linux (o WSL).');
  console.error('En Windows usá `npm run build:exe`.');
  process.exitCode = 1;
} else {
  const child = spawn(process.execPath, [path.join(scriptDir, 'build-exe.mjs'), '--platform', 'linux'], {
    stdio: 'inherit',
  });
  child.on('close', (code) => {
    process.exitCode = code ?? 1;
  });
}
