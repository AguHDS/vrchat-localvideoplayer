import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import type { Logger } from '../logger';

const POWERSHELL_SCRIPT = [
  'Add-Type -AssemblyName System.Windows.Forms;',
  '$dialog = New-Object System.Windows.Forms.OpenFileDialog;',
  "$dialog.Title = 'Select video files';",
  "$dialog.Filter = 'Videos|*.mp4;*.webm|All the files|*.*';",
  '$dialog.Multiselect = $true;',
  'if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {',
  '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8;',
  'Write-Output $dialog.FileNames }',
].join(' ');

export function parseSelectedPaths(output: string): string[] {
  const normalized = output.replace(/^\uFEFF/, '');
  return normalized.split(/\r?\n/u).filter((value) => value !== '');
}

export function parseZenityPaths(output: string): string[] {
  const normalized = output.replace(/^\uFEFF/, '');
  return normalized.split('|').filter((value) => value !== '');
}

export async function selectVideoFiles(logger: Logger): Promise<string[] | null> {
  if (process.platform === 'win32') {
    return selectWithPowerShell(logger);
  }
  if (process.platform === 'linux') {
    return selectWithLinux(logger);
  }
  return promptForPaths(logger);
}

export async function selectVideoFile(logger: Logger): Promise<string | null> {
  const selected = await selectVideoFiles(logger);
  return selected?.[0] ?? null;
}

function selectWithPowerShell(logger: Logger): Promise<string[] | null> {
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-Command', POWERSHELL_SCRIPT],
      { windowsHide: true, timeout: 180_000, maxBuffer: 1024 * 1024 },
      (error, stdoutData) => {
        if (error) {
          logger.warn(`No se pudo abrir el selector de Windows (${error.message}).`);
          resolve(promptForPaths(logger));
          return;
        }
        const selected = parseSelectedPaths(stdoutData);
        resolve(selected.length === 0 ? null : selected);
      },
    );
  });
}

async function selectWithLinux(logger: Logger): Promise<string[] | null> {
  const home = process.env['HOME'] ?? '.';
  const candidates: Array<{ cmd: string; args: string[] }> = [
    {
      cmd: 'zenity',
      args: [
        '--file-selection',
        '--multiple',
        '--title=Select video files',
        '--file-filter=Video | *.mp4 *.webm',
        '--file-filter=All the files | *',
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
      logger.debug(`${candidate.cmd} not installed.`);
      continue;
    }
    if (result.kind === 'cancelled') return null;
    if (result.kind === 'error') {
      logger.warn(`The selector ${candidate.cmd} failed: ${result.message}`);
      continue;
    }
    const selected =
      candidate.cmd === 'zenity'
        ? parseZenityPaths(result.value)
        : parseSelectedPaths(result.value);
    if (selected.length > 0) return selected;
  }

  logger.warn('Interactive selector not available; enter the paths to the videos.');
  return promptForPaths(logger);
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
        resolve({ kind: 'selected', value: stdoutData });
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

async function promptForPaths(logger: Logger): Promise<string[] | null> {
  if (!stdin.isTTY) {
    logger.warn('There is no interactive terminal, and none was specified --file.');
    return null;
  }
  const rl = readline.createInterface({ input: stdin, output: stdout });
  const selected: string[] = [];
  try {
    while (true) {
      const answer = await rl.question(
        selected.length === 0 ? 'Path to video file: ' : 'Path to another video (empty to finish): ',
      );
      const trimmed = answer.trim().replace(/^"|"$/g, '');
      if (trimmed === '') {
        return selected.length === 0 ? null : selected;
      }
      if (!existsSync(trimmed)) {
        logger.warn(`The file does not exist: ${trimmed}`);
        continue;
      }
      selected.push(trimmed);
    }
  } catch {
    return selected.length === 0 ? null : selected;
  } finally {
    rl.close();
  }
}
