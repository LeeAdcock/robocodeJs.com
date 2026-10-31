import { describe, expect, it } from 'vitest';

import {
  appFileName,
  erasesServerCode,
  sourceFromText,
  sourceVersion,
} from '../src/source';

describe('sourceVersion', () => {
  it('matches the server fingerprint (first 16 hex of SHA-256)', () => {
    expect(sourceVersion('')).toBe('e3b0c44298fc1c14');
    expect(sourceVersion('abc')).toBe('ba7816bf8f01cfea');
  });
});

describe('sourceFromText', () => {
  const empty = sourceVersion('');

  it('maps the empty-app sentence to empty source', () => {
    const sentence =
      'This app ("Sweeper", 1) has no source yet — it is empty. Add code with set_app_source.';
    expect(sourceFromText(sentence, empty)).toBe('');
  });

  it('passes real source through', () => {
    const source = 'bot.turn(10);';
    expect(sourceFromText(source, sourceVersion(source))).toBe(source);
  });
});

describe('appFileName', () => {
  it('uses the app name', () => {
    expect(appFileName('Sweeper')).toBe('Sweeper.js');
  });

  it('strips path separators and leading dots', () => {
    expect(appFileName('../a/b')).toBe('_a_b.js');
  });

  it('falls back for an empty name', () => {
    expect(appFileName('  ')).toBe('app.js');
  });
});

describe('erasesServerCode', () => {
  const code = sourceVersion('bot.turn(10);');
  const empty = sourceVersion('');

  it('flags an empty file pushed over real server code', () => {
    expect(erasesServerCode('', code)).toBe(true);
  });

  it('treats a whitespace-only file as empty', () => {
    expect(erasesServerCode('  \n\t\n', code)).toBe(true);
  });

  it('allows an empty file when the server copy is already empty', () => {
    expect(erasesServerCode('', empty)).toBe(false);
  });

  it('allows any non-empty push', () => {
    expect(erasesServerCode('bot.turn(20);', code)).toBe(false);
    expect(erasesServerCode('bot.turn(20);', empty)).toBe(false);
  });
});
