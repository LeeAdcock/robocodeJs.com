import App from '../../types/tankApp'
import Bullet from '../../types/bullet'
import { Event } from '../../types/event'

/*
  This creates an object that the user-provided code interacts with
  to control the tank and its movements.
*/

// Convenience function that ensures an angle is between 0 and 360
const normalizeAngle = (x: number): number => {
  x = x % 360
  while (x < 0) x += 360
  return Math.floor(x)
}

// Convenience method to calculate a unqiue id
const getTankId = (appIndex: number, tankIndex: number) => (appIndex + 1) * 10 + (tankIndex + 1)

// Convenience method to create a promise that resolves/rejects
// when specific conditions are met.
const waitUntil = (
  successCondition: Function,
  failureCondition: Function | null = null,
  msg: String | null = null,
) =>
  new Promise(function (resolve, reject) {
    ;(function waitForFoo() {
      if (successCondition()) return resolve(null)
      if (failureCondition && failureCondition()) return reject(msg)
      setTimeout(waitForFoo, 50)
    })()
  })

// Create timer and interval wrapper functions for the provided tank
export const createTankWrapper = (apps: App[], appIndex: number, tankIndex: number, tankLogger) => {
  const app = apps[appIndex]
  const tank = apps[appIndex].tanks[tankIndex]

  // Tank object visible to the bot application
  const tankWrapper = {
    __raw__: tank,
    // Enables the registration of event handlers
    on: (event: Event, handler) => {
      if (!Object.keys(Event).includes(event)) throw new Error('Invalid event type.')

      // Keep a record of event promises, ignore repeated calls to event if previous promise
      // has not yet resolved.
      const eventPromiseMap: Map<Event, Promise<any>> = new Map<Event, Promise<any>>()

      tank.handlers[event] = x =>
        eventPromiseMap.get(event)
          ? undefined
          : setTimeout(() => {
              try {
                if (event !== Event.TICK) {
                  if (x) tankLogger.trace("Called event handler '" + event + "' with ", x)
                  else tankLogger.trace("Called event handler '" + event + "'")
                }
                const startTime = new Date()
                const result = handler(x)
                if (result) {
                  eventPromiseMap.set(event, result)
                  result
                    .then(() => eventPromiseMap.delete(event))
                    .catch(e => {
                      tankLogger.warn(e)
                      eventPromiseMap.delete(event)
                    })
                }

                const endTime = new Date()
                const duration = endTime.getTime() - startTime.getTime()
                if (duration > 25) tankLogger.warn('Handler ' + event + ' took a long time')
              } catch (e) {
                tankLogger.error(e)
              }
            }, 0)
    },

    setName: name => (app.name = name),

    getId: () => getTankId(appIndex, tankIndex),

    getHealth: () => tank.health / 100,

    setOrientation: d => {
      const target = normalizeAngle(d)
      tank.bodyOrientationTarget = target
      tankLogger.trace('Turning to ' + tank.bodyOrientationTarget + '°')
      if (tank.bodyOrientationTarget === tank.bodyOrientation) return Promise.resolve()
      return waitUntil(
        () => tank.bodyOrientation === target,
        () => tank.bodyOrientationTarget !== target || tank.health <= 0,
        'Orientation change cancelled',
      )
    },

    getOrientation: () => normalizeAngle(tank.bodyOrientation),

    isTurning: () => tank.bodyOrientation !== tank.bodyOrientationTarget,

    turn: d => {
      const target = normalizeAngle(tank.bodyOrientation + d)
      tank.bodyOrientationTarget = target
      tankLogger.trace('Turning to ' + tank.bodyOrientationTarget + '°')
      if (tank.bodyOrientationTarget === tank.bodyOrientation) return Promise.resolve()
      return waitUntil(
        () => tank.bodyOrientation === target,
        () => tank.bodyOrientationTarget !== target || tank.health <= 0,
        'Turn cancelled',
      )
    },

    setSpeed: d => {
      tank.speedTarget = Math.min(d, tank.speedMax)
      tankLogger.trace(d === 0 ? 'Stopping' : 'Accelerating to ' + tank.speedTarget)
      return waitUntil(
        () => tank.speed === Math.min(d, tank.speedMax),
        () => tank.speedTarget !== Math.min(d, tank.speedMax) || tank.health <= 0,
        'Speed change cancelled',
      )
    },

    getSpeed: () => tank.speed,

    getX: () => tank.x,

    getY: () => tank.y,

    send: (x: number) => {
      if (!Number.isInteger(x)) {
        throw new Error('Must be numeric')
      }
      tankLogger.trace('Sending message "' + x + '"')
      tank.stats.messagesSent += 1
      apps.forEach((otherApp, otherAppIndex) => {
        otherApp.tanks
          .filter(otherTank => tank.health > 0)
          .forEach((otherTank, otherTankIndex) => {
            if (otherAppIndex !== appIndex || otherTankIndex !== tankIndex) {
              otherTank.stats.messagesReceived += 1
              if (otherTank.handlers[Event.RECEIVED]) {
                otherTank.handlers[Event.RECEIVED](x)
              }
            }
          })
      })
    },

    radar: {
      setOrientation: d => {
        const target = normalizeAngle(d)
        tank.radarOrientationTarget = target
        tankLogger.trace('Turning radar to ' + tank.radarOrientationTarget + '°')
        if (tank.radarOrientationTarget === tank.radarOrientation) return Promise.resolve()
        return waitUntil(
          () => tank.radarOrientation === target % 360,
          () => tank.radarOrientationTarget !== target % 360,
          'Radar orientation change cancelled',
        )
      },

      getOrientation: () => normalizeAngle(tank.radarOrientation),

      isTurning: () => tank.radarOrientation !== tank.radarOrientationTarget,

      turn: d => {
        const target = normalizeAngle(tank.radarOrientation + d)
        tank.radarOrientationTarget = target
        tankLogger.trace('Turning radar to ' + tank.radarOrientationTarget + '°')
        if (tank.radarOrientationTarget === tank.radarOrientation) return Promise.resolve()
        return waitUntil(
          () => tank.radarOrientation === target,
          () => tank.radarOrientationTarget !== target || tank.health <= 0,
          'Radar turn chancelled',
        )
      },

      onReady: () => {
        let peakValue = tank.radarCharged
        return waitUntil(
          () => tank.radarCharged >= 100,
          () => {
            // Reject if the value decreases, or bot dies
            peakValue = Math.max(peakValue, tank.radarCharged)
            return tank.health <= 0 || tank.radarCharged < peakValue
          },
          'Radar already scanned',
        )
      },

      isReady: () => tank.radarCharged >= 100,

      scan: () => {
        if (tank.radarCharged < 100) return Promise.reject('Radar not ready')
        tankLogger.trace('Scanning')
        tank.radarCharged = 0
        tank.radarOn = true
        setTimeout(() => (tank.radarOn = false), 100)

        tank.stats.scansCompleted += 1

        const found: any[] = []
        apps.forEach((otherApp, otherAppIndex) => {
          otherApp.tanks.forEach((otherTank, otherTankIndex) => {
            if (
              otherTank.health > 0 &&
              (otherAppIndex !== appIndex || otherTankIndex !== tankIndex)
            ) {
              const distance = Math.sqrt(
                Math.pow(otherTank.x - tank.x, 2) + Math.pow(otherTank.y - tank.y, 2),
              )
              const angle: number = normalizeAngle(
                Math.atan2(otherTank.y - tank.y, otherTank.x - tank.x) * (180 / Math.PI) - 90,
              )
              const radarAngle: number = normalizeAngle(
                tank.bodyOrientation + tank.turretOrientation + tank.radarOrientation,
              )
              if (
                distance < 300 &&
                Math.abs(normalizeAngle(angle - radarAngle + 180) - 180) <
                  (500 - distance) * (0.5 / 10)
              ) {
                if (otherTank.handlers[Event.DETECTED]) {
                  otherTank.handlers[Event.DETECTED]()
                }
                otherTank.stats.timesDetected += 1
                found.push({
                  id: getTankId(otherAppIndex, otherTankIndex),
                  speed: otherTank.speed,
                  orientation: otherTank.bodyOrientation,
                  distance,
                  angle,
                  friendly: appIndex === otherAppIndex,
                })
              }
            }
          })
        })
        if (tank.handlers[Event.SCANNED]) {
          tank.handlers[Event.SCANNED](found)
        }

        tankLogger.trace(`Scan detected ${found.length} bots`)
        tank.stats.scansDetected += found.length

        return Promise.resolve(found)
      },
    },

    turret: {
      setOrientation: d => {
        const target = normalizeAngle(d)
        tank.turretOrientationTarget = normalizeAngle(d)
        tankLogger.trace('Turning turret to ' + tank.turretOrientationTarget + '°')
        if (tank.turretOrientationTarget === tank.turretOrientation) return Promise.resolve()
        return waitUntil(
          () => tank.turretOrientation === target % 360,
          () => tank.turretOrientationTarget !== target % 360 || tank.health <= 0,
          'Turret orientation change cancelled',
        )
      },

      getOrientation: () => normalizeAngle(tank.turretOrientation),

      isTurning: () => tank.turretOrientation !== tank.turretOrientationTarget,

      turn: d => {
        const target = normalizeAngle(tank.turretOrientation + d)
        tank.turretOrientationTarget = target
        tankLogger.trace('Turning turret to ' + tank.turretOrientationTarget + '°')
        if (tank.turretOrientationTarget === tank.turretOrientation) return Promise.resolve()
        return waitUntil(
          () => tank.turretOrientation === target,
          () => tank.turretOrientationTarget !== target || tank.health <= 0,
          'Turret turn cancelled',
        )
      },

      onReady: () => {
        let peakValue = tank.turretLoaded
        return waitUntil(
          () => tank.turretLoaded >= 100,
          () => {
            // Reject if the value decreases, or bot dies
            peakValue = Math.max(peakValue, tank.turretLoaded)
            return tank.health <= 0 || tank.turretLoaded < peakValue
          },
          'Turret already fired',
        )
      },

      isReady: () => tank.turretLoaded >= 100,

      fire: () => {
        if (tank.turretLoaded < 100) return Promise.reject('Turret not ready')
        tankLogger.trace('Turret firing')

        tank.stats.shotsFired += 1

        if (tank.handlers[Event.FIRED]) {
          tank.handlers[Event.FIRED]()
        }

        const bullet = new Bullet()
        bullet.x = tank.x
        bullet.y = tank.y
        bullet.origin.x = tank.x
        bullet.origin.y = tank.y
        bullet.orientation = tank.bodyOrientation + tank.turretOrientation
        tank.bullets.push(bullet)
        tank.turretLoaded = 0

        return new Promise(resolve => {
          bullet.callback = resolve
        })
      },
    },
  }

  return tankWrapper
}
