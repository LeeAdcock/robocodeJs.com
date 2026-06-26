import { describe, it, expect } from 'vitest';
import applyArenaEvent from '../src/util/arenaReducer';

// applyArenaEvent mutates the arena in place and returns it.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const apply = (arena: any, data: any, time = 0) =>
  applyArenaEvent(arena, data, time);

function makeTank(id: string, over: Record<string, unknown> = {}) {
  return {
    id,
    x: 100,
    y: 100,
    speed: 0,
    speedTarget: 0,
    speedAcceleration: 0,
    speedMax: 5,
    bodyOrientation: 0,
    bodyOrientationTarget: 0,
    bodyOrientationVelocity: 0,
    turretOrientation: 0,
    turretOrientationTarget: 0,
    turretOrientationVelocity: 0,
    radarOrientation: 0,
    radarOrientationTarget: 0,
    radarOrientationVelocity: 0,
    radarOn: false,
    bullets: [] as Record<string, unknown>[],
    health: 100,
    path: [] as unknown[],
    pathIndex: 0,
    ...over,
  };
}
const makeApp = (id: string, tanks: unknown[] = []) => ({
  id,
  name: `App ${id}`,
  tanks,
});
const makeArena = (apps: unknown[], time = 0) => ({ clock: { time }, apps });

describe('applyArenaEvent — apps', () => {
  it('arenaPlaceApp adds a new app', () => {
    const arena = makeArena([makeApp('a1')]);
    apply(arena, { type: 'arenaPlaceApp', id: 'a2', name: 'Two' });
    expect(arena.apps.map((a: any) => a.id)).toEqual(['a1', 'a2']);
  });

  it('arenaRemoveApp removes only the targeted app (regression: slice bug)', () => {
    const arena = makeArena([makeApp('a1'), makeApp('a2'), makeApp('a3')]);
    apply(arena, { type: 'arenaRemoveApp', id: 'a2' });
    expect(arena.apps.map((a: any) => a.id)).toEqual(['a1', 'a3']);
  });

  it('arenaPlaceApp replaces an existing app of the same id', () => {
    const arena = makeArena([makeApp('a1'), makeApp('a2')]);
    apply(arena, { type: 'arenaPlaceApp', id: 'a1', name: 'New' });
    expect(arena.apps.map((a: any) => a.id)).toEqual(['a2', 'a1']);
    expect(arena.apps.find((a: any) => a.id === 'a1').name).toBe('New');
  });

  it('appRenamed updates the matching app name', () => {
    const arena = makeArena([makeApp('a1')]);
    apply(arena, { type: 'appRenamed', appId: 'a1', name: 'Renamed' });
    expect(arena.apps[0].name).toBe('Renamed');
  });
});

describe('applyArenaEvent — tanks', () => {
  it('arenaPlaceTank adds a tank to its app', () => {
    const arena = makeArena([makeApp('a1')]);
    apply(arena, {
      type: 'arenaPlaceTank',
      appId: 'a1',
      id: 't1',
      x: 50,
      y: 60,
      speed: 0,
      speedMax: 5,
      bodyOrientation: 0,
      bodyOrientationVelocity: 0,
      turretOrientation: 0,
      turretOrientationVelocity: 0,
      radarOrientation: 0,
      radarOrientationVelocity: 0,
    });
    expect(arena.apps[0].tanks.map((t: any) => t.id)).toEqual(['t1']);
  });

  it('arenaRemoveTank removes only the targeted tank (regression: slice bug)', () => {
    const arena = makeArena([
      makeApp('a1', [makeTank('t1'), makeTank('t2'), makeTank('t3')]),
    ]);
    apply(arena, { type: 'arenaRemoveTank', appId: 'a1', id: 't2' });
    expect(arena.apps[0].tanks.map((t: any) => t.id)).toEqual(['t1', 't3']);
  });

  it('tankTurn sets the body target/velocity and position', () => {
    const arena = makeArena([makeApp('a1', [makeTank('t1')])]);
    apply(arena, {
      type: 'tankTurn',
      id: 't1',
      bodyOrientationTarget: 90,
      bodyOrientationVelocity: 10,
      x: 200,
      y: 210,
    });
    const t = arena.apps[0].tanks[0];
    expect(t.bodyOrientationTarget).toBe(90);
    expect(t.bodyOrientationVelocity).toBe(10);
    expect([t.x, t.y]).toEqual([200, 210]);
  });

  it('tankAccelerate / tankStop update speed fields', () => {
    const arena = makeArena([makeApp('a1', [makeTank('t1')])]);
    apply(arena, {
      type: 'tankAccelerate',
      id: 't1',
      speed: 3,
      speedTarget: 5,
      speedAcceleration: 1,
      speedMax: 5,
      x: 1,
      y: 2,
    });
    expect(arena.apps[0].tanks[0].speedTarget).toBe(5);
    apply(arena, { type: 'tankStop', id: 't1', x: 1, y: 2 });
    expect(arena.apps[0].tanks[0].speed).toBe(0);
    expect(arena.apps[0].tanks[0].speedTarget).toBe(0);
  });

  it('tankDamaged sets health and stops the tank when destroyed', () => {
    const arena = makeArena([
      makeApp('a1', [makeTank('t1', { speed: 4, speedTarget: 4 })]),
    ]);
    apply(arena, { type: 'tankDamaged', id: 't1', health: 0 });
    const t = arena.apps[0].tanks[0];
    expect(t.health).toBe(0);
    expect([t.speed, t.speedTarget]).toEqual([0, 0]);
  });

  it('turret/radar turn set their targets', () => {
    const arena = makeArena([makeApp('a1', [makeTank('t1')])]);
    apply(arena, {
      type: 'turretTurn',
      id: 't1',
      turretOrientationTarget: 45,
      turretOrientationVelocity: 2,
    });
    apply(arena, {
      type: 'radarTurn',
      id: 't1',
      radarOrientationTarget: 30,
      radarOrientationVelocity: 3,
    });
    const t = arena.apps[0].tanks[0];
    expect(t.turretOrientationTarget).toBe(45);
    expect(t.radarOrientationTarget).toBe(30);
  });
});

describe('applyArenaEvent — bullets & clock', () => {
  it('bulletFired / bulletExploded / bulletRemoved manage a tank bullet', () => {
    const arena = makeArena([makeApp('a1', [makeTank('t1')])]);
    apply(arena, {
      type: 'bulletFired',
      tankId: 't1',
      id: 'b1',
      x: 10,
      y: 20,
      orientation: 0,
      speed: 25,
    });
    expect(arena.apps[0].tanks[0].bullets).toHaveLength(1);

    apply(arena, { type: 'bulletExploded', id: 'b1', time: 7 });
    expect(arena.apps[0].tanks[0].bullets[0].explodedAt).toBe(7);

    apply(arena, { type: 'bulletRemoved', id: 'b1' });
    expect(arena.apps[0].tanks[0].bullets).toHaveLength(0);
  });

  it('tick advances the clock and is a no-op when the time is unchanged', () => {
    const arena = makeArena([], 5);
    apply(arena, { type: 'tick', time: 6 });
    expect(arena.clock.time).toBe(6);
    apply(arena, { type: 'tick', time: 6 });
    expect(arena.clock.time).toBe(6);
  });
});
