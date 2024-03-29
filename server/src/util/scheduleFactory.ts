import Environment from "../types/environment";
import Tank from "../types/tank";

/*
  This creates "monkey-patched" wrappers for the timer related
  JavaScript functions, these are provided to the user-generated
  code so that the game has the ability to pause, resume, and
  stop times the code creates.
*/

class Timer {
  func: (() => void) | null = null;
  logger: any;
  interval = 0;

  started = 0;
  lastFired: number | null = 0;
}

export class TimersContainer {
  intervalMap: Map<number, Timer> = new Map<number, Timer>();
  timerMap: Map<number, Timer> = new Map<number, Timer>();

  reset = () => {
    this.intervalMap = new Map<number, Timer>();
    this.timerMap = new Map<number, Timer>();
  };
}

export const timerTick = (env: Environment) => {
  const time = env.getTime();

  env.getProcesses().forEach((process) =>
    process.tanks
      .filter((tank) => tank.health > 0)
      .forEach((tank) => {
        Object.entries(tank.timers.intervalMap).forEach((entry) => {
          const timer: Timer = entry[1] as Timer;
          const timerId: number = parseInt(entry[0]);
          if (time - (timer.lastFired || timer.started) >= timer.interval) {
            timer.logger.trace("Triggered interval", timerId);
            timer.lastFired = time;
            if (timer.func) timer.func();
          }
        });

        Object.entries(tank.timers.timerMap).forEach((entry) => {
          const timer: Timer = entry[1] as Timer;
          const timerId: number = parseInt(entry[0]);
          if (time - timer.started >= timer.interval) {
            timer.logger.trace("Triggered timer", timerId);
            if (timer.func) timer.func();
            timer.logger.trace("Canceled timer", timerId);
            delete tank.timers.timerMap[timerId];
          }
        });
      })
  );
};

// Create timer and interval wrapper functions for the provided tank
export const scheduleFactory = (tank: Tank) => {
  return {
    setInterval: (func: () => void, interval: number, env: Environment) => {
      const timerId = Math.floor(Math.random() * 100000);
      tank.logger.trace("Created interval", timerId);
      tank.timers.intervalMap[timerId] = {
        func,
        started: env.getTime(),
        interval,
        logger: tank.logger,
      };
      return timerId;
    },

    clearInterval: (timerId: number) => {
      tank.logger.trace("Canceled interval", timerId);
      delete tank.timers.intervalMap[timerId];
    },

    setTimeout: (func: () => void, interval: number, env: Environment) => {
      const timerId = Math.floor(Math.random() * 100000);
      tank.logger.trace("Created timer", timerId);
      const wrappedFunc = () => {
        delete tank.timers.timerMap[timerId];
        tank.logger.trace("Triggered timer", timerId);
        func();
      };
      tank.timers.timerMap[timerId] = {
        func: wrappedFunc,
        interval,
        started: env.getTime(),
        logger: tank.logger,
      };
      return timerId;
    },

    clearTimeout: (timerId) => {
      tank.logger.trace("Canceled timer", timerId);
      delete tank.timers.timerMap[timerId];
    },
  };
};
