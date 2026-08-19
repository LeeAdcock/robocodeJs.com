// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';
import useLogsStream, { addLogMarker } from '../src/util/useLogsStream';

// The server replays its whole recent-logs buffer on every reconnect, so the
// store dedupes by record id. That id is a per-arena counter (it rides every
// record on a long-lived SSE stream, where a uuid's entropy cost is real
// bandwidth), which means these tests pin two things: small numbers still
// dedupe, and id 0 is not mistaken for "no id".
let sources: FakeEventSource[] = [];
class FakeEventSource {
  onmessage: ((e: { data: string }) => void) | null = null;
  closed = false;
  constructor(public url: string) {
    sources.push(this);
  }
  close() {
    this.closed = true;
  }
}

const entry = (over: Record<string, unknown>) => ({
  name: '<11>',
  appId: 'a1',
  botIndex: 1,
  level: 30,
  levelName: 'info',
  msg: 'hi',
  time: 0,
  ...over,
});

const push = (over: Record<string, unknown>) =>
  act(() => {
    sources[sources.length - 1].onmessage?.({
      data: JSON.stringify(entry(over)),
    });
  });

const messages = (logs: ({ msg: string } | null)[]) =>
  logs.filter(Boolean).map((l) => l!.msg);

describe('useLogsStream id handling', () => {
  beforeEach(() => {
    vi.stubGlobal('EventSource', FakeEventSource);
    sources = [];
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('drops replayed records by numeric id but keeps new ones', () => {
    // A fresh arena id, so the store starts from an empty ring.
    const { result } = renderHook(() => useLogsStream('u-dedupe'));

    push({ id: 1, msg: 'first' });
    push({ id: 2, msg: 'second' });
    // Reconnect replay: the same two records again, then one that is new.
    push({ id: 1, msg: 'first' });
    push({ id: 2, msg: 'second' });
    push({ id: 3, msg: 'third' });

    expect(messages(result.current.logs)).toEqual(['first', 'second', 'third']);
  });

  it('keeps an entry whose id is 0 rather than treating it as missing', () => {
    const { result } = renderHook(() => useLogsStream('u-zero'));

    push({ id: 0, msg: 'zeroth' });

    expect(messages(result.current.logs)).toEqual(['zeroth']);
  });

  it('gives lifecycle markers negative ids that cannot collide with the server', () => {
    const { result } = renderHook(() => useLogsStream('u-marker'));

    push({ id: 1, msg: 'before' });
    act(() => addLogMarker('restart', 'Match restarted', 0));
    push({ id: 2, msg: 'after' });

    const rows = result.current.logs.filter(Boolean) as {
      id: number;
      msg: string;
    }[];
    expect(rows.map((r) => r.msg)).toEqual([
      'before',
      'Match restarted',
      'after',
    ]);
    const marker = rows[1];
    expect(marker.id).toBeLessThan(0);
    expect(rows.map((r) => r.id)).toEqual([...new Set(rows.map((r) => r.id))]);
  });

  it('ignores a record with no id at all', () => {
    const { result } = renderHook(() => useLogsStream('u-noid'));

    push({ msg: 'unidentified' });
    push({ id: 1, msg: 'kept' });

    expect(messages(result.current.logs)).toEqual(['kept']);
  });
});
