#! /usr/bin/env node
import yargs from 'yargs'
import cliProgress from 'cli-progress'
import { hideBin } from 'yargs/helpers'
import colors from 'colors'
import { Simulation } from '@battletank/lib'
import fs from 'fs'

import { init } from './util'

// Prevent promise rejections in tank logic from clobering logs
process.on('unhandledRejection', (reason, promise) => {
  // do nothing
})

// Configure command line arguments
const argv = yargs(hideBin(process.argv))
  .option('botCount', {
    alias: 'b',
    type: 'number',
    default: 5,
    description: 'number of bots for each app',
  })
  .option('mode', {
    alias: 'm',
    type: 'string',
    default: 'laststanding',
    choices: ['laststanding', 'knockout'],
    description: 'conditions for game completion',
  })
  .option('arenaWidth', {
    alias: 'w',
    type: 'number',
    default: 750,
    description: 'arena width',
  })
  .option('arenaHeight', {
    alias: 'h',
    type: 'number',
    default: 750,
    description: 'arena height',
  })
  .option('file', {
    alias: 'f',
    array: true,
    type: 'string',
    demandOption: true,
    description: 'path to bot js file or directory of files',
  })
  .option('battleCount', {
    alias: 'b',
    default: 1,
    type: 'number',
    description: 'number of battles',
  })
  .option('appsInArena', {
    alias: 'a',
    type: 'number',
    description: 'number of apps in the arena at one time',
    default: 'all',
  })
  .option('slowDeathTime', {
    alias: 's',
    type: 'number',
    description: 'number of clock ticks before slow death begins',
    default: '10000',
  }).argv

const files: string[] = Array.isArray(argv.file) ? argv.file : [argv.file]
const mode: string = argv.mode
const botCount: number = argv.botCount
const arenaWidth = argv.arenaWidth
const arenaHeight = argv.arenaHeight
const battleCount = argv.battleCount
const slowDeathTime = argv.slowDeathTime

// Grab contents from directories
files.forEach((directory, directoryIndex) => {
  if (fs.lstatSync(directory).isDirectory()) {
    fs.readdirSync(directory).forEach(file => {
      if (file.endsWith('.js')) {
        files.push(directory + '/' + file)
      }
    })
    files.splice(directoryIndex, 1)
  }
})
const appsInArena = argv.appsInArena === 'all' ? files.length : argv.appsInArena

// Run the game
// We use an interval here instead of a loop to enable other
// process (like the progress bar) to have execution cycles
const simulate = (apps, bars, multibar, logs, clock, resolve) => {
  Simulation.run(clock.time, apps, arenaWidth, arenaHeight)

  clock.time = clock.time + 1

  // Health decays after sudden death time
  if (clock.time > slowDeathTime && clock.time % 50 === 0) {
    apps.forEach(app => {
      app.tanks
        .filter(tank => tank.health > 0)
        .forEach(tank => {
          tank.health = Math.max(0, tank.health - 1)
        })
    })
  }

  // Calculate application health
  const appHealth: any[] = apps.map(
    app => app.tanks.reduce((sum, tank) => sum + tank.health, 0) / (app.tanks.length * 100),
  )

  // Update the status bars
  appHealth
    .filter((health, index) => bars[index].isActive)
    .forEach((health, index) =>
      bars[index].update(health * 100, {
        index: index + 1,
        name: (apps[index].name || '').padEnd(20, ' '),
        health: Math.max(0, Math.ceil(health * 100))
          .toString()
          .padStart(3, ' '),
        log: health <= 0 ? colors.red('Dead') : (logs[index].getLastRecord() || {})['msg'],
      }),
    )

  // Stop game if winning conditions are met
  if (appHealth.filter(item => item > 0).length === 0) {
    appHealth
      .filter((health, index) => bars[index].isActive)
      .forEach((health, index) =>
        bars[index].update(health * 100, {
          log: health > 0 ? colors.green('Winner') : colors.red('Dead'),
        }),
      )
    multibar.stop()
    resolve(apps.map((app, index) => ({ name: app.name, health: appHealth[index] })))
    return
  }
  switch (mode) {
    case 'knockout':
      // Game is over if any app has no living bots
      if (appHealth.some(item => item <= 0)) {
        appHealth
          .filter((health, index) => bars[index].isActive)
          .forEach((health, index) =>
            bars[index].update(health * 100, {
              log: health > 0 ? colors.green('Winner') : colors.red('Dead'),
            }),
          )

        multibar.stop()
        resolve(apps.map((app, index) => ({ name: app.name, health: appHealth[index] })))
      } else setTimeout(simulate, 0, apps, bars, multibar, logs, clock, resolve)
      break
    case 'laststanding':
      // Game is over if only one app has living bots
      if (appHealth.filter(item => item > 0).length <= 1) {
        appHealth
          .filter((health, index) => bars[index].isActive)
          .forEach((health, index) =>
            bars[index].update(health * 100, {
              log: health > 0 ? colors.green('Winner') : colors.red('Dead'),
            }),
          )
        multibar.stop()
        resolve(apps.map((app, index) => ({ name: app.name, health: appHealth[index] })))
      } else setTimeout(simulate, 0, apps, bars, multibar, logs, clock, resolve)
      break
    default:
    // oops
  }
}

// Create subgames for the desired number of bots in each match
function* subsets(array, offset = 0) {
  while (offset < array.length) {
    const first = array[offset++]
    for (const subset of subsets(array, offset)) {
      subset.push(first)
      yield subset
    }
  }
  yield []
}
const games = Array.from(subsets(files)).filter(
  game => (game as Array<number>).length === appsInArena,
)

// Duplicate games for each number of matches for each combination
games.forEach(game => {
  for (let i = 1; i < battleCount; i++) games.push(game)
})
games.sort()

// Run the matches!
const results: any[] = []
const run = () =>
  new Promise<void>(res => {
    // Get the current match configuration
    const game = games.shift()
    if (game === undefined) {
      return res()
    }


    // Create new progress container with bars for each app
    const multibar = new cliProgress.MultiBar(
      {
        fps: 4,
        format: '{index}] {name} {health}% [{bar}] {log}',
      },
      cliProgress.Presets.shades_grey,
    )

    // Run the match
    const clock = { time: 0 }
    const { apps, logs } = init(game, botCount, arenaWidth, arenaHeight, () => clock.time)
    const bars = apps.map(app => multibar.create(100, 100))
    return new Promise(resolve => simulate(apps, bars, multibar, logs, clock, resolve))
      .then(result => {
        results.push(result)
        return run()
      })
      .then(res)
  })

run().then(() => {
  const final = {}

  // Calculate final scores
  results.forEach(result => {
    result
      .sort((a, b) => a.health - b.health)
      .forEach((app, index) => {
        final[app.name] = (final[app.name] || 0) + ( app.health > 0 ? index : 0)
      })
  })

  // Output results
  Object.keys(final).sort((a, b) => final[b]-final[a]).forEach((app, index)=> {
    console.log(index+1+".", app, final[app])
  })

  process.exit()
})
