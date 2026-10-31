import { describe, expect, it } from 'vitest';
import { shuffle } from '../src/util/shuffle';

describe('shuffle', () => {
  it('keeps every element', () => {
    const input = [1, 2, 3, 4, 5];
    const result = shuffle(input, () => 0.5);
    expect([...result].sort((a, b) => a - b)).toEqual(input);
  });

  it('does not modify the original array', () => {
    const input = [1, 2, 3];
    shuffle(input, () => 0);
    expect(input).toEqual([1, 2, 3]);
  });

  it('reorders the elements', () => {
    const input = ['a', 'b', 'c'];
    const result = shuffle(input, () => 0);
    expect(result).not.toEqual(input);
    expect(result).toHaveLength(3);
  });

  it('handles empty and single element lists', () => {
    expect(shuffle([])).toEqual([]);
    expect(shuffle(['only'])).toEqual(['only']);
  });
});
