import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

// GET /api/mcp/arenas/:arenaId/logs: the bearer-token log stream the VS Code
// extension tails. What's under test is the gate — token → user → ownership —
// and that an authorized client gets the same replay-then-live SSE stream the
// cookie route serves.

vi.mock('../src/util/db', () => ({ default: { query: vi.fn() } }));
vi.mock('../src/services/OAuthService', () => ({
  default: { getToken: vi.fn() },
}));
vi.mock('../src/services/UserService', () => ({ default: { get: vi.fn() } }));
vi.mock('../src/services/ArenaService', () => ({ default: { get: vi.fn() } }));
vi.mock('../src/services/EnvironmentService', () => ({
  default: { get: vi.fn() },
}));

import mcpApp from '../src/api/mcp';
import oauthService from '../src/services/OAuthService';
import userService from '../src/services/UserService';
import arenaService from '../src/services/ArenaService';
import environmentService from '../src/services/EnvironmentService';

const ARENA = '11111111-1111-4111-8111-111111111111';
const OWNER = 'owner-id';

const mocked = <T>(fn: T) => fn as unknown as ReturnType<typeof vi.fn>;

let server: Server;
let base: string;

beforeEach(async () => {
  vi.clearAllMocks();
  // Any presented token is valid and names OWNER; the user record resolves.
  mocked(oauthService.getToken).mockResolvedValue({
    userId: OWNER,
    clientId: 'client',
    scopes: ['robocode'],
    expiresAt: new Date(Date.now() + 3600_000),
  });
  mocked(userService.get).mockImplementation(async (id: string) => ({
    getId: () => id,
  }));
  server = mcpApp.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(() => {
  server.close();
});

const get = (path: string, token?: string, signal?: AbortSignal) =>
  fetch(base + path, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
    signal,
  });

describe('GET /api/mcp/arenas/:arenaId/logs', () => {
  it('requires a bearer token', async () => {
    const res = await get(`/api/mcp/arenas/${ARENA}/logs`);
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toMatch(/resource_metadata=/);
  });

  it('rejects a malformed arena id before any lookup', async () => {
    const res = await get('/api/mcp/arenas/not-a-uuid/logs', 'tok');
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('E028');
    expect(arenaService.get).not.toHaveBeenCalled();
  });

  it("refuses another user's arena", async () => {
    mocked(arenaService.get).mockResolvedValue({
      getId: () => ARENA,
      getUserId: () => 'someone-else',
    });
    const res = await get(`/api/mcp/arenas/${ARENA}/logs`, 'tok');
    expect(res.status).toBe(404);
    expect(environmentService.get).not.toHaveBeenCalled();
  });

  it('replays the buffer, then streams live entries, then detaches', async () => {
    mocked(arenaService.get).mockResolvedValue({
      getId: () => ARENA,
      getUserId: () => OWNER,
    });
    const env = Object.assign(new EventEmitter(), {
      getRecentLogs: () => [{ id: 1, msg: 'buffered' }],
    });
    mocked(environmentService.get).mockResolvedValue(env);

    const abort = new AbortController();
    const res = await get(`/api/mcp/arenas/${ARENA}/logs`, 'tok', abort.signal);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/text\/event-stream/);

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let text = '';
    const readUntil = async (needle: string) => {
      while (!text.includes(needle)) {
        const { value, done } = await reader.read();
        if (done) throw new Error('stream ended early');
        text += decoder.decode(value, { stream: true });
      }
    };

    await readUntil('buffered');
    env.emit('log', { id: 2, msg: 'live' });
    await readUntil('live');
    expect(env.listenerCount('log')).toBe(1);

    abort.abort();
    await reader.cancel().catch(() => undefined);
    await vi.waitFor(() => expect(env.listenerCount('log')).toBe(0));
  });
});
