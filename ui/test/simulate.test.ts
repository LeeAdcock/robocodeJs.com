import { describe, it, expect } from 'vitest'
import simulate from '../src/util/simulate'

// The UI runs this partial mirror of the server's simulation between server
// ticks to interpolate smooth motion. It mutates the apps array in place.
// Angles are in degrees; 0° points "down" (+y).

function makeTank(overrides: Record<string, unknown> = {}) {
    return {
        x: 375,
        y: 375,
        speed: 0,
        health: 100,
        bodyOrientation: 0,
        bodyOrientationTarget: 0,
        bodyOrientationVelocity: 0,
        turretOrientation: 0,
        turretOrientationTarget: 0,
        turretOrientationVelocity: 0,
        radarOrientation: 0,
        radarOrientationTarget: 0,
        radarOrientationVelocity: 0,
        speedTarget: 0,
        speedAcceleration: 1,
        speedMax: 10,
        bullets: [] as Record<string, unknown>[],
        ...overrides,
    }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sim = (tanks: unknown[], w = 750, h = 750) =>
    simulate(0, [{ tanks }] as any, w, h)

describe('simulate — movement', () => {
    it('advances a tank along its orientation when inside the arena', () => {
        const tank = makeTank({ speed: 10 })
        sim([tank])
        expect(tank.x).toBeCloseTo(375)
        expect(tank.y).toBeCloseTo(385)
    })

    it('does not move a tank that would leave the arena', () => {
        const tank = makeTank({ x: 20, speed: 10, bodyOrientation: 90 })
        sim([tank])
        expect(tank.x).toBe(20)
        expect(tank.y).toBe(375)
    })

    it('snaps to speedTarget within one acceleration step', () => {
        const tank = makeTank({ speed: 9, speedTarget: 10, speedAcceleration: 2 })
        sim([tank])
        expect(tank.speed).toBe(10)
    })

    it('clamps speed to speedMax', () => {
        const tank = makeTank({
            speed: 9,
            speedTarget: 100,
            speedAcceleration: 5,
            speedMax: 10,
        })
        sim([tank])
        expect(tank.speed).toBe(10)
    })
})

describe('simulate — rotation', () => {
    it('rotates toward the target by the rotational velocity', () => {
        const tank = makeTank({
            bodyOrientation: 0,
            bodyOrientationTarget: 90,
            bodyOrientationVelocity: 10,
        })
        sim([tank])
        expect(tank.bodyOrientation).toBeCloseTo(10)
    })

    it('does not overshoot when the remaining angle is below the velocity', () => {
        const tank = makeTank({
            bodyOrientation: 0,
            bodyOrientationTarget: 5,
            bodyOrientationVelocity: 10,
        })
        sim([tank])
        expect(tank.bodyOrientation).toBeCloseTo(5)
    })
})

describe('simulate — bullets', () => {
    it('moves live bullets and leaves exploded ones in place', () => {
        const live = {
            x: 375,
            y: 375,
            speed: 5,
            orientation: 0,
            explodedAt: undefined,
        }
        const exploded = {
            x: 375,
            y: 375,
            speed: 5,
            orientation: 0,
            explodedAt: 5,
        }
        const tank = makeTank({ bullets: [live, exploded] })
        sim([tank])
        expect(live.y).toBeCloseTo(380)
        expect(exploded.y).toBe(375)
    })

    it('still advances bullets owned by a destroyed tank', () => {
        const bullet = {
            x: 375,
            y: 375,
            speed: 5,
            orientation: 0,
            explodedAt: undefined,
        }
        const tank = makeTank({ health: 0, speed: 10, bullets: [bullet] })
        sim([tank])
        expect(tank.y).toBe(375) // dead tank does not move
        expect(bullet.y).toBeCloseTo(380) // its bullet still does
    })
})
