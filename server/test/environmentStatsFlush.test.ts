import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/util/db', () => ({ default: { query: vi.fn() } }));

import Environment from '../src/types/environment';
import Arena from '../src/types/arena';
import { BotStats } from '../src/types/botStats';

// flushStats only reads processes -> bots -> stats/flushedStats, so plain fakes
// drive it without isolates or a database. dispose() calls process.dispose().
const makeBot = (stats: Partial<BotStats> = {}) => ({
  stats: { ...new BotStats(), ...stats },
  flushedStats: new BotStats(),
});
const makeProcess = (bots: ReturnType<typeof makeBot>[]) => ({
  bots,
  dispose: vi.fn(),
  getAppId: () => 'app-1',
});

const makeEnv = (processes: ReturnType<typeof makeProcess>[]) => {
  const env = new Environment(new Arena('arena-1', 'user-1'));
  (env as unknown as { processes: unknown[] }).processes = processes;
  return env;
};

let sink: ReturnType<typeof vi.fn>;
beforeEach(() => {
  sink = vi.fn();
});

describe('Environment stats flush', () => {
  it('emits the summed counters across every bot in the arena', () => {
    const env = makeEnv([
      makeProcess([
        makeBot({ kills: 1, shotsFired: 10 }),
        makeBot({ kills: 2 }),
      ]),
      makeProcess([makeBot({ shotsFired: 5 })]),
    ]);
    env.setStatsSink(sink);

    env.dispose();

    expect(sink).toHaveBeenCalledTimes(1);
    expect(sink.mock.calls[0][0]).toMatchObject({ kills: 3, shotsFired: 15 });
  });

  // THE core invariant. The flush runs at every point where bot stats are about to
  // be destroyed OR a match ends, so it must be safe to run twice — otherwise
  // game-over followed by restart would count the same match twice.
  it('is idempotent: a second flush with no ticks in between emits nothing', () => {
    const bot = makeBot({ kills: 1 });
    const env = makeEnv([makeProcess([bot])]);
    env.setStatsSink(sink);

    env.dispose();
    env.dispose();

    expect(sink).toHaveBeenCalledTimes(1);
  });

  it('emits only what accrued since the last flush', () => {
    const bot = makeBot({ kills: 1 });
    const env = makeEnv([makeProcess([bot])]);
    env.setStatsSink(sink);

    env.dispose();
    // …the match plays on and lands two more kills.
    bot.stats.kills = 3;
    env.dispose();

    expect(sink).toHaveBeenCalledTimes(2);
    expect(sink.mock.calls[1][0]).toMatchObject({ kills: 2 });
  });

  it('emits nothing when the arena never did anything', () => {
    const env = makeEnv([makeProcess([makeBot()])]);
    env.setStatsSink(sink);
    env.dispose();
    expect(sink).not.toHaveBeenCalled();
  });

  // The ladder's Environment is built directly rather than through
  // EnvironmentService, so it never gets a sink — that is what stops its dispose()
  // from double-counting the ranked stats the ladder hook already recorded.
  it('is a silent no-op with no sink installed — the ladder double-count guard', () => {
    const process = makeProcess([makeBot({ kills: 5 })]);
    const env = makeEnv([process]);

    expect(() => env.dispose()).not.toThrow();
    // Teardown still happened; only the accounting was skipped.
    expect(process.dispose).toHaveBeenCalledOnce();
  });

  it('flushes before disposing the processes that hold the stats', () => {
    const order: string[] = [];
    const bot = makeBot({ kills: 1 });
    const process = makeProcess([bot]);
    process.dispose.mockImplementation(() => {
      order.push('dispose');
      // Mirrors the real Process.dispose, which drops the bots entirely.
      process.bots = [];
    });
    const env = makeEnv([process]);
    env.setStatsSink(() => order.push('flush'));

    env.dispose();

    expect(order).toEqual(['flush', 'dispose']);
  });

  it('flushes when an app is removed, before its process is spliced out', () => {
    const env = makeEnv([makeProcess([makeBot({ kills: 2 })])]);
    env.setStatsSink(sink);

    env.removeApp('app-1');

    expect(sink).toHaveBeenCalledTimes(1);
    expect(sink.mock.calls[0][0]).toMatchObject({ kills: 2 });
  });

  it('can be detached, after which nothing is reported', () => {
    const bot = makeBot({ kills: 1 });
    const env = makeEnv([makeProcess([bot])]);
    env.setStatsSink(sink);
    env.setStatsSink(null);
    env.dispose();
    expect(sink).not.toHaveBeenCalled();
  });
});
