import { describe, it, expect } from 'vitest';
import { isNameProfane, NameRejectedError } from '../src/util/nameFilter';

// Also verifies the glin-profanity import resolves and runs under our build.
describe('isNameProfane', () => {
  it('allows ordinary names', () => {
    expect(isNameProfane('Overlord')).toBe(false);
    expect(isNameProfane('Turret Bot 3000')).toBe(false);
    expect(isNameProfane('Skirmisher')).toBe(false);
    expect(isNameProfane('')).toBe(false);
  });

  it('flags clear profanity', () => {
    expect(isNameProfane('fuck')).toBe(true);
    expect(isNameProfane('My fucking bot')).toBe(true);
  });

  it('sees through basic leetspeak obfuscation', () => {
    expect(isNameProfane('f4ck')).toBe(true);
  });

  it('NameRejectedError carries a user-facing message', () => {
    const e = new NameRejectedError();
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe('NameRejectedError');
    expect(e.message).toMatch(/inappropriate/i);
  });
});
