import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'
import express from 'express'
import bodyParser from 'body-parser'
import cookieParser from 'cookie-parser'
import request from 'supertest'

// Mock the data-access singletons so the Express handlers can be tested in
// isolation — no Postgres, no isolates. (Mocking the services also means their
// real modules, which import util/db and the simulation engine, never load.)
vi.mock('../src/services/UserService', () => ({ default: { get: vi.fn() } }))
vi.mock('../src/services/AppService', () => ({
    default: { get: vi.fn(), getForUser: vi.fn(), create: vi.fn() },
}))
vi.mock('../src/services/ArenaService', () => ({
    default: { getForUser: vi.fn(), getDefaultForUser: vi.fn() },
}))
vi.mock('../src/services/ArenaMemberService', () => ({
    default: { getForApp: vi.fn(), getForArena: vi.fn() },
}))
vi.mock('../src/services/EnvironmentService', () => ({
    default: { getByArenaId: vi.fn(), has: vi.fn(), get: vi.fn() },
}))

import userService from '../src/services/UserService'
import appService from '../src/services/AppService'
import arenaMemberService from '../src/services/ArenaMemberService'
import healthRouter from '../src/api/health'
import userRouter from '../src/api/user'
import appRouter from '../src/api/app'

// Build an Express app around a router, injecting an authenticated user the way
// the real auth middleware would (the routers read req.user for ownership checks).
function makeApp(
    router: express.Express,
    authedUser?: { getId: () => string }
) {
    const app = express()
    app.use(bodyParser.json())
    app.use(bodyParser.raw({ type: 'application/octet-stream' }))
    app.use(cookieParser())
    app.use((req, _res, next) => {
        if (authedUser) (req as unknown as { user: unknown }).user = authedUser
        next()
    })
    app.use(router)
    return app
}

const mockUser = (id: string) => ({
    getId: () => id,
    getName: () => `User ${id}`,
    getPicture: () => 'pic.png',
})
const mockApp = (id: string) => ({
    getId: () => id,
    getName: () => `App ${id}`,
    getUserId: () => 'u1',
    getSource: () => '// bot code',
    delete: vi.fn().mockResolvedValue(undefined),
})

beforeEach(() => {
    vi.clearAllMocks()
})

describe('GET /health', () => {
    it('returns ok', async () => {
        const res = await request(makeApp(healthRouter)).get('/health')
        expect(res.status).toBe(200)
        expect(res.body).toEqual({ status: 'ok' })
    })
})

describe('user endpoints', () => {
    it('GET /api/user returns the authenticated user with their apps', async () => {
        ;(appService.getForUser as Mock).mockResolvedValue([mockApp('a1')])
        const res = await request(makeApp(userRouter, mockUser('u1'))).get(
            '/api/user'
        )
        expect(res.status).toBe(200)
        expect(res.body).toMatchObject({
            id: 'u1',
            apps: [{ id: 'a1', name: 'App a1' }],
        })
    })

    it('GET /api/user without a session is unauthorized', async () => {
        const res = await request(makeApp(userRouter)).get('/api/user')
        expect(res.status).toBe(401)
    })

    it('GET /api/user/:userId returns 404 for an unknown user', async () => {
        ;(userService.get as Mock).mockResolvedValue(undefined)
        const res = await request(makeApp(userRouter)).get('/api/user/nope')
        expect(res.status).toBe(404)
    })

    it('GET /api/user/:userId returns the user when found', async () => {
        ;(userService.get as Mock).mockResolvedValue(mockUser('u1'))
        ;(appService.getForUser as Mock).mockResolvedValue([])
        const res = await request(makeApp(userRouter)).get('/api/user/u1')
        expect(res.status).toBe(200)
        expect(res.body).toMatchObject({ id: 'u1', apps: [] })
    })
})

describe('app endpoints', () => {
    it('GET /api/user/:userId/apps lists the user apps', async () => {
        ;(userService.get as Mock).mockResolvedValue(mockUser('u1'))
        ;(appService.getForUser as Mock).mockResolvedValue([
            mockApp('a1'),
            mockApp('a2'),
        ])
        const res = await request(makeApp(appRouter)).get('/api/user/u1/apps')
        expect(res.status).toBe(200)
        expect(res.body).toEqual([
            { id: 'a1', name: 'App a1' },
            { id: 'a2', name: 'App a2' },
        ])
    })

    it('GET /api/user/:userId/apps returns 404 for an unknown user', async () => {
        ;(userService.get as Mock).mockResolvedValue(undefined)
        const res = await request(makeApp(appRouter)).get('/api/user/u1/apps')
        expect(res.status).toBe(404)
    })

    it('POST /api/user/:userId/app creates an app for the owner', async () => {
        ;(userService.get as Mock).mockResolvedValue(mockUser('u1'))
        ;(appService.create as Mock).mockResolvedValue(mockApp('a9'))
        const res = await request(makeApp(appRouter, mockUser('u1'))).post(
            '/api/user/u1/app/'
        )
        expect(res.status).toBe(201)
        expect(res.body).toEqual({ appId: 'a9' })
        expect(appService.create).toHaveBeenCalledWith('u1')
    })

    it('POST /api/user/:userId/app is forbidden for a different user', async () => {
        ;(userService.get as Mock).mockResolvedValue(mockUser('u1'))
        const res = await request(makeApp(appRouter, mockUser('someone-else')))
            .post('/api/user/u1/app/')
        expect(res.status).toBe(401)
        expect(appService.create).not.toHaveBeenCalled()
    })

    it('POST /api/user/:userId/app returns 404 for an unknown user', async () => {
        ;(userService.get as Mock).mockResolvedValue(undefined)
        const res = await request(makeApp(appRouter, mockUser('u1'))).post(
            '/api/user/u1/app/'
        )
        expect(res.status).toBe(404)
    })

    it('GET /api/user/:userId/app/:appId/source returns the source to the owner', async () => {
        ;(userService.get as Mock).mockResolvedValue(mockUser('u1'))
        ;(appService.get as Mock).mockResolvedValue(mockApp('a1'))
        const res = await request(makeApp(appRouter, mockUser('u1'))).get(
            '/api/user/u1/app/a1/source'
        )
        expect(res.status).toBe(200)
        expect(res.text).toBe('// bot code')
    })

    it('GET /api/user/:userId/app/:appId/source returns 404 for an unknown app', async () => {
        ;(userService.get as Mock).mockResolvedValue(mockUser('u1'))
        ;(appService.get as Mock).mockResolvedValue(undefined)
        const res = await request(makeApp(appRouter, mockUser('u1'))).get(
            '/api/user/u1/app/missing/source'
        )
        expect(res.status).toBe(404)
    })

    it('DELETE /api/user/:userId/app/:appId removes the app for the owner', async () => {
        const app = mockApp('a1')
        ;(userService.get as Mock).mockResolvedValue(mockUser('u1'))
        ;(appService.get as Mock).mockResolvedValue(app)
        ;(arenaMemberService.getForApp as Mock).mockResolvedValue([])
        const res = await request(makeApp(appRouter, mockUser('u1'))).delete(
            '/api/user/u1/app/a1'
        )
        expect(res.status).toBe(200)
        expect(app.delete).toHaveBeenCalled()
    })
})
