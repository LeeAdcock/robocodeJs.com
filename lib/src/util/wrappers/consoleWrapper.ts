import { createLogger } from 'browser-bunyan'
import { TankApp } from '../..'
import Arena from '../../types/arena'
import Tank from '../../types/tank'
import { v4 as uuidv4 } from 'uuid';

/*
  This creates "monkey-patched" console wrapper so that logging
  output from the tank can be styled for the browser console as
  well as captured and made visible within the web application's
  user interface.
*/

// Create a console logger for the provided tank
export const createConsoleWrapper = (
  arena:Arena,
  app: TankApp,
  tank: Tank
) => {

  const streams = [
    {
      level: 'TRACE',
      stream: {write: (entry) => { arena.emitter.emit("log", {...entry, time: arena.clock.time, id: uuidv4() }) } },
    },
  ]

  // Convenience to create a readable id
  const tankId =
      (arena.processes.map(process => process.app.id).indexOf(app.id) + 1) * 10 +
      ((arena.processes.find(process => process.app.id===app.id)?.tanks.map(tank=>tank.id).indexOf(tank.id) || 0) + 1)

  const wrappedConsole = createLogger({
    name: app.name + ' <' + tankId + '>',
    streams,
  })

  // Reroute calls to console.log to logger.info
  return {
    log: (msg, ...msgs) => wrappedConsole.info(msg, ...msgs),
    info: (msg, ...msgs) => wrappedConsole.info(msg, ...msgs),
    trace: (msg, ...msgs) => wrappedConsole.trace(msg, ...msgs),
    debug: (msg, ...msgs) => wrappedConsole.debug(msg, ...msgs),
    warn: (msg, ...msgs) => wrappedConsole.warn(msg, ...msgs),
    error: (msg, ...msgs) => wrappedConsole.error(msg, ...msgs),
  }
}
