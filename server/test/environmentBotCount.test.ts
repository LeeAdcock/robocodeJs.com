import { describe, it, expect, vi, beforeEach } from 'vitest';

// setBotCount applies the per-app bot quantity (1–5) to a live arena: every
// process spawns its shortfall immediately or sheds its newest bots outright
// (removed, not killed — no elimination recorded), and the same setting drives
// restart()/addApp() when teams are (re)built.
vi.mock('../src/util/db', () => ({
  default: { query: () => Promise.resolve({ rows: [], rowCount: 0 }) },
}));
vi.mock('../src/services/AppService', () => ({
  default: { get: vi.fn(() => Promise.resolve(null)) },
}));
// Keep spawns isolate-free: sandbox wiring + code loading are compiler.test.ts
// territory; here we exercise only the roster arithmetic and events. init's
// stub installs the per-bot logger the real init provides, so the spawn path's
// execute() doesn't crash on it.
vi.mock('../src/util/compiler', () => ({
  default: {
    execute: vi.fn(() => Promise.resolve()),
    init: vi.fn((_env, _process, bot) => {
      bot.logger = { trace: () => undefined, error: () => undefined };
    }),
    check: vi.fn(),
    emitBotFault: vi.fn(),
  },
}));

import Bot from '../src/types/bot';
import Environment, { Process } from '../src/types/environment';
import Arena from '../src/types/arena';
import compiler from '../src/util/compiler';
import appService from '../src/services/AppService';
import Simulation, { applyEliminations } from '../src/util/simulation';
import { Event } from '../src/types/event';
import Bullet from '../src/types/bullet';

interface ArenaEvent {
  type: string;
  id?: string;
  botCount?: number;
  retired?: boolean;
}

const quietLogger = {
  trace: () => undefined,
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

const makeEnv = (teamSizes: number[]) => {
  const env = new Environment(new Arena('a', 'u'));
  teamSizes.forEach((size, i) => {
    const process = new Process(`app${i + 1}`);
    for (let b = 0; b < size; b++) {
      const bot = new Bot(env, process);
      bot.logger = quietLogger;
      process.bots.push(bot);
    }
    env.getProcesses().push(process);
  });
  return env;
};

// A bullet in flight, aimed along `orientation` (270 = toward +x).
const makeBullet = (x: number, y: number, orientation: number): Bullet => ({
  id: `bullet-${x}-${y}`,
  exploded: false,
  x,
  y,
  origin: { x, y },
  orientation,
  speed: 25,
  callback: vi.fn(),
});

const collectEvents = (env: Environment) => {
  const events: ArenaEvent[] = [];
  env.addListener('event', (e: ArenaEvent) => events.push(e));
  return events;
};

describe('Environment.setBotCount', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(appService.get).mockImplementation(
      () => Promise.resolve(null) as never
    );
  });

  it('defaults to 5 and clamps to 1–5', async () => {
    const env = makeEnv([]);
    expect(env.getBotCount()).toBe(5);
    await env.setBotCount(0);
    expect(env.getBotCount()).toBe(1);
    await env.setBotCount(99);
    expect(env.getBotCount()).toBe(5);
    await env.setBotCount(3.9);
    expect(env.getBotCount()).toBe(3);
  });

  it('announces the new setting with an arenaBotCount event', async () => {
    const env = makeEnv([]);
    const events = collectEvents(env);
    await env.setBotCount(2);
    expect(
      events.some((e) => e.type === 'arenaBotCount' && e.botCount === 2)
    ).toBe(true);
  });

  it('sheds each process’s newest bots and announces their removal', async () => {
    const env = makeEnv([5, 5]);
    const events = collectEvents(env);
    const expectedRemoved = env
      .getProcesses()
      .flatMap((p) => p.bots.slice(3).map((b) => b.id));

    await env.setBotCount(3);

    env.getProcesses().forEach((p) => expect(p.bots.length).toBe(3));
    const removes = events.filter((e) => e.type === 'arenaRemoveBot');
    expect(removes.map((e) => e.id).sort()).toEqual(expectedRemoved.sort());
    // Removal is not death: no bot was damaged or eliminated.
    expect(events.some((e) => e.type === 'botDamaged')).toBe(false);
  });

  it('spawns each process’s shortfall immediately, like a late-joining app', async () => {
    const env = makeEnv([2, 2]);
    const events = collectEvents(env);

    await env.setBotCount(4);

    env.getProcesses().forEach((p) => {
      expect(p.bots.length).toBe(4);
      // Spawned bots go through the standard late-join start: their code loads
      // and START fires on a subsequent tick (needsStarting/codeLoaded gating).
      p.bots.slice(2).forEach((b) => expect(b.needsStarting).toBe(true));
    });
    expect(compiler.init).toHaveBeenCalledTimes(4);
    expect(compiler.execute).toHaveBeenCalledTimes(4);
    expect(events.filter((e) => e.type === 'arenaPlaceBot').length).toBe(4);
  });

  it('handles mixed rosters: grows short teams and shrinks long ones to the same size', async () => {
    const env = makeEnv([5, 1]);
    await env.setBotCount(3);
    expect(env.getProcesses().map((p) => p.bots.length)).toEqual([3, 3]);
  });

  it('sheds dead bots first, keeping living ones', async () => {
    const env = makeEnv([5]);
    const p = env.getProcesses()[0];
    // The three oldest are corpses; the two survivors sit at the array tail —
    // exactly the layout where shedding by position would remove the app's
    // only living bots and falsely end the match.
    p.bots[0].health = 0;
    p.bots[1].health = 0;
    p.bots[2].health = 0;
    const survivors = [p.bots[3].id, p.bots[4].id];

    await env.setBotCount(2);

    expect(p.bots.map((b) => b.id)).toEqual(survivors);
    expect(p.bots.every((b) => b.health > 0)).toBe(true);
  });

  it('sheds living bots (newest first) only when there are not enough dead ones', async () => {
    const env = makeEnv([5]);
    const p = env.getProcesses()[0];
    p.bots[1].health = 0;
    const expected = [p.bots[0].id, p.bots[2].id];

    await env.setBotCount(2);

    // The one corpse goes first, then the newest living bots; the two oldest
    // living bots remain.
    expect(p.bots.map((b) => b.id)).toEqual(expected);
  });

  it('keeps a shed bot’s in-flight bullets flying until they land, still crediting the kill', async () => {
    const env = makeEnv([2, 1]);
    const [a, b] = env.getProcesses();
    const events = collectEvents(env);
    const shooter = a.bots[1];
    const victim = b.bots[0];
    a.bots[0].x = 100;
    a.bots[0].y = 100;
    shooter.x = 200;
    shooter.y = 200;
    victim.x = 500;
    victim.y = 500;
    victim.health = 20; // The bullet in flight will be the killing blow.
    const bullet = makeBullet(400, 500, 270); // 100 short of the victim, closing
    shooter.bullets.push(bullet);

    await env.setBotCount(1);

    // The shooter left the roster but is parked with its live bullet; the
    // fire() callback is cleared (its promise lives in the released context)
    // and the removal is announced as retired so clients keep the bullet.
    expect(a.bots.map((bot) => bot.id)).toEqual([a.bots[0].id]);
    expect(a.retiredBots).toEqual([shooter]);
    expect(bullet.callback).toBeUndefined();
    expect(
      events.find((e) => e.type === 'arenaRemoveBot' && e.id === shooter.id)
        ?.retired
    ).toBe(true);

    // The bullet keeps flying tick by tick...
    Simulation.run(env);
    expect(bullet.x).toBe(425);
    expect(a.retiredBots).toEqual([shooter]);
    Simulation.run(env);
    Simulation.run(env);
    expect(bullet.x).toBe(475);

    // ...lands (distance 25 < 32), damages the victim, credits the shooter,
    // and the retired bot is dropped now that its last bullet has resolved.
    Simulation.run(env);
    expect(bullet.exploded).toBe(true);
    expect(victim.health).toBeLessThanOrEqual(0);
    expect(victim.lastDamagedBy).toBe(shooter);
    expect(shooter.stats.shotsHit).toBe(1);
    applyEliminations(env.getProcesses(), 1);
    expect(shooter.stats.kills).toBe(1);
    expect(a.retiredBots).toEqual([]);
  });

  it('removes a shed bot’s bullet that leaves the arena, then drops the bot', async () => {
    const env = makeEnv([2, 1]);
    const [a] = env.getProcesses();
    const events = collectEvents(env);
    const shooter = a.bots[1];
    const bullet = makeBullet(740, 500, 270); // heading off the +x edge
    shooter.bullets.push(bullet);

    await env.setBotCount(1);
    expect(a.retiredBots).toEqual([shooter]);

    Simulation.run(env); // 740 -> 765, still inside the +32 margin
    expect(a.retiredBots).toEqual([shooter]);
    Simulation.run(env); // 790 is out: removed
    expect(events.some((e) => e.type === 'bulletRemoved')).toBe(true);
    expect(shooter.bullets).toEqual([]);
    expect(a.retiredBots).toEqual([]);
  });

  it('sheds without bullets in flight are removed outright, not retired', async () => {
    const env = makeEnv([2]);
    const events = collectEvents(env);
    const shed = env.getProcesses()[0].bots[1];

    await env.setBotCount(1);

    expect(env.getProcesses()[0].retiredBots).toEqual([]);
    expect(
      events.find((e) => e.type === 'arenaRemoveBot' && e.id === shed.id)
        ?.retired
    ).toBe(false);
  });

  it('tears a shed bot down: parked commands dropped, handlers and timers cleared', async () => {
    const env = makeEnv([2, 1]);
    // Park commands for real: the failure conditions check isRunning().
    (env as unknown as { running: boolean }).running = true;
    const [a, b] = env.getProcesses();
    const shed = a.bots[1];
    const kept = b.bots[0];

    let shedSettled = false;
    shed.setSpeed(3).then(
      () => (shedSettled = true),
      () => (shedSettled = true)
    );
    let keptRejected = false;
    kept.setSpeed(3).then(undefined, () => (keptRejected = true));
    shed.handlers[Event.TICK] = () => undefined;
    shed.timers.intervalMap[1] = {} as never;

    await env.setBotCount(1);

    // The shed bot's dispatch surface is gone...
    expect(Object.keys(shed.handlers)).toEqual([]);
    expect(shed.timers.size()).toBe(0);

    // ...and its parked command was dropped, not settled: stopping the arena
    // rejects the kept bot's command (its failure condition fires) while the
    // shed bot's promise never settles into the released context.
    (env as unknown as { running: boolean }).running = false;
    expect(env.settlePendingCommands()).toBe(1);
    await new Promise((resolve) => setImmediate(resolve));
    expect(keptRejected).toBe(true);
    expect(shedSettled).toBe(false);
  });

  it('addApp fields the configured quantity', async () => {
    const env = makeEnv([]);
    await env.setBotCount(2);
    env.addApp({ getId: () => 'app1', getName: () => 'App 1' } as never);
    expect(env.getProcesses()[0].bots.length).toBe(2);
  });

  it('is a no-op when the clamped count is unchanged: no broadcast, no roster walk', async () => {
    const env = makeEnv([5]);
    const events = collectEvents(env);

    await env.setBotCount(5); // already the default
    await env.setBotCount(99); // clamps to 5 — still unchanged

    // (addListener replays the paused/resumed state to a new subscriber, so
    // filter that bootstrap event out.)
    expect(events.filter((e) => e.type !== 'arenaPaused')).toEqual([]);
    expect(env.getProcesses()[0].bots.length).toBe(5);
    expect(compiler.init).not.toHaveBeenCalled();
    expect(compiler.execute).not.toHaveBeenCalled();
  });

  it('serializes with an in-flight restart: the team is never doubled', async () => {
    const env = makeEnv([2, 2]);
    // A real async gap between restart's dispose and its rebuild, like the
    // appService DB round-trip in production.
    vi.mocked(appService.get).mockImplementation(
      (appId: string) =>
        new Promise((resolve) =>
          setTimeout(
            () => resolve({ getId: () => appId, getName: () => appId }),
            20
          )
        ) as never
    );

    // setBotCount lands while restart's lookup is still in flight. Unserialized,
    // it would see the disposed (empty) rosters, spawn 3 bots per process, and
    // restart's rebuild would then push 3 more — 6 per app until the next
    // restart.
    const restarted = env.restart();
    const resized = env.setBotCount(3);
    await Promise.all([restarted, resized]);

    expect(env.getProcesses().map((p) => p.bots.length)).toEqual([3, 3]);
    expect(env.getBotCount()).toBe(3);
  });

  it('applies a queued setBotCount after the restart it was issued behind', async () => {
    const env = makeEnv([1]);
    vi.mocked(appService.get).mockImplementation(
      (appId: string) =>
        new Promise((resolve) =>
          setTimeout(
            () => resolve({ getId: () => appId, getName: () => appId }),
            10
          )
        ) as never
    );

    // Issued strictly in sequence: the resize to 2 queues behind the restart
    // (which rebuilds at the freshly set count) and finds nothing left to do.
    await Promise.all([env.restart(), env.setBotCount(2)]);
    expect(env.getProcesses()[0].bots.length).toBe(2);

    // A later restart keeps fielding the configured quantity.
    await env.restart();
    expect(env.getProcesses()[0].bots.length).toBe(2);
  });
});
