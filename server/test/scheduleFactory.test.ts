import { describe, it, expect, vi } from 'vitest';
import {
  scheduleFactory,
  timerTick,
  TimersContainer,
} from '../src/util/scheduleFactory';

// Bot setInterval/setTimeout are monkey-patched to advance with simulation
// ticks (clock.getTime()), not wall-clock time. A bot's setTimeout(fn, 5)
// therefore fires after 5 *ticks*. These tests lock that behavior in.

function makeTank(health = 100) {
  return {
    health,
    logger: { trace: vi.fn() },
    timers: new TimersContainer(),
  };
}

function makeEnv(tank: ReturnType<typeof makeTank>) {
  const state = { time: 0 };
  return {
    state,
    getTime: () => state.time,
    getProcesses: () => [{ tanks: [tank] }],
  };
}

describe('scheduleFactory + timerTick', () => {
  it('fires an interval every `interval` ticks', () => {
    const tank = makeTank();
    const env = makeEnv(tank);
    const fn = vi.fn();
    scheduleFactory(tank).setInterval(fn, 5, env as never);

    env.state.time = 4;
    timerTick(env as never);
    expect(fn).not.toHaveBeenCalled();

    env.state.time = 5;
    timerTick(env as never);
    expect(fn).toHaveBeenCalledTimes(1);

    env.state.time = 9;
    timerTick(env as never);
    expect(fn).toHaveBeenCalledTimes(1);

    env.state.time = 10;
    timerTick(env as never);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('fires a timeout once then removes it', () => {
    const tank = makeTank();
    const env = makeEnv(tank);
    const fn = vi.fn();
    scheduleFactory(tank).setTimeout(fn, 3, env as never);

    env.state.time = 2;
    timerTick(env as never);
    expect(fn).not.toHaveBeenCalled();

    env.state.time = 3;
    timerTick(env as never);
    expect(fn).toHaveBeenCalledTimes(1);

    env.state.time = 10;
    timerTick(env as never);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('clearInterval stops a pending interval', () => {
    const tank = makeTank();
    const env = makeEnv(tank);
    const fn = vi.fn();
    const sched = scheduleFactory(tank);
    const id = sched.setInterval(fn, 1, env as never);
    sched.clearInterval(id);

    env.state.time = 5;
    timerTick(env as never);
    expect(fn).not.toHaveBeenCalled();
  });

  it('clearTimeout cancels a pending timeout', () => {
    const tank = makeTank();
    const env = makeEnv(tank);
    const fn = vi.fn();
    const sched = scheduleFactory(tank);
    const id = sched.setTimeout(fn, 2, env as never);
    sched.clearTimeout(id);

    env.state.time = 5;
    timerTick(env as never);
    expect(fn).not.toHaveBeenCalled();
  });

  it('does not fire timers for a destroyed tank', () => {
    const tank = makeTank(0); // health 0
    const env = makeEnv(tank);
    const fn = vi.fn();
    scheduleFactory(tank).setInterval(fn, 1, env as never);

    env.state.time = 5;
    timerTick(env as never);
    expect(fn).not.toHaveBeenCalled();
  });
});
