import { describe, it, expect, vi } from 'vitest';

// Environment -> compiler -> appService -> util/db runs at import; mock the pool.
vi.mock('../src/util/db', () => ({
  default: { query: () => Promise.resolve({ rows: [], rowCount: 0 }) },
}));

import Environment from '../src/types/environment';
import Arena from '../src/types/arena';

// Every bot console log record carries an id so the UI can dedupe the replay the
// /arena/logs stream sends on each reconnect. It used to be a randomUUID(): 44
// bytes of entropy per ~196-byte record, on a stream that measured 136.8 MB in a
// single prod hour. A counter is the same guarantee for a fraction of the bytes
// (and compresses, which random ids actively defeat).
describe('Environment log ids', () => {
  it('hands out strictly increasing, unique ids', () => {
    const env = new Environment(new Arena('ar1', 'u1'));

    const ids = Array.from({ length: 10_000 }, () => env.nextLogId());

    expect(ids[0]).toBe(1);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id, i) => i === 0 || id > ids[i - 1])).toBe(true);
    expect(ids.every((id) => Number.isSafeInteger(id))).toBe(true);
  });

  it('counts per arena, so ids stay small', () => {
    const a = new Environment(new Arena('ar1', 'u1'));
    const b = new Environment(new Arena('ar2', 'u2'));

    a.nextLogId();
    a.nextLogId();

    // b's stream is its own; a busy neighbour doesn't inflate its ids.
    expect(b.nextLogId()).toBe(1);
    expect(a.nextLogId()).toBe(3);
  });

  it('keeps ids unique across the buffered logs it replays', () => {
    const env = new Environment(new Arena('ar1', 'u1'));

    for (let i = 0; i < 5; i++)
      env.emit('log', { id: env.nextLogId(), msg: 'x' });

    const ids = (env.getRecentLogs() as { id: number }[]).map((e) => e.id);
    expect(ids).toEqual([1, 2, 3, 4, 5]);
  });
});
