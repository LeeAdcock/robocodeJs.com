import { describe, it, expect } from 'vitest';
import nameFactory from '../src/util/nameFactory';

// nameFactory builds a random display name "Bot <adjective> <noun>".
describe('nameFactory', () => {
  it('produces a "Bot <adjective> <noun>" name', () => {
    for (let i = 0; i < 100; i++) {
      expect(nameFactory()).toMatch(/^Bot [a-z]+ [a-z]+$/);
    }
  });

  it('is randomized (produces more than one distinct value)', () => {
    const names = new Set(Array.from({ length: 50 }, () => nameFactory()));
    expect(names.size).toBeGreaterThan(1);
  });

  // NOTE (refactor backlog): selection uses Math.floor(Math.random() * (len - 1)),
  // so the final adjective and noun in each list can never be chosen (off-by-one).
});
