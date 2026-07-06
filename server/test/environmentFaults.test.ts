import { describe, it, expect, vi } from 'vitest';

// Environment -> compiler -> appService -> util/db runs at import; mock the pool.
vi.mock('../src/util/db', () => ({
  default: { query: () => Promise.resolve({ rows: [], rowCount: 0 }) },
}));

import Environment, { BotFault } from '../src/types/environment';
import Arena from '../src/types/arena';

const makeFault = (over: Partial<BotFault> = {}): BotFault => ({
  appId: 'a1',
  tankId: 't1',
  tankIndex: 1,
  code: 'E017',
  kind: 'load',
  message: 'boom',
  timedOut: false,
  time: 0,
  ...over,
});

describe('Environment fault feed', () => {
  it('reportFault buffers the fault and broadcasts a botFault event', () => {
    const env = new Environment(new Arena('ar1', 'u1'));
    const events: Array<Record<string, unknown>> = [];
    env.addListener('event', (e) => events.push(e as Record<string, unknown>));

    const fault = makeFault({ code: 'E013', kind: 'handler', line: 3 });
    env.reportFault(fault);

    // Broadcast on the SSE `event` stream as a `botFault`.
    const botFault = events.find((e) => e.type === 'botFault');
    expect(botFault).toMatchObject({ type: 'botFault', ...fault });
    // And retained in the buffer.
    expect(env.getRecentFaults()).toEqual([fault]);
  });

  it('getRecentFaults filters by appId and caps to the tail', () => {
    const env = new Environment(new Arena('ar1', 'u1'));
    env.reportFault(makeFault({ appId: 'a1', message: 'one' }));
    env.reportFault(makeFault({ appId: 'a2', message: 'two' }));
    env.reportFault(makeFault({ appId: 'a1', message: 'three' }));

    expect(env.getRecentFaults(undefined, 'a1').map((f) => f.message)).toEqual([
      'one',
      'three',
    ]);
    expect(env.getRecentFaults(1).map((f) => f.message)).toEqual(['three']);
  });

  it('bounds the buffer (drops the oldest past the cap)', () => {
    const env = new Environment(new Arena('ar1', 'u1'));
    for (let i = 0; i < 150; i++) env.reportFault(makeFault({ time: i }));
    const faults = env.getRecentFaults();
    expect(faults.length).toBe(100); // MAX_RECENT_FAULTS
    expect(faults[0].time).toBe(50); // oldest 50 dropped
    expect(faults[faults.length - 1].time).toBe(149);
  });
});

describe('Environment restart', () => {
  it('resets the tick clock to 0 so a new match does not inherit sudden death', async () => {
    const env = new Environment(new Arena('ar1', 'u1'));
    // Simulate a long first match that ran well past the sudden-death threshold.
    (env as unknown as { clock: { time: number } }).clock.time = 12345;
    expect(env.getTime()).toBe(12345);

    // No apps are in the arena, so restart just resets state (no isolate rebuild).
    await env.restart();

    expect(env.getTime()).toBe(0);
  });
});
