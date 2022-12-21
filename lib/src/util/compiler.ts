import { Event } from '../types/event'
import Arena from '../types/arena'
import Process from '../types/process'
import Tank from '../types/tank'
import { createTimerWrappers } from './wrappers/timerWrapper'
import { createConsoleWrapper } from './wrappers/consoleWrapper'
import { createTankWrapper } from './wrappers/tankWrapper'
import { createArenaWrapper } from './wrappers/arenaWrapper'

/*
  The compiler is reponsible for executing the user-provided code. This is done by
  exposing objects or wrapped "monkey-patched" versions of objects to create a new
  Function instance, and then executing that function.
*/

export default {
  // Initialize a tank with its application logic, compiles the app source code
  // within a sandboxed environment.
  compile: (
    arena: Arena,
    process: Process,
    tank: Tank
  ) => {
    const app = process.app

    // Custom console logger visible to the applicaton
    const consoleWrapper = createConsoleWrapper(arena, app, tank)

    // Arena object visible to the application
    const arenaWrapper = createArenaWrapper(arena)

    // Tank object visible to the applicaton
    const tankWrapper = createTankWrapper(arena, process, tank, consoleWrapper)

    // Clock object visible to the applicaton
    const clockWrapper = {
      getTime: () => arena.clock.time,
      on: (event, handler) => {
        if (event === Event.TICK) tankWrapper.on(event, handler)
      },
    }

    // Custom timer implementations visible to the applicaton
    const { setTimeoutWrapper, clearTimeoutWrapper, setIntervalWrapper, clearIntervalWrapper } =
      createTimerWrappers(tank, consoleWrapper)

    // Build and execute the tank logic in a sandboxed environment
    try {
      tank.handlers = {}
      new Function(
        'clock',
        'Math',
        'bot',
        'arena',
        'Event',
        'console',
        'setTimeout',
        'clearTimeout',
        'setInterval',
        'clearInterval',
        'with({document:undefined, window:undefined}){' + app.source + '}',
      ).bind(tank.appScope)(
        clockWrapper,
        Math,
        tankWrapper,
        arenaWrapper,
        Event,
        consoleWrapper,
        setTimeoutWrapper,
        clearTimeoutWrapper,
        setIntervalWrapper,
        clearIntervalWrapper,
      )
    } catch (e) {
      consoleWrapper.error(e)
    }
  },
}
