import { describe, it, expect, vi } from 'vitest';

// The tick that crosses SUDDEN_DEATH_TIME must broadcast an arenaSuddenDeath
// event (once — the log console renders a lifecycle divider from it), and the
// decay ticks that follow must not repeat it.
vi.mock('../src/util/db', () => ({
  default: { query: () => Promise.resolve({ rows: [], rowCount: 0 }) },
}));
vi.mock('../src/services/AppService', () => ({
  default: { get: () => Promise.resolve(null) },
}));

import Bot from '../src/types/bot';
import Environment, {
  Process,
  SUDDEN_DEATH_TIME,
} from '../src/types/environment';
import Arena from '../src/types/arena';

describe('Environment sudden-death announcement', () => {
  // One live bot (code not loaded, so no handlers run) keeps the arena from
  // auto-pausing on the game-over check.
  const withProcess = () => {
    const env = new Environment(new Arena('a', 'u'));
    const process = new Process('app1');
    process.bots.push(new Bot(env, process));
    env.getProcesses().push(process);
    return env;
  };

  it('emits arenaSuddenDeath exactly once, on the crossing tick', async () => {
    const env = withProcess();
    const events: { type: string; time?: number }[] = [];
    env.addListener('event', (e: unknown) => {
      const event = e as { type: string; time?: number };
      if (event.type === 'arenaSuddenDeath') events.push(event);
    });

    // Park the (private) clock just short of the threshold rather than
    // stepping 7500 real ticks.
    (env as unknown as { clock: { time: number } }).clock.time =
      SUDDEN_DEATH_TIME - 2;

    await env.step(); // -> SUDDEN_DEATH_TIME - 1: not yet
    expect(events.length).toBe(0);

    await env.step(); // -> SUDDEN_DEATH_TIME: announced
    expect(events.length).toBe(1);
    expect(events[0].time).toBe(SUDDEN_DEATH_TIME);

    await env.step(); // deeper into sudden death: no repeat
    expect(events.length).toBe(1);
  });
});
