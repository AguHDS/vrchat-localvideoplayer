import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import type { Logger } from '../logger';

const POWERSHELL_SCRIPT = [
  'Add-Type -AssemblyName System.Windows.Forms;',
  '$dialog = New-Object System.Windows.Forms.OpenFileDialog;',
  "$dialog.Title = 'Seleccionar archivo de video';",
  "$dialog.Filter = 'Videos|*.mp4;*.webm|Todos los archivos|*.*';",
  'if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {',
  '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8;',
  'Write-Output $dialog.FileName }',
].join(' ');

export async function selectVideoFile(logger: Logger): Promise<string | null> {
  if (process.platform === 'win32') {
    return selectWithPowerShell(logger);
  }
  if (process.platform === 'linux') {
    return selectWithLinux(logger);
  }
  return promptForPath(logger);
}

function selectWithPowerShell(logger: Logger): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-Command', POWERSHELL_SCRIPT],
      { windowsHide: true, timeout: 180_000, maxBuffer: 1024 * 1024 },
      (error, stdoutData) => {
        if (error) {
          logger.warn(`No se pudo abrir el selector de Windows (${error.message}).`);
          resolve(promptForPath(logger));
          return;
        }
        const selected = stdoutData.trim();
        if (selected === '') {
          resolve(null);
          return;
        }
        resolve(selected);
      },
    );
  });
}

async function selectWithLinux(logger: Logger): Promise<string | null> {
  const home = process.env['HOME'] ?? '.';
  const candidates: Array<{ cmd: string; args: string[] }> = [
    {
      cmd: 'zenity',
      args: [
        '--file-selection',
        '--title=Seleccionar archivo de video',
        '--file-filter=Video | *.mp4 *.webm',
        '--file-filter=Todos los archivos | *',
      ],
    },
    {
      cmd: 'kdialog',
      args: ['--getopenfilename', home, 'Video | *.mp4 *.webm'],
    },
  ];

  for (const candidate of candidates) {
    const result = await runDialog(candidate.cmd, candidate.args);
    if (result.kind === 'not-installed') {
      logger.debug(`${candidate.cmd} no está instalado.`);
      continue;
    }
    if (result.kind === 'cancelled') return null;
    if (result.kind === 'error') {
      logger.warn(`El selector ${candidate.cmd} falló: ${result.message}`);
      continue;
    }
    if (result.value !== '') return result.value;
  }

  logger.warn('No hay selector gráfico disponible, escribí la ruta del video.');
  return promptForPath(logger);
}

type DialogResult =
  | { kind: 'selected'; value: string }
  | { kind: 'cancelled' }
  | { kind: 'not-installed' }
  | { kind: 'error'; message: string };

function runDialog(cmd: string, args: string[]): Promise<DialogResult> {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: 180_000, maxBuffer: 1024 * 1024 }, (error, stdoutData) => {
      if (!error) {
        resolve({ kind: 'selected', value: stdoutData.trim() });
        return;
      }
      const code = (error as { code?: string | number }).code;
      if (code === 'ENOENT') {
        resolve({ kind: 'not-installed' });
        return;
      }
      if (code === 1) {
        resolve({ kind: 'cancelled' });
        return;
      }
      resolve({ kind: 'error', message: error.message });
    });
  });
}

async function promptForPath(logger: Logger): Promise<string | null> {
  if (!stdin.isTTY) {
    logger.warn('No hay terminal interactiva y no se indicó --file.');
    return null;
  }
  const rl = readline.createInterface({ input: stdin, output: stdout });
  try {
    const answer = await rl.question('Ruta del archivo de video: ');
    const trimmed = answer.trim().replace(/^"|"$/g, '');
    if (trimmed === '') return null;
    if (!existsSync(trimmed)) {
      logger.warn(`El archivo no existe: ${trimmed}`);
      return null;
    }
    return trimmed;
  } finally {
    rl.close();
  }
}
