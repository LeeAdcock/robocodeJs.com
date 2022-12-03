import App from '../types/tankApp'
import { Event } from '../types/event'
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
    apps: App[],
    appIndex: number,
    tankIndex: number,
    arenaWidthProvider: Function,
    arenaHeightProvider: Function,
    buffer: any,
    writeToConsole: boolean,
    timeProvider: Function,
  ) => {
    const app = apps[appIndex]
    const tank = app.tanks[tankIndex]

    // Custom console logger visible to the applicaton
    const consoleWrapper = createConsoleWrapper(apps, appIndex, tankIndex, buffer, writeToConsole)

    // Arena object visible to the application
    const arenaWrapper = createArenaWrapper(arenaHeightProvider, arenaWidthProvider)

    // Tank object visible to the applicaton
    const tankWrapper = createTankWrapper(apps, appIndex, tankIndex, consoleWrapper)

    // Clock object visible to the applicaton
    const clockWrapper = {
      getTime: timeProvider,
      on: (event, handler) => {
        if (event === Event.TICK) tankWrapper.on(event, handler)
      },
    }

    // Custom timer implementations visible to the applicaton
    const { setTimeoutWrapper, clearTimeoutWrapper, setIntervalWrapper, clearIntervalWrapper } =
      createTimerWrappers(apps, appIndex, tankIndex, consoleWrapper)

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
