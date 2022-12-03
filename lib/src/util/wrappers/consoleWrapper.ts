import { createLogger, ConsoleFormattedStream } from 'browser-bunyan'
import App from '../../types/tankApp'

/*
  This creates "monkey-patched" console wrapper so that logging
  output from the tank can be styled for the browser console as
  well as captured and made visible within the web application's
  user interface.
*/

// Convenience method to calculate a unqiue id
const getTankId = (appIndex: number, tankIndex: number) => (appIndex + 1) * 10 + (tankIndex + 1)

// Create a console logger for the provided tank
export const createConsoleWrapper = (
  apps: App[],
  appIndex: number,
  tankIndex: number,
  buffer: any,
  writeToConsole: boolean,
) => {
  const app = apps[appIndex]

  const streams = [
    {
      level: 'TRACE',
      stream: buffer,
    },
  ]

  if (writeToConsole)
    streams.push({
      level: 'TRACE',
      stream: new ConsoleFormattedStream(),
    })

  const wrappedConsole = createLogger({
    name: app.name + ' <' + getTankId(appIndex, tankIndex) + '>',
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
