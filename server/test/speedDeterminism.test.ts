import { describe, it, expect, vi } from 'vitest';

// The core guarantee of configurable simulation speed: a battle plays out
// IDENTICALLY regardless of how fast (in wall-clock terms) the ticks are produced.
// Because command completion is tick-driven and the loop drains each tick's bot
// work to quiescence before advancing, inter-tick wall-clock time cannot affect
// the outcome. This test drives the same scenario two ways — ticks back-to-back
// ("as fast as possible") and ticks spaced out with real setTimeout delays
// ("slow") — and asserts the resulting tank state matches exactly. A regression
// that reintroduced any wall-clock coupling (e.g. a real-time command timer) would
// make the two runs diverge.
vi.mock('../src/util/db', () => ({
  default: { query: () => Promise.resolve({ rows: [], rowCount: 0 }) },
}));

import compiler from '../src/util/compiler';
import Tank from '../src/types/tank';
import { Process } from '../src/types/environment';
import Simulation from '../src/util/simulation';
import { makeSimEnv } from './simEnv';

// A snapshot of the state that physics + bot decisions determine, for comparison.
const snapshot = (tanks: Tank[]) =>
  tanks.map((t) => ({
    x: t.x,
    y: t.y,
    health: t.health,
    speed: t.speed,
    orientation: t.orientation,
    turret: t.turret.orientation,
    radar: t.turret.radar.orientation,
    bullets: t.bullets.filter((b) => !b.exploded).length,
  }));

// Build a fresh two-bot world at fixed poses (no Math.random placement) and drive
// it `ticks` times. `pace` optionally awaits real wall-clock time between ticks to
// emulate a slower simulation speed.
const runBattle = async (ticks: number, pace?: () => Promise<void>) => {
  const world = makeSimEnv({ run: (env) => Simulation.run(env) });
  const { env, processes } = world;

  const addBot = (
    source: string,
    appId: string,
    pose: { x: number; y: number; orientation: number }
  ): Tank => {
    const proc = new Process(appId);
    processes.push(proc);
    const tank = new Tank(env, proc);
    proc.tanks.push(tank);
    tank.x = pose.x;
    tank.y = pose.y;
    tank.orientation = pose.orientation;
    tank.orientationTarget = pose.orientation;
    // Pin the otherwise-random turret/radar orientations so the two runs start
    // from an identical state and any divergence is attributable to pacing.
    tank.turret.orientation = pose.orientation;
    tank.turret.orientationTarget = pose.orientation;
    tank.turret.radar.orientation = pose.orientation;
    tank.turret.radar.orientationTarget = pose.orientation;
    tank.turret.loaded = 100;
    tank.turret.radar.charged = 100;
    compiler.init(env, proc, tank);
    proc
      .getSandbox()
      .compileScriptSync(source)
      .runSync(tank.getContext(), { timeout: 5000 });
    return tank;
  };

  // A mover that accelerates and turns, and a gunner that repeatedly aims and
  // fires — exercising multi-tick commands, timers-free async chains, and the HIT
  // path when a bullet connects.
  addBot(
    `bot.on(Event.START, async () => { await bot.setSpeed(5); await bot.turn(30) })`,
    'mover',
    { x: 375, y: 300, orientation: 0 }
  );
  addBot(
    `clock.on(Event.TICK, async () => {
       if (bot.turret.isReady()) { await bot.turret.setOrientation(180); await bot.turret.fire() }
     })`,
    'gunner',
    { x: 375, y: 450, orientation: 180 }
  );

  for (let i = 0; i < ticks; i++) {
    await world.tick(1);
    if (pace) await pace();
  }

  const tanks = processes.flatMap((p) => p.tanks);
  const state = snapshot(tanks);
  processes.forEach((p) => p.tanks.forEach((t) => t.getContext().release()));
  return state;
};

describe('simulation speed is deterministic across pacing', () => {
  it('produces identical outcomes back-to-back and with wall-clock delays', async () => {
    const TICKS = 40;

    // "As fast as possible": ticks run back-to-back.
    const fast = await runBattle(TICKS);

    // "Slower speed": a real delay between every tick. If anything depended on
    // wall-clock time, this would drift from the fast run.
    const slow = await runBattle(
      TICKS,
      () => new Promise((r) => setTimeout(r, 3))
    );

    expect(slow).toEqual(fast);
    // Sanity: the scenario actually did something (bots moved / fired), so the
    // equality above isn't comparing two inert initial states.
    expect(fast[0].speed).toBeGreaterThan(0);
  });
});
