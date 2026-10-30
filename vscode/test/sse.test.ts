import { describe, expect, it } from 'vitest';

import { SseParser } from '../src/sse';

describe('SseParser', () => {
  it('returns each complete event once', () => {
    const p = new SseParser();
    expect(p.feed('data: {"id":1}\n\ndata: {"id":2}\n\n')).toEqual([
      '{"id":1}',
      '{"id":2}',
    ]);
  });

  it('holds a partial event until it completes', () => {
    const p = new SseParser();
    expect(p.feed('data: {"i')).toEqual([]);
    expect(p.feed('d":1}\n')).toEqual([]);
    expect(p.feed('\n')).toEqual(['{"id":1}']);
  });

  it('ignores the heartbeat and preamble comments', () => {
    const p = new SseParser();
    expect(p.feed(': connected\n\n: heartbeat\n\ndata: x\n\n')).toEqual(['x']);
  });

  it('accepts CRLF line endings, including one split across chunks', () => {
    const p = new SseParser();
    expect(p.feed('data: a\r')).toEqual([]);
    expect(p.feed('\n\r\n')).toEqual(['a']);
  });

  it('joins multi-line data with newlines', () => {
    expect(new SseParser().feed('data: a\ndata: b\n\n')).toEqual(['a\nb']);
  });
});
