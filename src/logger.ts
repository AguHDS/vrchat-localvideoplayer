import { appendFileSync } from 'node:fs';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const ANSI = {
  reset: '\u001b[0m',
  gray: '\u001b[90m',
  cyan: '\u001b[36m',
  yellow: '\u001b[33m',
  red: '\u001b[31m',
  green: '\u001b[32m',
} as const;

export interface LoggerOptions {
  level: LogLevel;
  quiet?: boolean;
  logFile?: string;
  color?: boolean;
}

function pad(value: number): string {
  return value.toString().padStart(2, '0');
}

function timestamp(date: Date): string {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

export class Logger {
  private readonly level: LogLevel;
  private readonly quiet: boolean;
  private readonly logFile: string | undefined;
  private readonly color: boolean;

  constructor(options: LoggerOptions) {
    this.level = options.level;
    this.quiet = options.quiet ?? false;
    this.logFile = options.logFile;
    this.color =
      options.color ??
      (process.env['NO_COLOR'] === undefined && process.stdout.isTTY === true);
  }

  private enabled(level: LogLevel): boolean {
    return LEVEL_ORDER[level] >= LEVEL_ORDER[this.level];
  }

  private write(level: LogLevel, message: string, stream: NodeJS.WriteStream): void {
    if (!this.enabled(level)) return;
    const stamp = timestamp(new Date());
    const label = level.toUpperCase().padEnd(5, ' ');
    const colored = this.color
      ? `${this.colorFor(level)}${label}${ANSI.reset}`
      : label;
    const line = `[${stamp}] ${colored} ${message}`;
    stream.write(`${line}\n`);
    this.appendToFile(`[${stamp}] ${level.toUpperCase()} ${message}`);
  }

  private colorFor(level: LogLevel): string {
    switch (level) {
      case 'debug':
        return ANSI.gray;
      case 'info':
        return ANSI.cyan;
      case 'warn':
        return ANSI.yellow;
      case 'error':
        return ANSI.red;
    }
  }

  private appendToFile(line: string): void {
    if (!this.logFile) return;
    try {
      appendFileSync(this.logFile, `${line}\n`, 'utf8');
    } catch {
      // Never let logging break the application.
    }
  }

  debug(message: string): void {
    this.write('debug', message, process.stdout);
  }

  info(message: string): void {
    this.write('info', message, process.stdout);
  }

  warn(message: string, hint?: string): void {
    this.write('warn', message, process.stderr);
    if (hint !== undefined) {
      this.write('warn', `Ayuda: ${hint}`, process.stderr);
    }
  }

  error(message: string): void {
    this.write('error', message, process.stderr);
  }

  /** Raw output without any prefix, used for the shareable URL. */
  print(message: string): void {
    if (this.quiet) return;
    process.stdout.write(`${message}\n`);
    this.appendToFile(message);
  }

  /** Always visible, even in quiet mode (used for the URL in quiet mode). */
  printAlways(message: string): void {
    process.stdout.write(`${message}\n`);
    this.appendToFile(message);
  }
}
