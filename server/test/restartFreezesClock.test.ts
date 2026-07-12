import { describe, it, expect, vi } from 'vitest';

// restart() must stop the tick loop and freeze the clock before rebuilding bots.
// Otherwise a restart on a *running* arena lets the loop keep advancing clock.time
// while each bot's code reloads asynchronously, so bots fire START one at a time
// on different, nonzero ticks instead of all together at 0 (the reported "bots
// start at inconsistent clock ticks; sometimes 0, sometimes not" behavior).
vi.mock('../src/util/db', () => ({
  default: { query: () => Promise.resolve({ rows: [], rowCount: 0 }) },
}));

// restart() looks up each process's app to rebuild its bots; returning null
// short-circuits that (no isolates), leaving just the loop/clock bookkeeping
// under test.
vi.mock('../src/services/AppService', () => ({
  default: { get: () => Promise.resolve(null) },
}));

import Bot from '../src/types/bot';
import Environment, { Process } from '../src/types/environment';
import Arena from '../src/types/arena';

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('restart freezes the clock', () => {
  // A process with one live bot (health 100, code not loaded so no handlers run)
  // so the tick loop keeps running — an empty roster would auto-pause on the
  // game-over check before restart is even called.
  const withProcess = () => {
    const env = new Environment(new Arena('a', 'u'));
    const process = new Process('app1');
    process.bots.push(new Bot(env, process));
    env.getProcesses().push(process);
    return env;
  };

  it('stops a running loop and resets the clock to 0', async () => {
    const env = withProcess();
    env.setSpeed(0); // unbounded, so the loop advances the clock quickly
    env.resume();

    // Let the running loop advance the clock past 0.
    await delay(40);
    expect(env.getTime()).toBeGreaterThan(0);
    expect(env.isRunning()).toBe(true);

    await env.restart();

    // restart() leaves the arena paused, with the loop fully stopped and the
    // clock frozen at 0 — not advanced by a loop that kept ticking during the
    // (async) bot reload.
    expect(env.isRunning()).toBe(false);
    expect(env.isLooping()).toBe(false);
    expect(env.getTime()).toBe(0);
  });

  it('is a no-op drain when the arena was already paused', async () => {
    const env = withProcess();
    // Never resumed: no loop to drain, so restart resolves without waiting.
    await env.restart();
    expect(env.isRunning()).toBe(false);
    expect(env.getTime()).toBe(0);
  });
});
