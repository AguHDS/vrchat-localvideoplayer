import { spawn } from 'node:child_process';

export async function copyToClipboard(text: string): Promise<boolean> {
  const candidates =
    process.platform === 'win32'
      ? [{ cmd: 'clip.exe', args: [] as string[] }]
      : [
          { cmd: 'wl-copy', args: [] as string[] },
          { cmd: 'xclip', args: ['-selection', 'clipboard'] },
          { cmd: 'xsel', args: ['--clipboard', '--input'] },
        ];

  for (const candidate of candidates) {
    if (await runClipboardCommand(candidate.cmd, candidate.args, text)) return true;
  }
  return false;
}

function runClipboardCommand(cmd: string, args: string[], text: string): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const child = spawn(cmd, args, {
        windowsHide: true,
        stdio: ['pipe', 'ignore', 'ignore'],
      });
      child.on('error', () => resolve(false));
      child.on('close', (code) => resolve(code === 0));
      child.stdin.on('error', () => undefined);
      child.stdin.end(text);
    } catch {
      resolve(false);
    }
  });
}
