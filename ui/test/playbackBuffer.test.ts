import { describe, it, expect } from 'vitest';
import PlaybackBuffer, {
  NOMINAL_TICK_MS,
  BUFFER_TARGET_TICKS,
  MAX_BUFFER_DEPTH,
  MIN_PLAYBACK_TICK_MS,
  ArenaEvent,
} from '../src/util/playbackBuffer';

// Helpers ------------------------------------------------------------------

let nextTick = 1;
const tick = (): ArenaEvent => ({ type: 'tick', time: nextTick++ });
const action = (type: string, id = 'a'): ArenaEvent => ({ type, id });

// Push N complete tick-groups, each just a bare `tick` event.
const pushTicks = (b: PlaybackBuffer, n: number) => {
  for (let i = 0; i < n; i++) b.push(tick());
};

// Drain and return the list of released events.
const drainCollect = (b: PlaybackBuffer, dtMs: number): ArenaEvent[] => {
  const out: ArenaEvent[] = [];
  b.drain(dtMs, (e) => out.push(e));
  return out;
};

// Tests --------------------------------------------------------------------

describe('PlaybackBuffer', () => {
  it('holds playback until the startup cushion is filled', () => {
    const b = new PlaybackBuffer();
    pushTicks(b, BUFFER_TARGET_TICKS - 1);

    // Below the cushion: a big time slice still releases nothing.
    expect(b.drain(10_000, () => {})).toBe(0);

    // One more group reaches the cushion; now it plays.
    pushTicks(b, 1);
    expect(b.drain(NOMINAL_TICK_MS, () => {})).toBe(1);
  });

  it('releases roughly one group per nominal tick once playing', () => {
    const b = new PlaybackBuffer();
    pushTicks(b, BUFFER_TARGET_TICKS + 2); // depth in the steady (1.0) band

    // While depth stays at/above target the cadence is exactly one per tick.
    expect(b.drain(NOMINAL_TICK_MS, () => {})).toBe(1);
    expect(b.drain(NOMINAL_TICK_MS, () => {})).toBe(1);
    expect(b.drain(NOMINAL_TICK_MS, () => {})).toBe(1);
  });

  it('smooths a bursty arrival into a steady release rate', () => {
    const b = new PlaybackBuffer();
    // A big burst arrives all at once.
    pushTicks(b, 40);

    // Then we drain at 60fps for ~1 second of wall-clock.
    let released = 0;
    for (let elapsed = 0; elapsed < 1000; elapsed += 16) {
      released += b.drain(16, () => {});
    }

    // ~10 ticks/sec nominal; the catch-up factor (deep buffer) allows a little
    // more, but it must be steady, not a 40-event dump.
    expect(released).toBeGreaterThanOrEqual(9);
    expect(released).toBeLessThanOrEqual(13);
  });

  it('eases off as the buffer approaches underrun', () => {
    const b = new PlaybackBuffer();
    pushTicks(b, BUFFER_TARGET_TICKS); // exactly the cushion

    // Drains at the cushion play at full rate down to just below target...
    let released = 0;
    for (let i = 0; i < BUFFER_TARGET_TICKS; i++) {
      released += b.drain(NOMINAL_TICK_MS, () => {});
    }
    // ...but the last steps slow down (0.9x), so not all groups drain in N ticks.
    expect(released).toBeLessThan(BUFFER_TARGET_TICKS);
    expect(released).toBeGreaterThan(0);
  });

  it('freezes (and does not burst) on underrun', () => {
    const b = new PlaybackBuffer();
    pushTicks(b, BUFFER_TARGET_TICKS);
    // Drain everything.
    b.drain(10_000, () => {});
    expect(b.depth()).toBe(0);

    // Empty buffer: large time slices release nothing and don't bank credit.
    expect(b.drain(10_000, () => {})).toBe(0);

    // When a single new group arrives it plays promptly — not a backlog dump.
    pushTicks(b, 1);
    expect(b.drain(NOMINAL_TICK_MS, () => {})).toBe(1);
  });

  it('preserves event order within a tick-group', () => {
    const b = new PlaybackBuffer();
    // First group carries actions before its terminating tick.
    b.push(action('tankTurn'));
    b.push(action('bulletFired'));
    b.push(tick());
    pushTicks(b, BUFFER_TARGET_TICKS - 1); // reach the cushion

    const released = drainCollect(b, NOMINAL_TICK_MS);
    expect(released.map((e) => e.type)).toEqual([
      'tankTurn',
      'bulletFired',
      'tick',
    ]);
  });

  it('only counts complete (tick-terminated) groups as depth', () => {
    const b = new PlaybackBuffer();
    pushTicks(b, 2);
    b.push(action('tankTurn')); // trailing, not yet terminated by a tick
    expect(b.depth()).toBe(2);
    b.push(tick());
    expect(b.depth()).toBe(3);
  });

  it('flush empties the queue and resets playback', () => {
    const b = new PlaybackBuffer();
    pushTicks(b, BUFFER_TARGET_TICKS + 3);
    b.flush();
    expect(b.depth()).toBe(0);
    // Back to the unstarted state: must refill the cushion before playing.
    pushTicks(b, BUFFER_TARGET_TICKS - 1);
    expect(b.drain(10_000, () => {})).toBe(0);
  });

  it('paces playback to the server tick period set via setTickMs', () => {
    const b = new PlaybackBuffer();
    b.setTickMs(50); // server running at 2x (50ms/tick)
    pushTicks(b, BUFFER_TARGET_TICKS + 4); // deep enough to stay in the 1.0 band

    // One nominal (100ms) slice now releases ~2 groups instead of 1.
    expect(b.drain(50, () => {})).toBe(1);
    expect(b.drain(50, () => {})).toBe(1);
  });

  it('clamps an unbounded (0) tick period to the fast playback floor', () => {
    const b = new PlaybackBuffer();
    b.setTickMs(0); // unbounded / "as fast as possible"
    pushTicks(b, BUFFER_TARGET_TICKS + 4);

    // A slice shorter than the floor releases nothing; one floor's worth releases one.
    expect(b.drain(MIN_PLAYBACK_TICK_MS - 1, () => {})).toBe(0);
    expect(b.drain(1, () => {})).toBe(1);
  });

  it('hard-catches-up (without dumping unbounded memory) past the depth ceiling', () => {
    const b = new PlaybackBuffer();
    // Server far outruns the client: a huge backlog piles up.
    pushTicks(b, MAX_BUFFER_DEPTH + 25);

    // Even a tiny time slice drains the overflow immediately so depth is bounded,
    // and every event still gets released (state stays consistent).
    const released = b.drain(0, () => {});
    expect(released).toBeGreaterThanOrEqual(25);
    expect(b.depth()).toBeLessThanOrEqual(MAX_BUFFER_DEPTH);
  });
});
