import { describe, it, expect, vi, beforeEach } from 'vitest';

// buildArenaStatus imports Environment (for DEPLOY_TICKS) and types/bot (for the
// BOT_MAX_SPEED / BOT_ACCELERATION constants echoed into every bot), which
// transitively pull in AppService → db. Stub the pool and the service so the
// builder can be driven against lightweight mocks — the same approach as
// matchSummary.test.ts. appService.get resolves each member's app metadata.
vi.mock('../src/util/db', () => ({ default: { query: vi.fn() } }));
vi.mock('../src/services/AppService', () => ({
  default: { get: vi.fn() },
}));

import { buildArenaStatus } from '../src/util/arenaStatus';
import { DEPLOY_TICKS } from '../src/types/environment';
import { BOT_MAX_SPEED, BOT_ACCELERATION } from '../src/types/bot';
import appService from '../src/services/AppService';

// A mock bullet exposing just the fields buildArenaStatus reads.
const makeBullet = (
  id: string,
  { exploded = false, x = 10, y = 20, orientation = 1.5, speed = 8 } = {}
) => ({ id, exploded, x, y, orientation, speed });

// A mock bot with the full field surface the snapshot maps, including the
// nested turret → radar orientation chain.
const makeBot = (
  id: string,
  {
    x = 100,
    y = 200,
    health = 100,
    appCrashed = false,
    bullets = [] as ReturnType<typeof makeBullet>[],
  } = {}
) => ({
  id,
  x,
  y,
  speed: 3,
  speedTarget: 5,
  orientation: 0.1,
  orientationTarget: 0.2,
  orientationVelocity: 0.01,
  health,
  appCrashed,
  bullets,
  turret: {
    orientation: 0.3,
    orientationTarget: 0.4,
    orientationVelocity: 0.02,
    radar: {
      orientation: 0.5,
      orientationTarget: 0.6,
      orientationVelocity: 0.03,
    },
  },
});

// A mock process (one app's bots). buildArenaStatus reads `.appId`, `.getAppId()`
// and `.bots`.
const makeProcess = (appId: string, bots: ReturnType<typeof makeBot>[]) => ({
  appId,
  getAppId: () => appId,
  bots,
});

const makeMember = (appId: string, timestamp: number) => ({
  getAppId: () => appId,
  getTimestamp: () => timestamp,
});

// A mock Environment exposing only the getters the builder calls.
const makeEnv = (
  processes: ReturnType<typeof makeProcess>[],
  {
    running = true,
    time = 42,
    seed = 7,
    speed = 1,
    tickMs = 100,
    width = 800,
    height = 600,
    id = 'arena-1',
  } = {}
) =>
  ({
    getArena: () => ({
      getId: () => id,
      getWidth: () => width,
      getHeight: () => height,
    }),
    getProcesses: () => processes,
    isRunning: () => running,
    getSpeed: () => speed,
    getTickMs: () => tickMs,
    getSeed: () => seed,
    getBotCount: () => 5,
    getTime: () => time,
  }) as never;

const APPS: Record<string, { name: string; userId: string }> = {
  a1: { name: 'Hunter', userId: 'u1' },
  a2: { name: 'Wanderer', userId: 'u2' },
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(appService.get).mockImplementation(
    async (id: string) =>
      ({
        getId: () => id,
        getName: () => APPS[id]?.name,
        getUserId: () => APPS[id]?.userId,
      }) as never
  );
});

describe('buildArenaStatus', () => {
  it('emits the arena-level snapshot fields', async () => {
    const env = makeEnv([makeProcess('a1', [makeBot('t1')])], {
      running: true,
      time: 42,
      seed: 7,
      speed: 2,
      tickMs: 50,
      width: 800,
      height: 600,
      id: 'arena-1',
    });

    const status = await buildArenaStatus(env, [makeMember('a1', 1)]);

    expect(status.id).toBe('arena-1');
    expect(status.width).toBe(800);
    expect(status.height).toBe(600);
    expect(status.running).toBe(true);
    expect(status.speed).toBe(2);
    expect(status.tickMs).toBe(50);
    expect(status.seed).toBe(7);
    expect(status.deployTick).toBe(DEPLOY_TICKS);
    expect(status.clock).toEqual({ time: 42 });
  });

  it('joins app metadata and maps the full per-bot field set', async () => {
    const env = makeEnv([
      makeProcess('a1', [makeBot('t1', { x: 111, y: 222, health: 80 })]),
    ]);

    const status = await buildArenaStatus(env, [makeMember('a1', 5)]);

    expect(status.apps).toHaveLength(1);
    const app = status.apps[0];
    expect(app).toMatchObject({ id: 'a1', name: 'Hunter', userId: 'u1' });
    expect(app.addedTimestamp).toBe(5);

    expect(app.bots[0]).toMatchObject({
      id: 't1',
      x: 111,
      y: 222,
      speed: 3,
      speedTarget: 5,
      speedAcceleration: BOT_ACCELERATION,
      speedMax: BOT_MAX_SPEED,
      bodyOrientation: 0.1,
      bodyOrientationTarget: 0.2,
      bodyOrientationVelocity: 0.01,
      turretOrientation: 0.3,
      turretOrientationTarget: 0.4,
      turretOrientationVelocity: 0.02,
      radarOrientation: 0.5,
      radarOrientationTarget: 0.6,
      radarOrientationVelocity: 0.03,
      health: 80,
      crashed: false,
    });
  });

  it('surfaces the crashed flag so a client can tell a fault-death from a kill', async () => {
    const env = makeEnv([
      makeProcess('a1', [makeBot('t1', { appCrashed: true })]),
    ]);

    const status = await buildArenaStatus(env, [makeMember('a1', 1)]);

    expect(status.apps[0].bots[0].crashed).toBe(true);
  });

  it('includes live bullets with motion fields and excludes spent ones', async () => {
    const bullets = [
      makeBullet('b1', {
        exploded: false,
        x: 5,
        y: 6,
        orientation: 1.2,
        speed: 9,
      }),
      makeBullet('b2', { exploded: true }), // spent → must be dropped
      makeBullet('b3', { exploded: false }),
    ];
    const env = makeEnv([makeProcess('a1', [makeBot('t1', { bullets })])]);

    const status = await buildArenaStatus(env, [makeMember('a1', 1)]);

    const rendered = status.apps[0].bots[0].bullets;
    expect(rendered.map((b) => b.id)).toEqual(['b1', 'b3']);
    expect(rendered[0]).toEqual({
      id: 'b1',
      x: 5,
      y: 6,
      orientation: 1.2,
      speed: 9,
    });
  });

  it('orders apps by when their member joined the arena, not process order', async () => {
    // Processes returned newest-first; members carry the join timestamps. The
    // snapshot must sort ascending by join time so the wire order is stable.
    const env = makeEnv([
      makeProcess('a2', [makeBot('t3')]),
      makeProcess('a1', [makeBot('t1')]),
    ]);
    const members = [makeMember('a1', 1), makeMember('a2', 9)];

    const status = await buildArenaStatus(env, members);

    expect(status.apps.map((a) => a.id)).toEqual(['a1', 'a2']);
  });
});
