import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import bodyParser from 'body-parser';
import cookieParser from 'cookie-parser';
import request from 'supertest';

// Mock the data-access singletons so the Express handlers can be tested in
// isolation — no Postgres, no isolates. (Mocking the services also means their
// real modules, which import util/db and the simulation engine, never load.)
vi.mock('../src/services/UserService', () => ({ default: { get: vi.fn() } }));
vi.mock('../src/services/AppService', () => ({
  default: { get: vi.fn(), getForUser: vi.fn(), create: vi.fn() },
}));
vi.mock('../src/services/ArenaService', () => ({
  default: {
    getForUser: vi.fn(),
    getDefaultForUser: vi.fn(),
    get: vi.fn(),
    create: vi.fn(),
    delete: vi.fn(),
  },
}));
vi.mock('../src/services/ArenaMemberService', () => ({
  default: {
    getForApp: vi.fn(),
    getForArena: vi.fn(),
    create: vi.fn(),
    deleteForArena: vi.fn(),
  },
}));
vi.mock('../src/services/EnvironmentService', () => ({
  default: {
    getByArenaId: vi.fn(),
    has: vi.fn(),
    get: vi.fn(),
    dispose: vi.fn(),
  },
}));

import userService from '../src/services/UserService';
import appService from '../src/services/AppService';
import arenaService from '../src/services/ArenaService';
import arenaMemberService from '../src/services/ArenaMemberService';
import environmentService from '../src/services/EnvironmentService';
import healthRouter from '../src/api/health';
import userRouter from '../src/api/user';
import appRouter from '../src/api/app';
import arenaRouter from '../src/api/arena';

// Build an Express app around a router, injecting an authenticated user the way
// the real auth middleware would (the routers read req.user for ownership checks).
function makeApp(
  router: express.Express,
  authedUser?: { getId: () => string }
) {
  const app = express();
  app.use(bodyParser.json());
  app.use(bodyParser.raw({ type: 'application/octet-stream' }));
  app.use(cookieParser());
  app.use((req, _res, next) => {
    if (authedUser) (req as unknown as { user: unknown }).user = authedUser;
    next();
  });
  app.use(router);
  return app;
}

const mockUser = (id: string) => ({
  getId: () => id,
  getName: () => `User ${id}`,
  getPicture: () => 'pic.png',
});
const mockApp = (id: string) => ({
  getId: () => id,
  getName: () => `App ${id}`,
  getUserId: () => 'u1',
  getSource: () => '// bot code',
  delete: vi.fn().mockResolvedValue(undefined),
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /health', () => {
  it('returns ok', async () => {
    const res = await request(makeApp(healthRouter)).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });
});

describe('user endpoints', () => {
  it('GET /api/user returns the authenticated user with their apps', async () => {
    vi.mocked(appService.getForUser).mockResolvedValue([
      mockApp('a1'),
    ] as never);
    const res = await request(makeApp(userRouter, mockUser('u1'))).get(
      '/api/user'
    );
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id: 'u1',
      apps: [{ id: 'a1', name: 'App a1' }],
    });
  });

  it('GET /api/user without a session is unauthorized', async () => {
    const res = await request(makeApp(userRouter)).get('/api/user');
    expect(res.status).toBe(401);
  });

  it('GET /api/user/:userId returns 404 for an unknown user', async () => {
    vi.mocked(userService.get).mockResolvedValue(undefined);
    const res = await request(makeApp(userRouter)).get('/api/user/nope');
    expect(res.status).toBe(404);
  });

  it('GET /api/user/:userId returns the user when found', async () => {
    vi.mocked(userService.get).mockResolvedValue(mockUser('u1') as never);
    vi.mocked(appService.getForUser).mockResolvedValue([]);
    const res = await request(makeApp(userRouter)).get('/api/user/u1');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: 'u1', apps: [] });
  });
});

describe('app endpoints', () => {
  it('GET /api/user/:userId/apps lists the user apps', async () => {
    vi.mocked(userService.get).mockResolvedValue(mockUser('u1') as never);
    vi.mocked(appService.getForUser).mockResolvedValue([
      mockApp('a1'),
      mockApp('a2'),
    ] as never);
    const res = await request(makeApp(appRouter)).get('/api/user/u1/apps');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      { id: 'a1', name: 'App a1' },
      { id: 'a2', name: 'App a2' },
    ]);
  });

  it('GET /api/user/:userId/apps returns 404 for an unknown user', async () => {
    vi.mocked(userService.get).mockResolvedValue(undefined);
    const res = await request(makeApp(appRouter)).get('/api/user/u1/apps');
    expect(res.status).toBe(404);
  });

  it('POST /api/user/:userId/app creates an app for the owner', async () => {
    vi.mocked(userService.get).mockResolvedValue(mockUser('u1') as never);
    vi.mocked(appService.create).mockResolvedValue(mockApp('a9') as never);
    const res = await request(makeApp(appRouter, mockUser('u1'))).post(
      '/api/user/u1/app/'
    );
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ appId: 'a9' });
    expect(appService.create).toHaveBeenCalledWith('u1');
  });

  it('POST /api/user/:userId/app is forbidden for a different user', async () => {
    vi.mocked(userService.get).mockResolvedValue(mockUser('u1') as never);
    const res = await request(
      makeApp(appRouter, mockUser('someone-else'))
    ).post('/api/user/u1/app/');
    expect(res.status).toBe(401);
    expect(appService.create).not.toHaveBeenCalled();
  });

  it('POST /api/user/:userId/app returns 404 for an unknown user', async () => {
    vi.mocked(userService.get).mockResolvedValue(undefined);
    const res = await request(makeApp(appRouter, mockUser('u1'))).post(
      '/api/user/u1/app/'
    );
    expect(res.status).toBe(404);
  });

  it('GET /api/user/:userId/app/:appId returns 404 for an unknown user', async () => {
    vi.mocked(userService.get).mockResolvedValue(undefined);
    const res = await request(makeApp(appRouter)).get('/api/user/u1/app/a1');
    expect(res.status).toBe(404);
  });

  it('GET /api/user/:userId/app/:appId returns the app when found', async () => {
    vi.mocked(userService.get).mockResolvedValue(mockUser('u1') as never);
    vi.mocked(appService.get).mockResolvedValue(mockApp('a1') as never);
    const res = await request(makeApp(appRouter)).get('/api/user/u1/app/a1');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: 'a1', name: 'App a1' });
  });

  it('GET /api/user/:userId/app/:appId/source returns the source to the owner', async () => {
    vi.mocked(userService.get).mockResolvedValue(mockUser('u1') as never);
    vi.mocked(appService.get).mockResolvedValue(mockApp('a1') as never);
    const res = await request(makeApp(appRouter, mockUser('u1'))).get(
      '/api/user/u1/app/a1/source'
    );
    expect(res.status).toBe(200);
    expect(res.text).toBe('// bot code');
  });

  it('GET /api/user/:userId/app/:appId/source returns 404 for an unknown app', async () => {
    vi.mocked(userService.get).mockResolvedValue(mockUser('u1') as never);
    vi.mocked(appService.get).mockResolvedValue(undefined);
    const res = await request(makeApp(appRouter, mockUser('u1'))).get(
      '/api/user/u1/app/missing/source'
    );
    expect(res.status).toBe(404);
  });

  it('DELETE /api/user/:userId/app/:appId removes the app for the owner', async () => {
    const app = mockApp('a1');
    vi.mocked(userService.get).mockResolvedValue(mockUser('u1') as never);
    vi.mocked(appService.get).mockResolvedValue(app as never);
    vi.mocked(arenaMemberService.getForApp).mockResolvedValue([]);
    const res = await request(makeApp(appRouter, mockUser('u1'))).delete(
      '/api/user/u1/app/a1'
    );
    expect(res.status).toBe(200);
    expect(app.delete).toHaveBeenCalled();
  });

  it('POST /api/user/:userId/app/:appId/reboot reboots the app in running arenas', async () => {
    const reboot = vi.fn().mockResolvedValue(undefined);
    vi.mocked(userService.get).mockResolvedValue(mockUser('u1') as never);
    vi.mocked(appService.get).mockResolvedValue(mockApp('a1') as never);
    vi.mocked(arenaService.getForUser).mockResolvedValue([
      { getId: () => 'ar1' },
    ] as never);
    vi.mocked(environmentService.has).mockReturnValue(true as never);
    vi.mocked(environmentService.get).mockResolvedValue({ reboot } as never);

    const res = await request(makeApp(appRouter, mockUser('u1'))).post(
      '/api/user/u1/app/a1/reboot'
    );
    expect(res.status).toBe(200);
    expect(reboot).toHaveBeenCalledWith('a1');
  });

  it('POST /api/user/:userId/app/:appId/reboot is forbidden for a non-owner', async () => {
    vi.mocked(userService.get).mockResolvedValue(mockUser('u1') as never);
    vi.mocked(appService.get).mockResolvedValue(mockApp('a1') as never);
    const res = await request(
      makeApp(appRouter, mockUser('someone-else'))
    ).post('/api/user/u1/app/a1/reboot');
    expect(res.status).toBe(401);
  });
});

describe('arena endpoints', () => {
  it('PUT /api/user/:userId/arena/app/:appId rejects once the arena is full', async () => {
    vi.mocked(userService.get).mockResolvedValue(mockUser('u1') as never);
    vi.mocked(appService.get).mockResolvedValue(mockApp('a1') as never);
    vi.mocked(arenaService.getDefaultForUser).mockResolvedValue({
      getId: () => 'ar1',
    } as never);
    // already at the 5-app limit
    vi.mocked(arenaMemberService.getForArena).mockResolvedValue([
      1, 2, 3, 4, 5,
    ] as never);

    const res = await request(makeApp(arenaRouter, mockUser('u1'))).put(
      '/api/user/u1/arena/app/a1'
    );
    expect(res.status).toBe(400);
    expect(environmentService.get).not.toHaveBeenCalled();
  });

  it('PUT /api/user/:userId/arena/app/:appId adds an app when under the limit', async () => {
    const addApp = vi.fn();
    vi.mocked(userService.get).mockResolvedValue(mockUser('u1') as never);
    vi.mocked(appService.get).mockResolvedValue(mockApp('a1') as never);
    vi.mocked(arenaService.getDefaultForUser).mockResolvedValue({
      getId: () => 'ar1',
    } as never);
    vi.mocked(arenaMemberService.getForArena).mockResolvedValue([]);
    vi.mocked(environmentService.get).mockResolvedValue({ addApp } as never);
    vi.mocked(arenaMemberService.create).mockResolvedValue(undefined as never);

    const res = await request(makeApp(arenaRouter, mockUser('u1'))).put(
      '/api/user/u1/arena/app/a1'
    );
    expect(res.status).toBe(201);
    expect(addApp).toHaveBeenCalled();
  });

  it('POST /api/user/:userId/arena/speed sets a numeric speed multiplier', async () => {
    const setSpeed = vi.fn();
    vi.mocked(userService.get).mockResolvedValue(mockUser('u1') as never);
    vi.mocked(arenaService.getDefaultForUser).mockResolvedValue({
      getId: () => 'ar1',
    } as never);
    vi.mocked(environmentService.get).mockResolvedValue({ setSpeed } as never);

    const res = await request(makeApp(arenaRouter, mockUser('u1')))
      .post('/api/user/u1/arena/speed')
      .send({ speed: 4 });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ speed: 4 });
    expect(setSpeed).toHaveBeenCalledWith(4);
  });

  it('POST /api/user/:userId/arena/speed accepts "max" as unbounded (0)', async () => {
    const setSpeed = vi.fn();
    vi.mocked(userService.get).mockResolvedValue(mockUser('u1') as never);
    vi.mocked(arenaService.getDefaultForUser).mockResolvedValue({
      getId: () => 'ar1',
    } as never);
    vi.mocked(environmentService.get).mockResolvedValue({ setSpeed } as never);

    const res = await request(makeApp(arenaRouter, mockUser('u1')))
      .post('/api/user/u1/arena/speed')
      .send({ speed: 'max' });
    expect(res.status).toBe(200);
    expect(setSpeed).toHaveBeenCalledWith(0);
  });

  it('POST /api/user/:userId/arena/speed rejects a non-numeric speed', async () => {
    vi.mocked(userService.get).mockResolvedValue(mockUser('u1') as never);
    vi.mocked(arenaService.getDefaultForUser).mockResolvedValue({
      getId: () => 'ar1',
    } as never);

    const res = await request(makeApp(arenaRouter, mockUser('u1')))
      .post('/api/user/u1/arena/speed')
      .send({ speed: 'fast' });
    expect(res.status).toBe(400);
    expect(environmentService.get).not.toHaveBeenCalled();
  });

  it('POST /api/user/:userId/arena/seed sets the arena seed', async () => {
    const setSeed = vi.fn();
    vi.mocked(userService.get).mockResolvedValue(mockUser('u1') as never);
    vi.mocked(arenaService.getDefaultForUser).mockResolvedValue({
      getId: () => 'ar1',
    } as never);
    vi.mocked(environmentService.get).mockResolvedValue({
      setSeed,
      getSeed: () => 99,
    } as never);

    const res = await request(makeApp(arenaRouter, mockUser('u1')))
      .post('/api/user/u1/arena/seed')
      .send({ seed: 99 });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ seed: 99 });
    expect(setSeed).toHaveBeenCalledWith(99);
  });

  it('POST /api/user/:userId/arena/seed rejects a non-numeric seed', async () => {
    vi.mocked(userService.get).mockResolvedValue(mockUser('u1') as never);
    vi.mocked(arenaService.getDefaultForUser).mockResolvedValue({
      getId: () => 'ar1',
    } as never);

    const res = await request(makeApp(arenaRouter, mockUser('u1')))
      .post('/api/user/u1/arena/seed')
      .send({ seed: 'abc' });
    expect(res.status).toBe(400);
    expect(environmentService.get).not.toHaveBeenCalled();
  });
});

describe('multi-arena endpoints', () => {
  beforeEach(() => {
    vi.mocked(userService.get).mockResolvedValue(mockUser('u1') as never);
  });

  it('GET /api/user/:userId/arenas lists the user’s arenas', async () => {
    vi.mocked(arenaService.getForUser).mockResolvedValue([
      { getId: () => 'ar1' },
      { getId: () => 'ar2' },
    ] as never);

    const res = await request(makeApp(arenaRouter, mockUser('u1'))).get(
      '/api/user/u1/arenas'
    );
    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ id: 'ar1' }, { id: 'ar2' }]);
  });

  it('POST /api/user/:userId/arenas creates an arena under the limit', async () => {
    vi.mocked(arenaService.getForUser).mockResolvedValue([] as never);
    vi.mocked(arenaService.create).mockResolvedValue({
      getId: () => 'ar9',
    } as never);

    const res = await request(makeApp(arenaRouter, mockUser('u1'))).post(
      '/api/user/u1/arenas'
    );
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ id: 'ar9' });
  });

  it('POST /api/user/:userId/arenas rejects at the 10-arena limit', async () => {
    vi.mocked(arenaService.getForUser).mockResolvedValue(
      Array.from({ length: 10 }, (_, i) => ({ getId: () => `ar${i}` })) as never
    );

    const res = await request(makeApp(arenaRouter, mockUser('u1'))).post(
      '/api/user/u1/arenas'
    );
    expect(res.status).toBe(400);
    expect(arenaService.create).not.toHaveBeenCalled();
  });

  it('POST /api/user/:userId/arenas/:arenaId/restart targets that arena', async () => {
    const restart = vi.fn().mockResolvedValue(undefined);
    vi.mocked(arenaService.get).mockResolvedValue({
      getId: () => 'ar2',
      getUserId: () => 'u1',
    } as never);
    vi.mocked(environmentService.get).mockResolvedValue({ restart } as never);

    const res = await request(makeApp(arenaRouter, mockUser('u1'))).post(
      '/api/user/u1/arenas/ar2/restart'
    );
    expect(res.status).toBe(200);
    expect(arenaService.get).toHaveBeenCalledWith('ar2');
    expect(arenaService.getDefaultForUser).not.toHaveBeenCalled();
    expect(restart).toHaveBeenCalled();
  });

  it('rejects addressing an arena owned by another user with 404', async () => {
    vi.mocked(arenaService.get).mockResolvedValue({
      getId: () => 'ar2',
      getUserId: () => 'someone-else',
    } as never);

    const res = await request(makeApp(arenaRouter, mockUser('u1'))).post(
      '/api/user/u1/arenas/ar2/restart'
    );
    expect(res.status).toBe(404);
    expect(environmentService.get).not.toHaveBeenCalled();
  });

  it('DELETE /api/user/:userId/arenas/:arenaId tears down the arena', async () => {
    vi.mocked(arenaService.get).mockResolvedValue({
      getId: () => 'ar2',
      getUserId: () => 'u1',
    } as never);
    vi.mocked(environmentService.dispose).mockResolvedValue(undefined as never);
    vi.mocked(arenaMemberService.deleteForArena).mockResolvedValue(
      undefined as never
    );
    vi.mocked(arenaService.delete).mockResolvedValue(undefined as never);

    const res = await request(makeApp(arenaRouter, mockUser('u1'))).delete(
      '/api/user/u1/arenas/ar2'
    );
    expect(res.status).toBe(200);
    expect(environmentService.dispose).toHaveBeenCalledWith('ar2');
    expect(arenaMemberService.deleteForArena).toHaveBeenCalledWith('ar2');
    expect(arenaService.delete).toHaveBeenCalledWith('ar2');
  });
});

// The API route handlers are async and contain no try/catch: they rely on
// Express 5 forwarding a rejected handler promise to the error-handling
// middleware automatically. Express 4 did NOT do this (the request would hang),
// so the catch-all 500 handler in src/index.ts only works because of the v5
// upgrade. Lock that behavior in.
describe('Express 5 async error forwarding', () => {
  it('routes a rejected async handler to the error handler as 500', async () => {
    const app = express();
    app.get('/boom', async () => {
      throw new Error('async failure');
    });
    // Mirrors the catch-all error handler in src/index.ts.
    app.use(
      (
        err: Error,
        req: express.Request,
        res: express.Response,
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        _next: express.NextFunction
      ) => {
        if (!res.headersSent) res.status(500).send('Internal server error');
      }
    );

    const res = await request(app).get('/boom');
    expect(res.status).toBe(500);
    expect(res.text).toBe('Internal server error');
  });
});
