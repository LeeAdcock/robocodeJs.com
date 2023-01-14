import Bullet from './bullet'
import Point from './point'
import Arena from './arena'
import Process from './process'
import { TimersContainer } from '../util/wrappers/timerWrapper'
import { v4 as uuidv4 } from 'uuid';
import { Event } from './event'
import { Orientated } from './orientated'
import { TankStats } from './tankStats'
import { TankTurret } from './tankTurret'

// Convenience function that ensures an angle is between 0 and 360
export const normalizeAngle = (x: number): number => {
  x = x % 360
  while (x < 0) x += 360
  return Math.floor(x)
}

// Convenience method to create a promise that resolves/rejects
// when specific conditions are met.
export const waitUntil = (
  successCondition: Function,
  failureCondition: Function | null = null,
  msg: String | null = null,
) => {
  return new Promise<void>(function (resolve, reject) {
    ;(function waitForFoo() {
      if (successCondition()) return resolve(undefined)
      if (failureCondition && failureCondition()) {
        try {
          return reject(msg)
        } catch (e) {
          console.log("3>", e)
        }
      }
      setTimeout(waitForFoo, 50)
    })()
  })
}

export default class Tank implements Point, Orientated {

  constructor(arena:Arena, process:Process) {
    this.arena = arena
    this.process = process

    let overallClosestTank: number | null = null
    do {
      this.x = 16 + (arena.width - 32) * Math.random()
      this.y = 16 + (arena.height - 32) * Math.random()

      // Keep iterating if we placed this tank too close to another
      overallClosestTank = arena.processes?.reduce(
        (
          closestDistanceForTankApp: number | null,
          curProcess: Process,
        ) => {
          const closestTankForThisTankApp = curProcess.tanks.reduce(
            (closestDistanceForTank: number | null, curTank: Tank) => {
              if (curTank.id === this.id)
                return closestDistanceForTank

              const curTankDistance: number | null = Math.sqrt(
                Math.pow(curTank.x - this.x, 2) + Math.pow(curTank.y - this.y, 2),
              )
              return !closestDistanceForTank
                ? curTankDistance
                : Math.min(closestDistanceForTank, curTankDistance)
            },
            null,
          )
          if (!closestDistanceForTankApp) return closestTankForThisTankApp
          if (!closestTankForThisTankApp) return closestDistanceForTankApp
          return Math.min(closestDistanceForTankApp, closestTankForThisTankApp)
        },
        null,
      )
    } while (overallClosestTank !== null && overallClosestTank < 50)

    this.orientation = Math.random() * 360
    this.orientationTarget = this.orientation
    this.turret = new TankTurret(this)

  }

  public turret: TankTurret

  public orientation: number = 0
  public orientationTarget: number = 0
  public orientationVelocity: number = 10

  public x: number
  public y: number

  public id: string = uuidv4()
  public speed: number = 0
  public speedTarget: number = 0
  public speedAcceleration: number = 2
  public speedMax: number = 5
  public needsStarting: boolean = true
  public handlers: any = {}
  public bullets: Bullet[] = []
  public health: number = 100
  public stats: any = new TankStats()
  public timers: any = new TimersContainer()
  public logger: any
  public process: Process
  public arena: Arena


    // Enables the registration of event handlers
    on(event: Event, handler) {
      if (!Object.keys(Event).includes(event)) throw new Error('Invalid event type.')

      // Keep a record of event promises, ignore repeated calls to event if previous promise
      // has not yet resolved.
      const eventPromiseMap: Map<Event, Promise<any>> = new Map<Event, Promise<any>>()

      this.handlers[event] = x =>
        eventPromiseMap.get(event)
          ? undefined
          : setTimeout(() => {
              try {
                if (event !== Event.TICK) {
                  if (x) this.logger.trace("Called event handler '" + event + "' with ", x)
                  else this.logger.trace("Called event handler '" + event + "'")
                }
                const startTime = new Date()
                const result = handler(x)
                if (result) {
                  eventPromiseMap.set(event, result)
                  result
                    .then(() => eventPromiseMap.delete(event))
                    .catch(e => {
                      this.logger.warn(e)
                      eventPromiseMap.delete(event)
                    })
                }

                const endTime = new Date()
                const duration = endTime.getTime() - startTime.getTime()
                if (duration > 25) this.logger.warn('Handler ' + event + ' took a long time')
              } catch (e) {
                this.logger.error(e)
              }
            }, 0)
    }

    setName(name) {
      // todo sanitize name
      if(this.process.app.name !== name) {
        this.process.app.name = name,
        this.arena.emitter.emit("event", {
          type:"appRenamed",
          appId: this.process.app.id,
          tankId: this.id,
          name: name,
        })
      }
    }
  
    getId() { return this.id }

    getHealth() { this.health / 100 }

    setOrientation(d:number) {
      const target = normalizeAngle(d)
      this.orientationTarget = target
      console.log("orient", d)
      // todo only if this is an actual change
      this.arena.emitter.emit("event", {
        type:"tankTurn",
        time: this.arena.clock.time,
        id:this.id,
        x: this.x,
        y: this.y,
        bodyOrientationTarget: this.orientationTarget,
        bodyOrientation: this.orientation,
        bodyOrientationVelocity: this.orientationVelocity})
      this.logger.trace('Turning to ' + this.orientationTarget + '°')
      if (this.orientationTarget === this.orientation) return Promise.resolve()
      return waitUntil(
        () => {console.log(this.orientation, target, this.orientation === target); return this.orientation === target },
        () => !this.arena.running || this.orientationTarget !== target || this.health <= 0,
        'Orientation change cancelled',
      )
    }

    getOrientation() { return normalizeAngle(this.orientation) }

    isTurning() { return this.orientation !== this.orientationTarget}

    turn(d) {
      const target = normalizeAngle(this.orientation + d)
      this.orientationTarget = target
      // todo only if this is an actual change
      this.arena.emitter.emit("event", {
        type:"tankTurn",
        time: this.arena.clock.time,
        id: this.id,
        x: this.x,
        y: this.y,
        bodyOrientationTarget: this.orientationTarget,
        bodyOrientation:this.orientation,
        bodyOrientationVelocity:this.orientationVelocity})
        this.logger.trace('Turning to ' + this.orientationTarget + '°')
      if (this.orientationTarget === this.orientation) return Promise.resolve()
      return waitUntil(
        () => this.orientation === target,
        () => !this.arena.running || this.orientationTarget !== target || this.health <= 0,
        'Turn cancelled',
      )
    }

    setSpeed(d: number) {
      this.speedTarget = Math.min(d, this.speedMax)
      // todo only if this is an actual change
      this.arena.emitter.emit("event", {
        type:"tankAccelerate",
        time: this.arena.clock.time,
        id: this.id,
        x: this.x,
        y: this.y,
        speed: this.speed,
        speedTarget: this.speedTarget,
        speedAcceleration: this.speedAcceleration,
        speedMax: this.speedMax
      })
      try {
        this.logger.trace(d === 0 ? 'Stopping' : 'Accelerating to ' + this.speedTarget)
      } catch (e) {
        console.log(e)
      }
      return waitUntil(
        () => this.speed === Math.min(d, this.speedMax),
        () => !this.arena.running || this.speedTarget !== Math.min(d, this.speedMax) || this.health <= 0,
        'Speed change cancelled',
      )
    }

    getSpeed() { return this.speed }

    getX() { return this.x }

    getY() { return this.y}

    send(x: number) {if (!Number.isInteger(x)) {
        throw new Error('Must be numeric')
      }
      this.logger.trace('Sending message "' + x + '"')
      this.stats.messagesSent += 1
      this.arena.processes.forEach(otherProcess => {
        otherProcess.tanks
          .filter(otherTank => otherTank.health > 0)
          .forEach((otherTank, otherTankIndex) => {
            if (otherTank.id !== this.id) {
              otherTank.stats.messagesReceived += 1
              if (otherTank.handlers[Event.RECEIVED]) {
                otherTank.handlers[Event.RECEIVED](x)
              }
            }
          })
      })
    }
}
