export type Command = 'add' | 'list' | 'help' | 'quit';

export function parseCommand(line: string): Command | null {
  const text = line.trim().toLowerCase();
  switch (text) {
    case 'a':
    case 'add':
    case 'añadir':
      return 'add';
    case 'l':
    case 'list':
    case 'listar':
      return 'list';
    case 'h':
    case 'help':
    case 'ayuda':
      return 'help';
    case 'q':
    case 'exit':
    case 'salir':
      return 'quit';
    default:
      return null;
  }
}

export const COMMAND_HELP = [
  'Commands (type and press Enter):',
  'a - select new videos with a new URL',
  'l - list the videos in the current playlist',
  'h - show help',
  'q - stop the server and the tunnel',
].join('\n');
