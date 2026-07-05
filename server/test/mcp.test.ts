import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

// Stub the pg pool so transitively-imported services (via middleware/auth)
// don't try to open a real database connection at import time.
vi.mock('../src/util/db', () => ({ default: { query: vi.fn() } }));

// Mock the data/runtime layer so the tools can be driven in isolation; the MCP
// glue (ownership checks, arena resolution, result shaping) is what's under test.
vi.mock('../src/services/AppService', () => ({
  default: { getForUser: vi.fn(), get: vi.fn(), create: vi.fn() },
}));
vi.mock('../src/services/ArenaService', () => ({
  default: {
    get: vi.fn(),
    getForUser: vi.fn(),
    getDefaultForUser: vi.fn(),
    create: vi.fn(),
    delete: vi.fn(),
  },
}));
vi.mock('../src/services/ArenaMemberService', () => ({
  default: { getForArena: vi.fn(), create: vi.fn(), deleteForArena: vi.fn() },
}));
vi.mock('../src/services/EnvironmentService', () => ({
  default: {
    get: vi.fn(),
    getByArenaId: vi.fn(),
    has: vi.fn(),
    dispose: vi.fn(),
  },
}));
vi.mock('../src/util/botActions', () => ({
  propagateSource: vi.fn().mockResolvedValue(undefined),
  executeInUserArenas: vi.fn().mockResolvedValue(undefined),
  rebootInUserArenas: vi.fn().mockResolvedValue(undefined),
  deleteAppEverywhere: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../src/util/arenaStatus', () => ({ buildArenaStatus: vi.fn() }));

import { buildServer } from '../src/api/mcp';
import appService from '../src/services/AppService';
import arenaService from '../src/services/ArenaService';
import arenaMemberService from '../src/services/ArenaMemberService';
import environmentService from '../src/services/EnvironmentService';
import { propagateSource } from '../src/util/botActions';
import { buildArenaStatus } from '../src/util/arenaStatus';

const user = { getId: () => 'u1' } as never;

const connect = async () => {
  const server = buildServer(user);
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  await server.connect(serverT);
  const client = new Client({ name: 'test', version: '1' });
  await client.connect(clientT);
  return client;
};

// Tool results are an array of content parts; ours are a single JSON/text part.
const textOf = (res: { content: unknown[] }) =>
  (res.content[0] as { text: string }).text;

beforeEach(() => vi.clearAllMocks());

describe('mcp tools', () => {
  it('list_bots returns the user apps', async () => {
    vi.mocked(appService.getForUser).mockResolvedValue([
      { getId: () => 'a1', getName: () => 'Bot' },
    ] as never);
    const client = await connect();
    const res = (await client.callTool({
      name: 'list_bots',
      arguments: {},
    })) as never;

    expect(JSON.parse(textOf(res))).toEqual([{ id: 'a1', name: 'Bot' }]);
  });

  it('get_bot_source returns source for an owned bot', async () => {
    vi.mocked(appService.get).mockResolvedValue({
      getUserId: () => 'u1',
      getSource: () => 'CODE',
    } as never);
    const client = await connect();
    const res = (await client.callTool({
      name: 'get_bot_source',
      arguments: { appId: 'a1' },
    })) as { content: unknown[]; isError?: boolean };

    expect(res.isError).toBeFalsy();
    expect(textOf(res)).toBe('CODE');
  });

  it('rejects a bot owned by another user (ownership enforced)', async () => {
    vi.mocked(appService.get).mockResolvedValue({
      getUserId: () => 'someone-else',
      getSource: () => 'SECRET',
    } as never);
    const client = await connect();
    const res = (await client.callTool({
      name: 'get_bot_source',
      arguments: { appId: 'a1' },
    })) as { content: unknown[]; isError?: boolean };

    expect(res.isError).toBe(true);
    expect(textOf(res)).not.toContain('SECRET');
  });

  it('set_bot_source persists + propagates via the shared helper', async () => {
    const app = { getId: () => 'a1', getUserId: () => 'u1' };
    vi.mocked(appService.get).mockResolvedValue(app as never);
    const client = await connect();
    await client.callTool({
      name: 'set_bot_source',
      arguments: { appId: 'a1', source: 'NEW' },
    });

    expect(propagateSource).toHaveBeenCalledWith(app, 'NEW');
  });

  it('arena_status resolves the default arena and returns the snapshot', async () => {
    const arena = { getId: () => 'ar1', getUserId: () => 'u1' };
    vi.mocked(arenaService.getDefaultForUser).mockResolvedValue(arena as never);
    vi.mocked(arenaMemberService.getForArena).mockResolvedValue([] as never);
    vi.mocked(buildArenaStatus).mockResolvedValue({ running: true } as never);
    const client = await connect();
    const res = (await client.callTool({
      name: 'arena_status',
      arguments: {},
    })) as never;

    expect(arenaService.getDefaultForUser).toHaveBeenCalledWith('u1');
    expect(JSON.parse(textOf(res))).toEqual({ running: true });
  });

  it('set_arena_speed sets the speed on the resolved arena env', async () => {
    const arena = { getId: () => 'ar1', getUserId: () => 'u1' };
    vi.mocked(arenaService.getDefaultForUser).mockResolvedValue(arena as never);
    const env = { setSpeed: vi.fn(), getSpeed: () => 4, getTickMs: () => 25 };
    vi.mocked(environmentService.get).mockResolvedValue(env as never);
    const client = await connect();
    const res = (await client.callTool({
      name: 'set_arena_speed',
      arguments: { speed: 4 },
    })) as never;

    expect(env.setSpeed).toHaveBeenCalledWith(4);
    expect(JSON.parse(textOf(res))).toEqual({
      arenaId: 'ar1',
      speed: 4,
      tickMs: 25,
    });
  });

  it('set_arena_speed maps "max" to unbounded (0)', async () => {
    const arena = { getId: () => 'ar1', getUserId: () => 'u1' };
    vi.mocked(arenaService.getDefaultForUser).mockResolvedValue(arena as never);
    const env = { setSpeed: vi.fn(), getSpeed: () => 0, getTickMs: () => 0 };
    vi.mocked(environmentService.get).mockResolvedValue(env as never);
    const client = await connect();
    await client.callTool({
      name: 'set_arena_speed',
      arguments: { speed: 'max' },
    });

    expect(env.setSpeed).toHaveBeenCalledWith(0);
  });

  it('set_arena_seed sets the seed on the resolved arena env', async () => {
    const arena = { getId: () => 'ar1', getUserId: () => 'u1' };
    vi.mocked(arenaService.getDefaultForUser).mockResolvedValue(arena as never);
    const env = { setSeed: vi.fn(), getSeed: () => 99 };
    vi.mocked(environmentService.get).mockResolvedValue(env as never);
    const client = await connect();
    const res = (await client.callTool({
      name: 'set_arena_seed',
      arguments: { seed: 99 },
    })) as never;

    expect(env.setSeed).toHaveBeenCalledWith(99);
    expect(JSON.parse(textOf(res))).toEqual({ arenaId: 'ar1', seed: 99 });
  });

  it('exposes reference resources (type definitions + doc/sample templates)', async () => {
    const client = await connect();

    // The type definitions are a fixed resource, so they list regardless of the
    // filesystem (the doc/sample lists are filesystem-backed and may be empty
    // when running from source).
    const resources = await client.listResources();
    expect(resources.resources.map((r) => r.uri)).toContain(
      'robocodejs://types/robocode.d.ts'
    );

    // Docs and samples are exposed as templates the client can enumerate/read.
    const templates = await client.listResourceTemplates();
    const uriTemplates = templates.resourceTemplates.map((t) => t.uriTemplate);
    expect(uriTemplates).toContain('robocodejs://docs/{slug}');
    expect(uriTemplates).toContain('robocodejs://samples/{name}');
  });

  it('exposes workflow prompts and fills in arguments', async () => {
    const client = await connect();

    const prompts = await client.listPrompts();
    expect(prompts.prompts.map((p) => p.name)).toEqual(
      expect.arrayContaining(['write_bot', 'debug_bot', 'run_match'])
    );

    const filled = await client.getPrompt({
      name: 'write_bot',
      arguments: { goal: 'circle and snipe' },
    });
    const text = (filled.messages[0].content as { text: string }).text;
    expect(text).toContain('circle and snipe');
    // It should steer the model to the API docs resource.
    expect(text).toContain('robocodejs://docs/dev');
  });
});
