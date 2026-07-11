import { describe, it, expect } from 'vitest';
import { abbreviateName } from '../src/util/displayName';

// The leaderboard shows owners as "First L." so a public, unauthenticated page
// never exposes a full surname (GitHub #151).
describe('abbreviateName', () => {
  it('reduces a two-part name to first name + last initial', () => {
    expect(abbreviateName('Ada Lovelace')).toBe('Ada L.');
  });

  it('drops middle tokens, keeping first + last initial', () => {
    expect(abbreviateName('Grace B. Hopper')).toBe('Grace H.');
  });

  it('leaves a single-token name unchanged (nothing to abbreviate)', () => {
    expect(abbreviateName('Prince')).toBe('Prince');
  });

  it('collapses extra whitespace', () => {
    expect(abbreviateName('  Alan   Turing  ')).toBe('Alan T.');
  });

  it('falls back to Anonymous for empty/missing names', () => {
    expect(abbreviateName('')).toBe('Anonymous');
    expect(abbreviateName(null)).toBe('Anonymous');
    expect(abbreviateName(undefined)).toBe('Anonymous');
  });
});
