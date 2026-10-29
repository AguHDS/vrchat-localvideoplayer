import { describe, expect, it } from 'vitest';
import { parseCommand } from '../src/commands';

describe('parseCommand', () => {
  it('parses the add command', () => {
    expect(parseCommand('a')).toBe('add');
    expect(parseCommand('add')).toBe('add');
    expect(parseCommand('  A  ')).toBe('add');
    expect(parseCommand('añadir')).toBe('add');
  });

  it('parses the list command', () => {
    expect(parseCommand('l')).toBe('list');
    expect(parseCommand('list')).toBe('list');
  });

  it('parses the help command', () => {
    expect(parseCommand('h')).toBe('help');
    expect(parseCommand('help')).toBe('help');
  });

  it('parses the quit command', () => {
    expect(parseCommand('q')).toBe('quit');
    expect(parseCommand('exit')).toBe('quit');
    expect(parseCommand('salir')).toBe('quit');
  });

  it('returns null for unknown or empty input', () => {
    expect(parseCommand('')).toBeNull();
    expect(parseCommand('   ')).toBeNull();
    expect(parseCommand('xyz')).toBeNull();
  });
});
