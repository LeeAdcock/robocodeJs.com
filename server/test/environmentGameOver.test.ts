import { describe, it, expect, vi } from 'vitest';

// The tick loop's game-over check must agree with isMatchDecided / the match
// summary about which apps are alive: an app is alive while ANY of its bots has
// health > 0. Dead bots' health isn't floored at 0 (overkill, the missed-shot
// penalty), so summing an app's health let dead teammates drag a squad with a
// living bot to <= 0 — the loop stopped mid-match while the summary still
// reported two apps alive (GitHub #422).
vi.mock('../src/util/db', () => ({
  default: { query: () => Promise.resolve({ rows: [], rowCount: 0 }) },
}));
vi.mock('../src/services/AppService', () => ({
  default: { get: () => Promise.resolve(null) },
}));

import Bot from '../src/types/bot';
import Environment, { Process } from '../src/types/environment';
import Arena from '../src/types/arena';
import { isMatchDecided } from '../src/util/matchSummary';

// Bots never load code here, so no handlers run and health only changes if we
// change it. Each app gets one bot per entry in `healths`.
//
// Placement is random per arena seed, so occasionally two bots spawn touching
// and the tick's collision path logs through bot.logger — which is normally
// attached when a bot loads its code. Stub it so that seed doesn't crash the
// tick (it made this file fail ~1 run in 30).
const silentLogger = new Proxy({}, { get: () => () => undefined });

const arenaWith = (...apps: number[][]) => {
  const env = new Environment(new Arena('a', 'u'));
  apps.forEach((healths, i) => {
    const process = new Process(`app${i}`);
    for (const health of healths) {
      const bot = new Bot(env, process);
      bot.logger = silentLogger as Bot['logger'];
      bot.health = health;
      process.bots.push(bot);
    }
    env.getProcesses().push(process);
  });
  return env;
};

// step() leaves the arena paused regardless, so observe the game-over branch
// through the arenaPaused event it emits. addListener replays the arena's
// current (paused) state to a new listener, so only count events that arrive
// during the step itself.
const gameOverOnNextTick = async (env: Environment) => {
  let stepping = false;
  let paused = false;
  const listener = (e: unknown) => {
    if (stepping && (e as { type: string }).type === 'arenaPaused') {
      paused = true;
    }
  };
  env.addListener('event', listener);
  stepping = true;
  await env.step();
  stepping = false;
  env.removeListener('event', listener);
  return paused;
};

describe('Environment game-over check', () => {
  it('keeps running when each app has a living bot, even if its summed health is <= 0', async () => {
    // The seed-1 repro from #422: one bot at 10 beside four dead at -3 (sum -2),
    // against one at 10 beside dead teammates summing to -19.
    const env = arenaWith([10, -3, -3, -3, -3], [10, -6, -18, 0, -5]);

    expect(isMatchDecided(env)).toBe(false);
    expect(await gameOverOnNextTick(env)).toBe(false);
  });

  it('stops when no app has a living bot', async () => {
    const env = arenaWith([0, -3, -3, -3, -3], [-6, -18, 0, -5, -1]);

    expect(await gameOverOnNextTick(env)).toBe(true);
  });

  it('stamps stoppedAt at game over so the GC times it from the end of the match', async () => {
    const env = arenaWith([0, -3], [-6, -1]);
    env.stoppedAt = new Date(0); // as if constructed long ago

    await gameOverOnNextTick(env);

    expect(Date.now() - env.stoppedAt.getTime()).toBeLessThan(1000);
  });

  it('keeps running in a normal mid-match state', async () => {
    const env = arenaWith([100, 75, 0, -3, 50], [25, 100, 100, 100, 100]);

    expect(await gameOverOnNextTick(env)).toBe(false);
  });
});
