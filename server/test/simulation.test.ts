import { describe, it, expect, vi } from 'vitest'
import Simulation from '../src/util/simulation'
import { Event } from '../src/types/event'

// Simulation.run only reads/writes plain tank fields and invokes
// tank.handlers[...] functions, so we can drive the real physics with
// lightweight mock tanks (no isolates). Angles are in degrees; 0° points
// "down" (+y), so a tank at orientation 0 moving at speed s advances +s in y.

function makeTank(overrides: Record<string, unknown> = {}) {
    return {
        id: 'tank',
        health: 100,
        appCrashed: false,
        needsStarting: false,
        handlers: {} as Record<string, (arg?: unknown) => void>,
        x: 375,
        y: 375,
        speed: 0,
        speedTarget: 0,
        speedAcceleration: 1,
        speedMax: 10,
        orientation: 0,
        orientationTarget: 0,
        orientationVelocity: 0,
        stats: {
            timesCollided: 0,
            timesHit: 0,
            shotsHit: 0,
            distanceTraveled: 0,
        },
        logger: { trace: vi.fn() },
        bullets: [] as Record<string, unknown>[],
        turret: {
            loaded: 100,
            orientation: 0,
            orientationTarget: 0,
            orientationVelocity: 0,
            radar: {
                charged: 100,
                orientation: 0,
                orientationTarget: 0,
                orientationVelocity: 0,
            },
        },
        timers: { intervalMap: {}, timerMap: {} },
        ...overrides,
    }
}

function makeProcess(appId: string, tanks: unknown[]) {
    return { getAppId: () => appId, tanks }
}

function makeEnv(
    processes: unknown[],
    { time = 0, width = 750, height = 750 } = {}
) {
    return {
        emit: vi.fn(),
        getTime: () => time,
        getProcesses: () => processes,
        getArena: () => ({ getWidth: () => width, getHeight: () => height }),
    }
}

const run = (env: ReturnType<typeof makeEnv>) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    Simulation.run(env as any)

describe('Simulation.run — movement', () => {
    it('advances a tank along its orientation (0° = +y)', () => {
        const tank = makeTank({ speed: 10, speedTarget: 10, speedMax: 10 })
        run(makeEnv([makeProcess('a', [tank])]))
        expect(tank.x).toBeCloseTo(375)
        expect(tank.y).toBeCloseTo(385)
        expect(tank.stats.distanceTraveled).toBe(10)
    })

    it('accelerates toward speedTarget using pre-acceleration speed for the step', () => {
        const tank = makeTank({ speed: 0, speedTarget: 10, speedAcceleration: 2 })
        run(makeEnv([makeProcess('a', [tank])]))
        // moved with speed 0 (no displacement), then accelerated by 2
        expect(tank.y).toBeCloseTo(375)
        expect(tank.speed).toBe(2)
    })

    it('snaps to speedTarget within one acceleration step', () => {
        const tank = makeTank({ speed: 9, speedTarget: 10, speedAcceleration: 2 })
        run(makeEnv([makeProcess('a', [tank])]))
        expect(tank.speed).toBe(10)
    })

    it('clamps speed to speedMax', () => {
        const tank = makeTank({
            speed: 9,
            speedTarget: 100,
            speedAcceleration: 5,
            speedMax: 10,
        })
        run(makeEnv([makeProcess('a', [tank])]))
        expect(tank.speed).toBe(10)
    })
})

describe('Simulation.run — rotation', () => {
    it('rotates the body toward its target by the rotational velocity', () => {
        const tank = makeTank({
            orientation: 0,
            orientationTarget: 90,
            orientationVelocity: 10,
        })
        run(makeEnv([makeProcess('a', [tank])]))
        expect(tank.orientation).toBeCloseTo(10)
    })

    it('recharges the turret and radar each tick', () => {
        const tank = makeTank()
        tank.turret.loaded = 90
        tank.turret.radar.charged = 80
        run(makeEnv([makeProcess('a', [tank])]))
        expect(tank.turret.loaded).toBe(92)
        expect(tank.turret.radar.charged).toBe(90)
    })
})

describe('Simulation.run — collisions', () => {
    it('stops the tank and applies damage at the arena boundary', () => {
        const collided = vi.fn()
        const tank = makeTank({ x: 10, handlers: { [Event.COLLIDED]: collided } })
        const env = makeEnv([makeProcess('a', [tank])])
        run(env)
        expect(collided).toHaveBeenCalledWith({ angle: 0 })
        expect(tank.health).toBe(99)
        expect(tank.speed).toBe(0)
        expect(tank.x).toBe(10) // movement not applied on collision
        expect(env.emit).toHaveBeenCalledWith(
            'event',
            expect.objectContaining({ type: 'tankStop' })
        )
    })

    it('fires COLLIDED on two tanks that overlap, flagging friendly teams', () => {
        const c1 = vi.fn()
        const c2 = vi.fn()
        const t1 = makeTank({
            id: '1',
            x: 375,
            y: 375,
            handlers: { [Event.COLLIDED]: c1 },
        })
        const t2 = makeTank({
            id: '2',
            x: 385,
            y: 375,
            handlers: { [Event.COLLIDED]: c2 },
        })
        run(makeEnv([makeProcess('a', [t1, t2])]))
        expect(c1).toHaveBeenCalledWith(
            expect.objectContaining({ friendly: true })
        )
        expect(c2).toHaveBeenCalled()
        expect(t1.stats.timesCollided).toBeGreaterThan(0)
    })
})

describe('Simulation.run — bullets', () => {
    it('damages a tank hit by an enemy bullet and explodes the bullet', () => {
        const hit = vi.fn()
        const target = makeTank({
            id: 'a',
            x: 375,
            y: 375,
            handlers: { [Event.HIT]: hit },
        })
        const bullet = {
            id: 'b1',
            x: 375,
            y: 375,
            speed: 5,
            orientation: 0,
            exploded: false,
            origin: { x: 375, y: 365 },
            callback: vi.fn(),
        }
        const shooter = makeTank({ id: 'b', x: 375, y: 300, bullets: [bullet] })
        const env = makeEnv([
            makeProcess('a', [target]),
            makeProcess('b', [shooter]),
        ])
        run(env)
        expect(target.health).toBe(75)
        expect(hit).toHaveBeenCalledTimes(1)
        expect(bullet.exploded).toBe(true)
        expect(target.stats.timesHit).toBe(1)
        expect(shooter.stats.shotsHit).toBe(1)
        expect(env.emit).toHaveBeenCalledWith(
            'event',
            expect.objectContaining({ type: 'bulletExploded', id: 'b1' })
        )
    })

    it('moves a live bullet along its orientation', () => {
        const bullet = {
            id: 'b1',
            x: 375,
            y: 375,
            speed: 5,
            orientation: 0,
            exploded: false,
            origin: { x: 375, y: 375 },
        }
        const tank = makeTank({ bullets: [bullet] })
        run(makeEnv([makeProcess('a', [tank])]))
        expect(bullet.x).toBeCloseTo(375)
        expect(bullet.y).toBeCloseTo(380)
    })

    it('removes a bullet that leaves the arena', () => {
        const bullet = {
            id: 'b1',
            x: 375,
            y: 800, // already past the height + 32 margin
            speed: 0,
            orientation: 0,
            exploded: false,
            origin: { x: 375, y: 375 },
            callback: vi.fn(),
        }
        const tank = makeTank({ bullets: [bullet] })
        const env = makeEnv([makeProcess('a', [tank])])
        run(env)
        expect(tank.bullets).toHaveLength(0)
        expect(env.emit).toHaveBeenCalledWith(
            'event',
            expect.objectContaining({ type: 'bulletRemoved', id: 'b1' })
        )
    })
})

describe('Simulation.run — lifecycle', () => {
    it('kills a tank whose bot code crashed', () => {
        const tank = makeTank({ appCrashed: true })
        const env = makeEnv([makeProcess('a', [tank])])
        run(env)
        expect(tank.health).toBe(0)
        expect(env.emit).toHaveBeenCalledWith(
            'event',
            expect.objectContaining({ type: 'tankDamaged', health: 0 })
        )
    })

    it('runs the START handler exactly once', () => {
        const start = vi.fn()
        const tank = makeTank({
            needsStarting: true,
            handlers: { [Event.START]: start },
        })
        const env = makeEnv([makeProcess('a', [tank])])
        run(env)
        run(env)
        expect(start).toHaveBeenCalledTimes(1)
        expect(tank.needsStarting).toBe(false)
    })
})
