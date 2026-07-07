import { describe, it, expect, vi } from 'vitest';

// A fixed random seed makes an arena's setup — bot placement and starting
// orientations — reproduce exactly, so accelerated headless runs are repeatable.
vi.mock('../src/util/db', () => ({
  default: { query: () => Promise.resolve({ rows: [], rowCount: 0 }) },
}));

import Bot from '../src/types/bot';
import Environment from '../src/types/environment';
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
