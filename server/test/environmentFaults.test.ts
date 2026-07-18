import { describe, it, expect, vi } from 'vitest';

// Environment -> compiler -> appService -> util/db runs at import; mock the pool.
vi.mock('../src/util/db', () => ({
  default: { query: () => Promise.resolve({ rows: [], rowCount: 0 }) },
}));

import Environment, { BotFault } from '../src/types/environment';
import Arena from '../src/types/arena';
import { logger, LogEvent } from '../src/util/logger';

const makeFault = (over: Partial<BotFault> = {}): BotFault => ({
  appId: 'a1',
  botId: 't1',
  botIndex: 1,
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
  it('keeps recent faults and logs across a restart (post-match analysis)', async () => {
    const env = new Environment(new Arena('ar1', 'u1'));
    env.reportFault(makeFault({ message: 'last-match crash' }));
    env.emit('log', { msg: 'last-match log', level: 30 });

    // No apps are in the arena, so restart just resets state (no isolate rebuild).
    await env.restart();

    // Both buffers survive so run_match -> recent_faults / recent_logs can still
    // read the finished match after the next one starts.
    expect(env.getRecentFaults().map((f) => f.message)).toEqual([
      'last-match crash',
    ]);
    expect(env.getRecentLogs()).toEqual([{ msg: 'last-match log', level: 30 }]);
  });

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

// D3 hardening: the per-tick bot-work drain has always been bounded
// (MAX_DRAIN_ROUNDS), but the warning it emitted on exhaustion carried no `event`
// field, so — unlike every other alertable condition — a CloudWatch log-metric
// alarm could not fire on it. This asserts the exhaustion log now carries the
// stable event id.
describe('Environment drain-exhaustion is alarmable', () => {
  it('logs bot.drain_exhausted with the arena id when the drain bound is hit', async () => {
    const prev = process.env.MAX_DRAIN_ROUNDS;
    // 0 rounds: the drain loop body never runs and reports immediately.
    process.env.MAX_DRAIN_ROUNDS = '0';
    const warn = vi.spyOn(logger, 'warn').mockReturnValue(undefined as never);
    try {
      const env = new Environment(new Arena('ar1', 'u1'));
      // drainBotWork is private; invoke it directly for a focused unit test.
      await (
        env as unknown as { drainBotWork: () => Promise<void> }
      ).drainBotWork();

      const drainLogs = warn.mock.calls.filter(
        (c) =>
          (c[0] as { event?: string })?.event === LogEvent.BOT_DRAIN_EXHAUSTED
      );
      expect(drainLogs).toHaveLength(1);
      expect(drainLogs[0][0]).toMatchObject({
        event: LogEvent.BOT_DRAIN_EXHAUSTED,
        arenaId: 'ar1',
      });
    } finally {
      warn.mockRestore();
      if (prev === undefined) delete process.env.MAX_DRAIN_ROUNDS;
      else process.env.MAX_DRAIN_ROUNDS = prev;
    }
  });
});
