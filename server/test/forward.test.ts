import {
  describe,
  it,
  expect,
  vi,
  beforeAll,
  afterAll,
  beforeEach,
} from 'vitest';
import express, { Request, Response } from 'express';
import http from 'node:http';
import { AddressInfo } from 'node:net';
import zlib from 'node:zlib';

// Request forwarding to a user's home instance (GitHub #444, phase 3). Two
// real Express servers on ephemeral ports, an edge and a home, so the
// proxying, signing and streaming run for real. The lease lookups are
// injected; HomeService and ArenaService are mocked only so importing the
// module doesn't load the database.
vi.mock('../src/services/HomeService', () => ({ default: {} }));
vi.mock('../src/services/ArenaService', () => ({ default: {} }));

import { createForwarding, routingKey, sign } from '../src/middleware/forward';
import { isForwarded, forwardMetrics } from '../src/util/forwarded';
import type { Home } from '../src/services/HomeService';

const SECRET = 'test-secret';
const USER = '11111111-1111-1111-1111-111111111111';
const ARENA = '22222222-2222-2222-2222-222222222222';

const listen = (app: express.Express): Promise<http.Server> =>
  new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
const urlOf = (server: http.Server) =>
  `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

const local = (userId: string): Home => ({
  userId,
  instanceId: 'self',
  address: 'unused',
  epoch: 1,
  local: true,
});
const remote = (userId: string, address: string): Home => ({
  userId,
  instanceId: 'other',
  address,
  epoch: 1,
  local: false,
});

const fakeHomes = () => ({
  resolve: vi.fn(),
  forget: vi.fn(),
  claim: vi.fn(),
});

// The routes a home serves, recording what it saw.
const seen: { ip?: string; forwarded?: boolean; body?: unknown }[] = [];
let sseClosed = false;
const routes = (app: express.Express, name: string) => {
  app.use(express.json());
  app.get('/api/user/:userId/arena', (req, res) => {
    seen.push({ ip: req.ip, forwarded: isForwarded(req) });
    res.setHeader('x-served-by', name);
    res.json({ servedBy: name });
  });
  app.post('/api/user/:userId/app', (req, res) => {
    seen.push({ body: req.body, forwarded: isForwarded(req) });
    res.status(201).json({ servedBy: name, got: req.body });
  });
  app.get('/api/user/:userId/arena/events', (req: Request, res: Response) => {
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'content-encoding': 'gzip',
    });
    const gzip = zlib.createGzip();
    gzip.pipe(res);
    const write = (data: string) => {
      gzip.write(`data: ${data}\n\n`);
      gzip.flush(zlib.constants.Z_SYNC_FLUSH);
    };
    write('first');
    const timer = setTimeout(() => write('second'), 150);
    req.on('close', () => {
      clearTimeout(timer);
      sseClosed = true;
    });
  });
};

let homeServer: http.Server;
const homeHomes = fakeHomes();
let edgeServer: http.Server;
const edgeHomes = fakeHomes();

beforeAll(async () => {
  const home = express();
  const homeFwd = createForwarding({
    secret: SECRET,
    identity: async () => ({ id: 'home', address: 'unused' }),
    homes: homeHomes,
    ownerOf: async () => USER,
  });
  home.use(homeFwd.acceptForwarded, homeFwd.forwardToHome);
  routes(home, 'home');
  homeServer = await listen(home);

  const edge = express();
  const edgeFwd = createForwarding({
    secret: SECRET,
    identity: async () => ({ id: 'edge', address: 'unused' }),
    homes: edgeHomes,
    ownerOf: async () => USER,
  });
  edge.use(edgeFwd.acceptForwarded, edgeFwd.forwardToHome);
  routes(edge, 'edge');
  edgeServer = await listen(edge);
});

afterAll(() => {
  homeServer.close();
  edgeServer.close();
});

beforeEach(() => {
  vi.clearAllMocks();
  seen.length = 0;
  sseClosed = false;
  homeHomes.resolve.mockImplementation(async (u: string) => local(u));
  edgeHomes.resolve.mockImplementation(async (u: string) =>
    remote(u, urlOf(homeServer))
  );
});

const edgeUrl = (path: string) => `${urlOf(edgeServer)}${path}`;

describe('forwardToHome', () => {
  it("proxies a user's request to their home, which sees the client IP", async () => {
    const res = await fetch(edgeUrl(`/api/user/${USER}/arena`));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ servedBy: 'home' });
    expect(res.headers.get('x-served-by')).toBe('home');
    // The home trusted the signed client IP and knows it was forwarded.
    expect(seen).toEqual([{ ip: '127.0.0.1', forwarded: true }]);
  });

  it('forwards a request body intact', async () => {
    const res = await fetch(edgeUrl(`/api/user/${USER}/app`), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Bot' }),
    });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({
      servedBy: 'home',
      got: { name: 'Bot' },
    });
  });

  it('streams an SSE response event by event, still gzipped', async () => {
    const chunks: string[] = [];
    await new Promise<void>((resolve, reject) => {
      http
        .get(edgeUrl(`/api/user/${USER}/arena/events`), (res) => {
          expect(res.headers['content-encoding']).toBe('gzip');
          const gunzip = zlib.createGunzip();
          res.pipe(gunzip);
          gunzip.on('data', (d: Buffer) => {
            chunks.push(d.toString());
            // The first event arrives before the home has written the second:
            // nothing on the way buffered it.
            if (chunks.length === 1) {
              expect(chunks[0]).toContain('first');
            }
            if (chunks.join('').includes('second')) {
              res.destroy();
              resolve();
            }
          });
        })
        .on('error', reject);
    });
    expect(chunks[0]).not.toContain('second');
  });

  it('closes the upstream stream when the client goes away', async () => {
    await new Promise<void>((resolve) => {
      const req = http.get(edgeUrl(`/api/user/${USER}/arena/events`), (res) => {
        res.once('data', () => {
          req.destroy();
          resolve();
        });
      });
    });
    await vi.waitFor(() => expect(sseClosed).toBe(true));
  });

  it('serves locally when the user is homed here', async () => {
    edgeHomes.resolve.mockImplementation(async (u: string) => local(u));
    const res = await fetch(edgeUrl(`/api/user/${USER}/arena`));
    expect(await res.json()).toEqual({ servedBy: 'edge' });
    expect(seen).toEqual([{ ip: '127.0.0.1', forwarded: false }]);
  });

  it('serves locally when the database cannot say where the home is', async () => {
    edgeHomes.resolve.mockResolvedValue(null);
    const res = await fetch(edgeUrl(`/api/user/${USER}/arena`));
    expect(await res.json()).toEqual({ servedBy: 'edge' });
  });

  it('serves requests with no routing key locally', async () => {
    const app = express();
    const fwd = createForwarding({ secret: SECRET, homes: edgeHomes });
    app.use(fwd.forwardToHome);
    app.get('/api/leaderboard', (_req, res) => res.json({ local: true }));
    const server = await listen(app);
    const res = await fetch(`${urlOf(server)}/api/leaderboard`);
    expect(await res.json()).toEqual({ local: true });
    expect(edgeHomes.resolve).not.toHaveBeenCalled();
    server.close();
  });

  it('never forwards without a secret', async () => {
    const app = express();
    const fwd = createForwarding({ secret: '', homes: edgeHomes });
    app.use(fwd.acceptForwarded, fwd.forwardToHome);
    routes(app, 'unsigned');
    const server = await listen(app);
    const res = await fetch(`${urlOf(server)}/api/user/${USER}/arena`);
    expect(await res.json()).toEqual({ servedBy: 'unsigned' });
    expect(edgeHomes.resolve).not.toHaveBeenCalled();
    server.close();
  });

  it('a stale home answers 421; the edge looks again and follows the user', async () => {
    // The home no longer holds the user; on the second look the edge does.
    homeHomes.resolve.mockImplementation(async (u: string) =>
      remote(u, 'http://127.0.0.1:1')
    );
    edgeHomes.resolve
      .mockResolvedValueOnce(remote(USER, urlOf(homeServer)))
      .mockResolvedValueOnce(local(USER));
    const before = forwardMetrics().misdirectedRequests;

    const res = await fetch(edgeUrl(`/api/user/${USER}/arena`));
    expect(await res.json()).toEqual({ servedBy: 'edge' });
    expect(edgeHomes.forget).toHaveBeenCalledWith(USER);
    // The home refused rather than forwarding again.
    expect(forwardMetrics().misdirectedRequests).toBe(before + 1);
  });

  it('a misdirected request is retried once at the new home, body and all', async () => {
    homeHomes.resolve
      .mockResolvedValueOnce(remote(USER, 'http://127.0.0.1:1'))
      .mockResolvedValueOnce(local(USER));
    const res = await fetch(edgeUrl(`/api/user/${USER}/app`), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Again' }),
    });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({
      servedBy: 'home',
      got: { name: 'Again' },
    });
  });

  it('refuses a body larger than any route accepts', async () => {
    const res = await fetch(edgeUrl(`/api/user/${USER}/app`), {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream' },
      body: Buffer.alloc(2 * 1024 * 1024),
    }).catch(() => null);
    // Either a clean 413 or a reset once the edge stops reading; never a
    // forwarded request.
    if (res) expect(res.status).toBe(413);
    expect(seen).toEqual([]);
  });

  describe('home unreachable', () => {
    const dead = 'http://127.0.0.1:1';

    it('takes over an expired home and serves a GET here', async () => {
      edgeHomes.resolve.mockResolvedValue(remote(USER, dead));
      edgeHomes.claim.mockResolvedValue(local(USER));
      const res = await fetch(edgeUrl(`/api/user/${USER}/arena`));
      expect(await res.json()).toEqual({ servedBy: 'edge' });
      expect(edgeHomes.forget).toHaveBeenCalledWith(USER);
    });

    it('answers 503 with Retry-After while the dead home still holds the lease', async () => {
      edgeHomes.resolve.mockResolvedValue(remote(USER, dead));
      edgeHomes.claim.mockResolvedValue(remote(USER, dead));
      const res = await fetch(edgeUrl(`/api/user/${USER}/arena`));
      expect(res.status).toBe(503);
      expect(res.headers.get('retry-after')).toBe('5');
    });

    it('answers 503 for a request whose body was already read, after taking over', async () => {
      edgeHomes.resolve.mockResolvedValue(remote(USER, dead));
      edgeHomes.claim.mockResolvedValue(local(USER));
      const res = await fetch(edgeUrl(`/api/user/${USER}/app`), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      });
      expect(res.status).toBe(503);
      // The retry lands here, since the edge now holds the home.
      expect(edgeHomes.claim).toHaveBeenCalledWith(USER, undefined, false);
    });
  });
});

describe('acceptForwarded', () => {
  const homeGet = (headers: Record<string, string>) =>
    fetch(`${urlOf(homeServer)}/api/user/${USER}/arena`, { headers });
  const signed = (overrides: Partial<Record<string, string>> = {}) => {
    const ts = overrides.ts ?? String(Date.now());
    const parts = {
      method: 'GET',
      url: `/api/user/${USER}/arena`,
      ts,
      from: 'edge',
      ip: '203.0.113.9',
    };
    return {
      'x-robocode-forwarded': 'edge',
      'x-robocode-forward-ts': ts,
      'x-robocode-client-ip': '203.0.113.9',
      'x-robocode-forward-sig': sign(overrides.secret ?? SECRET, parts),
    };
  };

  it('trusts a correctly signed request and its client IP', async () => {
    await homeGet(signed());
    expect(seen).toEqual([{ ip: '203.0.113.9', forwarded: true }]);
  });

  it('ignores a marker signed with the wrong secret', async () => {
    await homeGet(signed({ secret: 'forged' }));
    expect(seen).toEqual([{ ip: '127.0.0.1', forwarded: false }]);
  });

  it('ignores a stale signature', async () => {
    await homeGet(signed({ ts: String(Date.now() - 5 * 60_000) }));
    expect(seen).toEqual([{ ip: '127.0.0.1', forwarded: false }]);
  });

  it('ignores a signature for a different client IP', async () => {
    const headers = signed();
    headers['x-robocode-client-ip'] = '198.51.100.1';
    await homeGet(headers);
    expect(seen[0].forwarded).toBe(false);
  });
});

describe('routingKey', () => {
  const key = (
    path: string,
    ownerOf = async () => USER as string | undefined
  ) => routingKey({ path } as Request, ownerOf);

  it("routes user-scoped routes by the path's user", async () => {
    expect(await key(`/api/user/${USER}/arena`)).toBe(USER);
    expect(await key(`/api/user/${USER}/arenas/${ARENA}/events`)).toBe(USER);
    expect(await key(`/api/user/${USER}/app/${ARENA}/source`)).toBe(USER);
  });

  it('routes public arena routes by the arena owner', async () => {
    const ownerOf = vi.fn(async () => USER);
    expect(await key(`/api/arena/${ARENA}/events`, ownerOf)).toBe(USER);
    expect(await key(`/api/arena/${ARENA}`, ownerOf)).toBe(USER);
    expect(ownerOf).toHaveBeenCalledWith(ARENA);
  });

  it('routes the demo to the demo user', async () => {
    const { DEMO_USER_ID } = await import('../src/types/user');
    expect(await key('/api/demo/events')).toBe(DEMO_USER_ID);
    expect(await key('/api/demo/arena/')).toBe(DEMO_USER_ID);
  });

  it('serves everything else locally', async () => {
    for (const path of [
      '/api/user',
      `/api/user/${USER}`,
      '/api/leaderboard',
      '/api/mcp',
      '/health',
      '/',
      '/api/user/not-a-uuid/arena',
      '/api/arena/not-a-uuid/events',
    ]) {
      expect(await key(path)).toBeUndefined();
    }
  });

  it('serves an unknown arena locally (its 404)', async () => {
    expect(await key(`/api/arena/${ARENA}`, async () => undefined)).toBe(
      undefined
    );
  });
});
