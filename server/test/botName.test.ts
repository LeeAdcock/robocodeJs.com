import { describe, it, expect } from 'vitest';
import { sanitizeBotName, MAX_NAME_LENGTH } from '../src/util/botName';

// Special code points are built with String.fromCodePoint so this test file
// stays pure ASCII (literal invisible/control chars in source are unreviewable).
const cp = (n: number) => String.fromCodePoint(n);
const NUL = cp(0x00);
const DEL = cp(0x7f);
const SOFT_HYPHEN = cp(0x00ad);
const ZWSP = cp(0x200b);
const RLO = cp(0x202e); // right-to-left override (bidi spoofing)
const RLM = cp(0x200f);
const BOM = cp(0xfeff);
const ZWJ = cp(0x200d); // zero-width joiner — legitimately used, kept
const ZWNJ = cp(0x200c); // zero-width non-joiner — kept

describe('sanitizeBotName', () => {
  it('passes an ordinary name through unchanged', () => {
    expect(sanitizeBotName('Overlord')).toBe('Overlord');
    expect(sanitizeBotName('Turret Bot 3000')).toBe('Turret Bot 3000');
  });

  it('strips control characters and DEL', () => {
    expect(sanitizeBotName('Cool' + NUL + 'Bot')).toBe('CoolBot');
    expect(sanitizeBotName('a' + DEL + 'b')).toBe('ab');
  });

  it('strips bidi overrides, directional marks, and invisibles', () => {
    expect(sanitizeBotName('a' + RLO + 'b')).toBe('ab');
    expect(sanitizeBotName('a' + RLM + 'b')).toBe('ab');
    expect(sanitizeBotName('a' + ZWSP + 'b')).toBe('ab');
    expect(sanitizeBotName('a' + SOFT_HYPHEN + 'b')).toBe('ab');
    expect(sanitizeBotName(BOM + 'Name')).toBe('Name');
  });

  it('keeps the zero-width joiner / non-joiner (legit in scripts & emoji)', () => {
    expect(sanitizeBotName('a' + ZWJ + 'b')).toBe('a' + ZWJ + 'b');
    expect(sanitizeBotName('a' + ZWNJ + 'b')).toBe('a' + ZWNJ + 'b');
  });

  it('collapses whitespace runs and trims', () => {
    expect(sanitizeBotName('  Spaced   Out  ')).toBe('Spaced Out');
    expect(sanitizeBotName('tab\tsep')).toBe('tab sep');
  });

  it('caps length at MAX_NAME_LENGTH', () => {
    expect(sanitizeBotName('x'.repeat(200))).toHaveLength(MAX_NAME_LENGTH);
  });

  it('NFC-normalizes so equivalent forms compare equal', () => {
    // "é" as e + combining acute (NFD) normalizes to the single NFC code point.
    const nfd = 'e' + cp(0x0301);
    expect(sanitizeBotName(nfd)).toBe('é');
  });

  it('returns empty for empty / all-junk / nullish input', () => {
    expect(sanitizeBotName('')).toBe('');
    expect(sanitizeBotName('   ')).toBe('');
    expect(sanitizeBotName(NUL + ZWSP + RLO)).toBe('');
    expect(sanitizeBotName(null)).toBe('');
    expect(sanitizeBotName(undefined)).toBe('');
  });
});
