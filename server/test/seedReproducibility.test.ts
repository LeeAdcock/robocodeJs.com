import { describe, it, expect, vi } from 'vitest';

// A fixed random seed makes an arena's setup — bot placement and starting
// orientations — reproduce exactly, so accelerated headless runs are repeatable.
vi.mock('../src/util/db', () => ({
  default: { query: () => Promise.resolve({ rows: [], rowCount: 0 }) },
}));

// restart() looks up each process's app to rebuild its bots; returning null
// short-circuits that (no isolates), leaving just the seed/stream bookkeeping
// under test.
vi.mock('../src/services/AppService', () => ({
  default: { get: () => Promise.resolve(null) },
}));

import Bot from '../src/types/bot';
import Environment, { Process } from '../src/types/environment';
import Arena from '../src/types/arena';
import { makeSimEnv } from './simEnv';

// Build `n` bots in a world and capture the randomized placement/orientation the
// seeded PRNG produced for each.
const layout = (seed: number, n = 5) => {
  const world = makeSimEnv({ seed, run: () => undefined });
  const proc = { bots: [] as Bot[], getAppId: () => 'app1' };
  world.processes.push(proc as never);
  const bots = Array.from({ length: n }, () => {
    const t = new Bot(world.env, proc as never);
    proc.bots.push(t);
    return t;
  });
  return bots.map((t) => ({
    x: t.x,
    y: t.y,
    orientation: t.orientation,
    turret: t.turret.orientation,
    radar: t.turret.radar.orientation,
  }));
};

describe('configurable random seed', () => {
  it('reproduces identical setup for the same seed', () => {
    expect(layout(12345)).toEqual(layout(12345));
  });

  it('produces different setups for different seeds', () => {
    expect(layout(1)).not.toEqual(layout(2));
  });

  it('Environment.setSeed makes env.random() deterministic and reseedable', () => {
    const env = new Environment(new Arena('a', 'u'));

    env.setSeed(42);
    const first = [env.random(), env.random(), env.random()];
    expect(env.getSeed()).toBe(42);

    // Reseeding to the same value replays the identical stream.
    env.setSeed(42);
    expect([env.random(), env.random(), env.random()]).toEqual(first);

    // A different seed yields a different stream.
    env.setSeed(43);
    expect([env.random(), env.random(), env.random()]).not.toEqual(first);
  });
});

// restart() must rewind the PRNG rather than let it drift across matches:
// otherwise a second restart continues the stream and the match diverges even
// though getSeed() is unchanged (reported via the MCP client). A pinned seed
// reproduces every restart; an unpinned arena mints a fresh (emitted) seed.
describe('restart rewinds the PRNG', () => {
  // An Environment with one process so restart()'s spawn layout actually draws
  // from the stream; the mocked AppService.get keeps it isolate-free.
  const withProcess = () => {
    const env = new Environment(new Arena('a', 'u'));
    env.getProcesses().push(new Process('app1'));
    return env;
  };
  const drawn = (env: Environment, n = 4) =>
    Array.from({ length: n }, () => env.random());

  it('a pinned seed reproduces the identical stream on every restart', async () => {
    const env = withProcess();
    env.setSeed(42);

    await env.restart();
    const first = drawn(env);
    await env.restart();
    const second = drawn(env);

    expect(second).toEqual(first);
    expect(env.getSeed()).toBe(42); // the pinned value never drifts
  });

  it('an unpinned arena mints a fresh, emitted seed on each restart', async () => {
    const env = withProcess();
    const emitted: number[] = [];
    env.addListener('event', (e: unknown) => {
      const ev = e as { type?: string; seed?: number };
      if (ev?.type === 'arenaSeed' && typeof ev.seed === 'number')
        emitted.push(ev.seed);
    });

    await env.restart();
    const seedA = env.getSeed();
    const streamA = drawn(env);
    await env.restart();
    const seedB = env.getSeed();
    const streamB = drawn(env);

    expect(seedB).not.toBe(seedA); // a fresh seed each restart
    expect(streamB).not.toEqual(streamA);
    // Each freshly-minted seed is broadcast, so the match that just ran is
    // reproducible after the fact by pinning it.
    expect(emitted).toContain(seedA);
    expect(emitted).toContain(seedB);
  });
});
