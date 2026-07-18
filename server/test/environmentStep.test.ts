import { describe, it, expect, vi } from 'vitest';

// step() advances a *paused* arena by exactly one tick — the debug view's
// single-step control. It must run one tick and leave the arena paused again
// (not start the free-running loop), and it must refuse to run while the arena
// is already ticking (running or looping) so a step can't race the loop.
vi.mock('../src/util/db', () => ({
  default: { query: () => Promise.resolve({ rows: [], rowCount: 0 }) },
}));

// step()/tick() rebuild nothing, but the loop path touches AppService on
// restart in sibling tests; stub it out for parity and isolation (no isolates).
vi.mock('../src/services/AppService', () => ({
  default: { get: () => Promise.resolve(null) },
}));

import Bot from '../src/types/bot';
import Environment, { Process } from '../src/types/environment';
import Arena from '../src/types/arena';

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('Environment.step (single tick)', () => {
  // One live bot (health 100, code not loaded so no handlers run) keeps the
  // arena from auto-pausing on the game-over check — an empty roster would end
  // the match before a tick advances.
  const withProcess = () => {
    const env = new Environment(new Arena('a', 'u'));
    const process = new Process('app1');
    process.bots.push(new Bot(env, process));
    env.getProcesses().push(process);
    return env;
  };

  it('advances a paused arena by exactly one tick and leaves it paused', async () => {
    const env = withProcess();
    expect(env.isRunning()).toBe(false);
    expect(env.getTime()).toBe(0);

    const stepped = await env.step();

    expect(stepped).toBe(true);
    expect(env.getTime()).toBe(1);
    // Still paused — a step is a single tick, not a resume.
    expect(env.isRunning()).toBe(false);
    expect(env.isLooping()).toBe(false);

    // Each step advances by one and only one.
    await env.step();
    expect(env.getTime()).toBe(2);
  });

  it('refuses to step while the arena is running (returns false, no extra tick)', async () => {
    const env = withProcess();
    env.setSpeed(0); // unbounded, so the loop is reliably mid-flight
    env.resume();
    await delay(30);
    expect(env.isRunning()).toBe(true);

    const before = env.getTime();
    const stepped = await env.step();

    // The running loop owns the clock; step must not inject its own tick.
    expect(stepped).toBe(false);
    expect(env.getTime()).toBeGreaterThanOrEqual(before);

    await env.pause();
  });
});
