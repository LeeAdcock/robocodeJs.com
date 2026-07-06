import { describe, it, expect } from 'vitest';
import {
  parseMessage,
  MAX_MESSAGE_CHARS,
  MAX_MESSAGE_DEPTH,
} from '../src/util/message';

// parseMessage is the host-side gate for bot.send: the bot-side wrapper
// JSON.stringifies the payload, so only a JSON string ever crosses the sandbox
// boundary. JSON is the whitelist (no functions/Dates/Maps/references); these
// tests lock the accepted shapes and the size/depth caps.
describe('parseMessage', () => {
  it('accepts JSON primitives (backward compatible with a bare number)', () => {
    expect(parseMessage('7')).toBe(7);
    expect(parseMessage(JSON.stringify('hi'))).toBe('hi');
    expect(parseMessage('true')).toBe(true);
    expect(parseMessage('null')).toBe(null);
  });

  it('accepts nested objects and arrays of primitives', () => {
    const value = {
      secret: 8,
      path: [
        [1, 2],
        [3, 4],
      ],
      flag: true,
    };
    expect(parseMessage(JSON.stringify(value))).toEqual(value);
  });

  it('rejects a non-string (a value that could not be serialized)', () => {
    // JSON.stringify(undefined | function | symbol) yields undefined.
    expect(() => parseMessage(undefined)).toThrow(/E023/);
  });

  it('rejects invalid JSON', () => {
    expect(() => parseMessage('{not json')).toThrow(/E023/);
  });

  it('rejects an over-large message', () => {
    const big = JSON.stringify('x'.repeat(MAX_MESSAGE_CHARS + 10));
    expect(() => parseMessage(big)).toThrow(/too large/);
  });

  it('rejects an over-deep message', () => {
    let deep: unknown = 0;
    for (let i = 0; i < MAX_MESSAGE_DEPTH + 2; i++) deep = [deep];
    expect(() => parseMessage(JSON.stringify(deep))).toThrow(
      /nested too deeply/
    );
  });
});
