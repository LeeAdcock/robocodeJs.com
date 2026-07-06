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
vi.mock('../src/util/matchSummary', () => ({
  buildMatchSummary: vi.fn(),
  buildMatchStatus: vi.fn(),
}));
// Mock the compiler so check_bot_source doesn't spin a real isolate in this suite
// (the real dry-run behaviour is covered in compiler.test.ts).
vi.mock('../src/util/compiler', () => ({ default: { check: vi.fn() } }));

import request from 'supertest';
import mcpApp, { buildServer, logMcpRequest } from '../src/api/mcp';
import { logger, LogEvent } from '../src/util/logger';
import appService from '../src/services/AppService';
import compiler from '../src/util/compiler';
import arenaService from '../src/services/ArenaService';
import arenaMemberService from '../src/services/ArenaMemberService';
import environmentService from '../src/services/EnvironmentService';
import { propagateSource } from '../src/util/botActions';
import { buildArenaStatus } from '../src/util/arenaStatus';
import { buildMatchSummary, buildMatchStatus } from '../src/util/matchSummary';

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

  it('check_bot_source dry-run compiles raw source', async () => {
    vi.mocked(compiler.check).mockResolvedValue({ valid: true } as never);
    const client = await connect();
    const res = (await client.callTool({
      name: 'check_bot_source',
      arguments: { source: 'clock.on(Event.TICK, () => {})' },
    })) as never;

    expect(compiler.check).toHaveBeenCalledWith(
      'clock.on(Event.TICK, () => {})'
    );
    expect(JSON.parse(textOf(res))).toEqual({ valid: true });
  });

  it('check_bot_source reports an invalid bot (still a successful call)', async () => {
    vi.mocked(compiler.check).mockResolvedValue({
      valid: false,
      stage: 'compile',
      errorCode: 'E017',
      message: 'Unexpected token',
      timedOut: false,
    } as never);
    const client = await connect();
    const res = (await client.callTool({
      name: 'check_bot_source',
      arguments: { source: 'function ( {' },
    })) as { content: unknown[]; isError?: boolean };

    expect(res.isError).toBeFalsy();
    expect(JSON.parse(textOf(res)).errorCode).toBe('E017');
  });

  it('check_bot_source resolves a saved bot by appId and enforces ownership', async () => {
    vi.mocked(compiler.check).mockResolvedValue({ valid: true } as never);
    vi.mocked(appService.get).mockResolvedValue({
      getUserId: () => 'u1',
      getSource: () => 'SAVED',
    } as never);
    const client = await connect();
    await client.callTool({
      name: 'check_bot_source',
      arguments: { appId: 'a1' },
    });
    expect(compiler.check).toHaveBeenCalledWith('SAVED');

    // A bot owned by someone else is rejected and never compiled.
    vi.mocked(compiler.check).mockClear();
    vi.mocked(appService.get).mockResolvedValue({
      getUserId: () => 'someone-else',
      getSource: () => 'SECRET',
    } as never);
    const res = (await client.callTool({
      name: 'check_bot_source',
      arguments: { appId: 'a1' },
    })) as { content: unknown[]; isError?: boolean };
    expect(res.isError).toBe(true);
    expect(compiler.check).not.toHaveBeenCalled();
  });

  it('check_bot_source requires source or appId', async () => {
    const client = await connect();
    const res = (await client.callTool({
      name: 'check_bot_source',
      arguments: {},
    })) as { content: unknown[]; isError?: boolean };
    expect(res.isError).toBe(true);
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

  it('match_summary resolves the default arena and returns the summary', async () => {
    const arena = { getId: () => 'ar1', getUserId: () => 'u1' };
    vi.mocked(arenaService.getDefaultForUser).mockResolvedValue(arena as never);
    vi.mocked(arenaMemberService.getForArena).mockResolvedValue([] as never);
    vi.mocked(buildMatchSummary).mockResolvedValue({
      match: { decided: true, winner: { id: 'a1' } },
    } as never);
    const client = await connect();
    const res = (await client.callTool({
      name: 'match_summary',
      arguments: {},
    })) as never;

    expect(arenaService.getDefaultForUser).toHaveBeenCalledWith('u1');
    expect(JSON.parse(textOf(res))).toEqual({
      match: { decided: true, winner: { id: 'a1' } },
    });
  });

  it('match_status resolves the default arena and returns the status', async () => {
    const arena = { getId: () => 'ar1', getUserId: () => 'u1' };
    vi.mocked(arenaService.getDefaultForUser).mockResolvedValue(arena as never);
    vi.mocked(arenaMemberService.getForArena).mockResolvedValue([] as never);
    vi.mocked(buildMatchStatus).mockResolvedValue({
      match: { decided: false, winner: null },
      standings: [],
    } as never);
    const client = await connect();
    const res = (await client.callTool({
      name: 'match_status',
      arguments: {},
    })) as never;

    expect(arenaService.getDefaultForUser).toHaveBeenCalledWith('u1');
    expect(JSON.parse(textOf(res))).toEqual({
      match: { decided: false, winner: null },
      standings: [],
    });
  });

  it('restart_arena restarts then resumes (a reset starts the arena running)', async () => {
    const arena = { getId: () => 'ar1', getUserId: () => 'u1' };
    vi.mocked(arenaService.getDefaultForUser).mockResolvedValue(arena as never);
    const env = {
      restart: vi.fn().mockResolvedValue(undefined),
      resume: vi.fn(),
    };
    vi.mocked(environmentService.get).mockResolvedValue(env as never);
    const client = await connect();
    await client.callTool({ name: 'restart_arena', arguments: {} });
    expect(env.restart).toHaveBeenCalled();
    expect(env.resume).toHaveBeenCalled();
  });

  it('run_match reseeds, restarts+resumes, runs to a decision, and returns the winner', async () => {
    const arena = { getId: () => 'ar1', getUserId: () => 'u1' };
    vi.mocked(arenaService.getDefaultForUser).mockResolvedValue(arena as never);
    vi.mocked(arenaMemberService.getForArena).mockResolvedValue([
      {},
      {},
    ] as never);
    const env = {
      getProcesses: () => [{}, {}],
      setSeed: vi.fn(),
      getSpeed: () => 1,
      setSpeed: vi.fn(),
      restart: vi.fn().mockResolvedValue(undefined),
      resume: vi.fn(),
      pause: vi.fn(),
      isRunning: () => true,
    };
    vi.mocked(environmentService.get).mockResolvedValue(env as never);
    // Already decided on the first read, so the poll loop exits immediately.
    vi.mocked(buildMatchSummary).mockResolvedValue({
      match: { decided: true, winner: { id: 'a1', name: 'Winner' } },
      leaderboard: [{ rank: 1, id: 'a1' }],
    } as never);

    const client = await connect();
    const res = (await client.callTool({
      name: 'run_match',
      arguments: { seed: 42 },
    })) as never;

    expect(env.setSeed).toHaveBeenCalledWith(42);
    expect(env.restart).toHaveBeenCalled();
    expect(env.resume).toHaveBeenCalled(); // restart alone leaves it paused
    expect(env.pause).toHaveBeenCalled(); // paused at the decided state
    const out = JSON.parse(textOf(res));
    expect(out.timedOut).toBe(false);
    expect(out.match.winner.id).toBe('a1');
  });

  it('run_match requires at least two active bots', async () => {
    const arena = { getId: () => 'ar1', getUserId: () => 'u1' };
    vi.mocked(arenaService.getDefaultForUser).mockResolvedValue(arena as never);
    vi.mocked(arenaMemberService.getForArena).mockResolvedValue([{}] as never);
    vi.mocked(environmentService.get).mockResolvedValue({
      getProcesses: () => [{}],
    } as never);
    const client = await connect();
    const res = (await client.callTool({
      name: 'run_match',
      arguments: {},
    })) as { content: unknown[]; isError?: boolean };
    expect(res.isError).toBe(true);
  });

  it('run_tournament runs the seed panel and returns an aggregate ranking', async () => {
    const arena = { getId: () => 'ar1', getUserId: () => 'u1' };
    vi.mocked(arenaService.getDefaultForUser).mockResolvedValue(arena as never);
    vi.mocked(arenaMemberService.getForArena).mockResolvedValue([
      {},
      {},
    ] as never);
    const env = {
      getProcesses: () => [{}, {}],
      setSeed: vi.fn(),
      getSpeed: () => 1,
      setSpeed: vi.fn(),
      restart: vi.fn().mockResolvedValue(undefined),
      resume: vi.fn(),
      pause: vi.fn(),
      isRunning: () => true,
    };
    vi.mocked(environmentService.get).mockResolvedValue(env as never);
    // a1 wins every match; leaderboard of 2 apps.
    vi.mocked(buildMatchSummary).mockResolvedValue({
      match: { decided: true, winner: { id: 'a1', name: 'Alpha' } },
      leaderboard: [
        { rank: 1, id: 'a1', name: 'Alpha' },
        { rank: 2, id: 'a2', name: 'Beta' },
      ],
    } as never);

    const client = await connect();
    const res = (await client.callTool({
      name: 'run_tournament',
      arguments: { seeds: [1, 2] },
    })) as never;

    const out = JSON.parse(textOf(res));
    expect(out.matchCount).toBe(2);
    expect(out.seeds).toEqual([1, 2]);
    expect(env.restart).toHaveBeenCalledTimes(2); // one match per seed
    // a1 wins both: 2 wins, 2 pts/match (1st of 2) × 2 = 4; a2: 0 wins, 1 pt × 2 = 2.
    expect(out.ranking[0]).toMatchObject({ id: 'a1', wins: 2, points: 4 });
    expect(out.ranking[1]).toMatchObject({ id: 'a2', wins: 0, points: 2 });
  });

  it('recent_logs filters by level, bot, instance, and text', async () => {
    const arena = { getId: () => 'ar1', getUserId: () => 'u1' };
    vi.mocked(arenaService.getDefaultForUser).mockResolvedValue(arena as never);
    const logs = [
      { level: 30, appId: 'a1', tankIndex: 1, msg: 'hello info' },
      { level: 50, appId: 'a1', tankIndex: 2, msg: 'E017: boom' },
      { level: 40, appId: 'a2', tankIndex: 1, msg: 'warn other' },
    ];
    vi.mocked(environmentService.getByArenaId).mockResolvedValue({
      getRecentLogs: () => logs,
    } as never);
    const client = await connect();
    const call = async (args: Record<string, unknown>) =>
      JSON.parse(
        textOf(
          (await client.callTool({
            name: 'recent_logs',
            arguments: args,
          })) as never
        )
      );

    // recent_logs renames the internal tankIndex field to botIndex on output.
    const mapped1 = { level: 50, appId: 'a1', botIndex: 2, msg: 'E017: boom' };
    // ERROR-and-up only.
    expect(await call({ minLevel: 'ERROR' })).toEqual([mapped1]);
    // A single bot.
    expect(
      (await call({ appId: 'a2' })).map((l: { msg: string }) => l.msg)
    ).toEqual(['warn other']);
    // A specific bot instance.
    expect(await call({ botIndex: 2 })).toEqual([mapped1]);
    // Substring of the message.
    expect(await call({ contains: 'boom' })).toEqual([mapped1]);
  });

  it('recent_faults returns structured crash records', async () => {
    const arena = { getId: () => 'ar1', getUserId: () => 'u1' };
    vi.mocked(arenaService.getDefaultForUser).mockResolvedValue(arena as never);
    const faults = [
      {
        appId: 'a1',
        tankId: 't1',
        tankIndex: 1,
        code: 'E017',
        kind: 'load',
        message: 'x is not defined',
        line: 3,
        timedOut: false,
        time: 5,
      },
    ];
    const getRecentFaults = vi.fn().mockReturnValue(faults);
    vi.mocked(environmentService.getByArenaId).mockResolvedValue({
      getRecentFaults,
    } as never);
    const client = await connect();
    const res = (await client.callTool({
      name: 'recent_faults',
      arguments: { appId: 'a1', limit: 10 },
    })) as { structuredContent?: unknown };

    expect(getRecentFaults).toHaveBeenCalledWith(10, 'a1');
    // recent_faults renames the internal tankIndex field to botIndex on output.
    expect(res.structuredContent).toEqual({
      faults: [
        {
          appId: 'a1',
          botId: 't1',
          botIndex: 1,
          code: 'E017',
          kind: 'load',
          message: 'x is not defined',
          line: 3,
          timedOut: false,
          time: 5,
        },
      ],
    });
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
    const resourceUris = resources.resources.map((r) => r.uri);
    expect(resourceUris).toContain('robocodejs://types/robocode.d.ts');
    expect(resourceUris).toContain('robocodejs://reference/error-codes');

    // Docs and samples are exposed as templates the client can enumerate/read.
    const templates = await client.listResourceTemplates();
    const uriTemplates = templates.resourceTemplates.map((t) => t.uriTemplate);
    expect(uriTemplates).toContain('robocodejs://docs/{slug}');
    expect(uriTemplates).toContain('robocodejs://samples/{name}');
  });

  it('marks tool behaviour with annotations and declares output schemas', async () => {
    const client = await connect();
    const { tools } = await client.listTools();
    const byName = Object.fromEntries(tools.map((t) => [t.name, t]));

    // Read-only tools are hinted so a client can run them freely.
    expect(byName['list_bots'].annotations?.readOnlyHint).toBe(true);
    expect(byName['arena_status'].annotations?.readOnlyHint).toBe(true);
    expect(byName['check_bot_source'].annotations?.readOnlyHint).toBe(true);
    // Destructive tools are hinted so a client can confirm first.
    expect(byName['delete_bot'].annotations?.destructiveHint).toBe(true);
    expect(byName['delete_arena'].annotations?.destructiveHint).toBe(true);
    // Typed tools advertise an output schema.
    expect(byName['check_bot_source'].outputSchema).toBeTruthy();
    expect(byName['set_bot_source'].outputSchema).toBeTruthy();
  });

  it('returns typed structuredContent for object results', async () => {
    const app = { getId: () => 'a1', getUserId: () => 'u1' };
    vi.mocked(appService.get).mockResolvedValue(app as never);
    const client = await connect();
    const res = (await client.callTool({
      name: 'set_bot_source',
      arguments: { appId: 'a1', source: 'NEW' },
    })) as { structuredContent?: unknown };

    expect(res.structuredContent).toEqual({ appId: 'a1', updated: true });
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

describe('POST /api/mcp auth (OAuth bearer)', () => {
  it('rejects an unauthenticated request with 401 + WWW-Authenticate', async () => {
    const res = await request(mcpApp)
      .post('/api/mcp')
      .set('Content-Type', 'application/json')
      .send({ jsonrpc: '2.0', method: 'tools/list', id: 1 });

    expect(res.status).toBe(401);
    // The header points MCP clients at our protected-resource metadata so they
    // can discover the authorization server and start the OAuth flow.
    expect(res.headers['www-authenticate']).toMatch(/resource_metadata=/);
  });
});

describe('mcp audit logging (logMcpRequest)', () => {
  it('logs an mcp.tool event for a tools/call request', () => {
    const spy = vi.spyOn(logger, 'info');
    logMcpRequest('u1', {
      method: 'tools/call',
      params: { name: 'delete_bot' },
    });
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({
        event: LogEvent.MCP_TOOL,
        userId: 'u1',
        tool: 'delete_bot',
      }),
      expect.any(String)
    );
    spy.mockRestore();
  });

  it('does not log for non-tool JSON-RPC messages', () => {
    const spy = vi.spyOn(logger, 'info');
    logMcpRequest('u1', { method: 'tools/list', id: 1 });
    logMcpRequest('u1', { method: 'initialize', params: {} });
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('logs each call in a batched (array) request', () => {
    const spy = vi.spyOn(logger, 'info');
    logMcpRequest('u1', [
      { method: 'tools/call', params: { name: 'list_bots' } },
      { method: 'tools/call', params: { name: 'restart_arena' } },
    ]);
    expect(spy).toHaveBeenCalledTimes(2);
    spy.mockRestore();
  });
});
