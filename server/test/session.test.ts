import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import bodyParser from 'body-parser'
import request from 'supertest'

// Mock the auth module so session.ts uses a controllable verifier (and the real
// auth.ts — which pulls google-auth-library + services — never loads).
const { verifyGoogleCredential } = vi.hoisted(() => ({
    verifyGoogleCredential: vi.fn(),
}))
vi.mock('../src/middleware/auth', () => ({ verifyGoogleCredential }))

import sessionRouter from '../src/api/session'

function makeApp() {
    const app = express()
    app.use(bodyParser.json())
    app.use(sessionRouter)
    return app
}

const setCookieHeader = (res: { headers: Record<string, unknown> }) =>
    ([] as string[]).concat((res.headers['set-cookie'] as never) || []).join(';')

beforeEach(() => vi.clearAllMocks())

describe('session endpoints', () => {
    it('POST /api/session sets an HttpOnly cookie for a valid credential', async () => {
        verifyGoogleCredential.mockResolvedValue({ sub: 'g1' })
        const res = await request(makeApp())
            .post('/api/session')
            .send({ credential: 'tok' })
        expect(res.status).toBe(200)
        const cookie = setCookieHeader(res)
        expect(cookie).toMatch(/auth=tok/)
        expect(cookie).toMatch(/HttpOnly/i)
        expect(cookie).toMatch(/SameSite=Lax/i)
    })

    it('POST /api/session returns 400 without a credential', async () => {
        const res = await request(makeApp()).post('/api/session').send({})
        expect(res.status).toBe(400)
        expect(verifyGoogleCredential).not.toHaveBeenCalled()
    })

    it('POST /api/session returns 401 for an invalid credential', async () => {
        verifyGoogleCredential.mockResolvedValue(undefined)
        const res = await request(makeApp())
            .post('/api/session')
            .send({ credential: 'bad' })
        expect(res.status).toBe(401)
    })

    it('DELETE /api/session clears the cookie', async () => {
        const res = await request(makeApp()).delete('/api/session')
        expect(res.status).toBe(200)
        expect(setCookieHeader(res)).toMatch(/auth=;/)
    })
})
