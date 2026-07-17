import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

// Stub the pg pool so transitively-imported services (via middleware/auth)
// don't try to open a real database connection at import time.
vi.mock('../src/util/db', () => ({ default: { query: vi.fn() } }));

// Mock the data/runtime layer so the tools can be driven in isolation; the MCP
// glue (ownership checks, arena resolution, result shaping) is what's under test.
vi.mock('../src/services/AppService', () => ({
  default: {
    getForUser: vi.fn(),
    get: vi.fn(),
    create: vi.fn(),
    getLeaderboard: vi.fn(),
  },
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
    metrics: vi.fn(() => ({
      arenas: 2,
      runningArenas: 1,
      isolates: 3,
      maxAvgTickMs: 8,
    })),
  },
}));
vi.mock('../src/util/botActions', () => ({
  propagateSource: vi.fn().mockResolvedValue(undefined),
  // The dry-run path check_app_source shares with the REST Check button. Stubbed
  // here for the same reason as the rest: this suite is about the MCP glue.
  checkSource: vi.fn().mockResolvedValue({ valid: true }),
  executeInUserArenas: vi.fn().mockResolvedValue(undefined),
  rebootInUserArenas: vi.fn().mockResolvedValue(undefined),
  deleteAppEverywhere: vi.fn().mockResolvedValue(undefined),
  // Real size-guard behavior (the async helpers above are what we stub out).
  MAX_SOURCE_BYTES: 256 * 1024,
  sourceSizeError: (source: string) =>
    Buffer.byteLength(source, 'utf-8') > 256 * 1024
      ? 'Source is too large; the limit is 256 KB.'
      : null,
}));
vi.mock('../src/util/arenaStatus', () => ({ buildArenaStatus: vi.fn() }));
vi.mock('../src/util/matchSummary', () => ({
  buildMatchSummary: vi.fn(),
  buildMatchStatus: vi.fn(),
  // run_match's poll loop exits on the first pass in these tests.
  isMatchDecided: vi.fn(() => true),
}));
// Mock the formatter so format_app_source doesn't load Prettier here; the MCP glue
// (arg handling, ownership, result shaping) is what's under test.
vi.mock('../src/util/formatter', () => ({ default: { format: vi.fn() } }));

import request from 'supertest';
import mcpApp, { buildServer, logMcpRequest } from '../src/api/mcp';
import { logger, LogEvent } from '../src/util/logger';
import appService from '../src/services/AppService';
import formatter from '../src/util/formatter';
import arenaService from '../src/services/ArenaService';
import arenaMemberService from '../src/services/ArenaMemberService';
import environmentService from '../src/services/EnvironmentService';
import { propagateSource, checkSource } from '../src/util/botActions';
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
  it('list_apps returns the user apps', async () => {
    vi.mocked(appService.getForUser).mockResolvedValue([
      {
        getId: () => 'a1',
        getName: () => 'Bot',
        getRating: () => 1500,
        getRatingGames: () => 0,
      },
    ] as never);
    const client = await connect();
    const res = (await client.callTool({
      name: 'list_apps',
      arguments: {},
    })) as never;

    expect(JSON.parse(textOf(res))).toEqual([
      { appId: 'a1', name: 'Bot', rating: 1500, ratingGames: 0 },
    ]);
  });

  it('leaderboard returns the global top-rated bots', async () => {
    vi.mocked(appService.getLeaderboard).mockResolvedValue([
      {
        rank: 1,
        color: 'blue',
        appId: 'a1',
        name: 'Overlord',
        ownerName: 'Lee',
        rating: 1712,
        games: 40,
        wins: 30,
        winRate: 0.75,
      },
    ] as never);
    const client = await connect();
    const res = (await client.callTool({
      name: 'leaderboard',
      arguments: {},
    })) as never;

    // Scoped to the acting user so only their own bots include an appId.
    expect(appService.getLeaderboard).toHaveBeenCalledWith(20, 'u1');
    expect(JSON.parse(textOf(res))[0]).toMatchObject({
      rank: 1,
      color: 'blue',
      name: 'Overlord',
      ownerName: 'Lee',
      rating: 1712,
    });
  });

  it('platform_status reports version, uptime, and the /health metrics', async () => {
    const client = await connect();
    const res = (await client.callTool({
      name: 'platform_status',
      arguments: {},
    })) as never;

    const out = JSON.parse(textOf(res));
    expect(out).toMatchObject({
      status: 'ok',
      metrics: {
        arenas: 2,
        runningArenas: 1,
        isolates: 3,
        maxAvgTickMs: 8,
      },
    });
    expect(typeof out.version).toBe('string');
    expect(typeof out.uptimeSec).toBe('number');
    // Process-memory gauges come from the real collectMetrics pass.
    expect(typeof out.metrics.rssMB).toBe('number');
    expect(typeof out.metrics.heapUsedMB).toBe('number');
  });

  it('create_app rejects an inappropriate name before creating anything', async () => {
    const client = await connect();
    const res = (await client.callTool({
      name: 'create_app',
      arguments: { name: 'fuck' },
    })) as { content: unknown[]; isError?: boolean };
    expect(res.isError).toBe(true);
    expect(appService.create).not.toHaveBeenCalled();
  });

  it('create_app accepts a clean name', async () => {
    vi.mocked(appService.create).mockResolvedValue({
      getId: () => 'newid',
      getName: () => 'Nice Bot',
      setName: vi.fn().mockResolvedValue(undefined),
      setSource: vi.fn().mockResolvedValue(undefined),
    } as never);
    const client = await connect();
    const res = (await client.callTool({
      name: 'create_app',
      arguments: { name: 'Nice Bot' },
    })) as { content: unknown[]; isError?: boolean };
    expect(res.isError).toBeFalsy();
    expect(appService.create).toHaveBeenCalled();
  });

  it('get_app_source returns source for an owned bot', async () => {
    vi.mocked(appService.get).mockResolvedValue({
      getUserId: () => 'u1',
      getSource: () => 'CODE',
    } as never);
    const client = await connect();
    const res = (await client.callTool({
      name: 'get_app_source',
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
      name: 'get_app_source',
      arguments: { appId: 'a1' },
    })) as { content: unknown[]; isError?: boolean };

    expect(res.isError).toBe(true);
    expect(textOf(res)).not.toContain('SECRET');
  });

  it('set_app_source persists + propagates via the shared helper', async () => {
    const app = { getId: () => 'a1', getUserId: () => 'u1' };
    vi.mocked(appService.get).mockResolvedValue(app as never);
    const client = await connect();
    await client.callTool({
      name: 'set_app_source',
      arguments: { appId: 'a1', source: 'NEW' },
    });

    expect(propagateSource).toHaveBeenCalledWith(app, 'NEW');
  });

  // Resource-exhaustion guard (GitHub #147). The same MAX_SOURCE_BYTES (256 KB)
  // cap the REST source PUT enforces also gates set_app_source — an oversized
  // source is rejected before it reaches the shared propagateSource helper.
  it('set_app_source rejects source over the size cap', async () => {
    const app = { getId: () => 'a1', getUserId: () => 'u1' };
    vi.mocked(appService.get).mockResolvedValue(app as never);
    const client = await connect();
    const res = (await client.callTool({
      name: 'set_app_source',
      arguments: { appId: 'a1', source: 'x'.repeat(256 * 1024 + 1) },
    })) as { content: unknown[]; isError?: boolean };

    expect(res.isError).toBe(true);
    expect(textOf(res)).toMatch(/too large/i);
    expect(propagateSource).not.toHaveBeenCalled();
  });

  it('check_app_source dry-run compiles raw source', async () => {
    vi.mocked(checkSource).mockResolvedValue({ valid: true } as never);
    const client = await connect();
    const res = (await client.callTool({
      name: 'check_app_source',
      arguments: { source: 'clock.on(Event.TICK, () => {})' },
    })) as never;

    // The acting user is passed through so the checker badge lands on them.
    expect(checkSource).toHaveBeenCalledWith(
      'u1',
      'clock.on(Event.TICK, () => {})'
    );
    expect(JSON.parse(textOf(res))).toEqual({ valid: true });
  });

  it('check_app_source reports an invalid bot (still a successful call)', async () => {
    vi.mocked(checkSource).mockResolvedValue({
      valid: false,
      stage: 'compile',
      errorCode: 'E017',
      message: 'Unexpected token',
      timedOut: false,
    } as never);
    const client = await connect();
    const res = (await client.callTool({
      name: 'check_app_source',
      arguments: { source: 'function ( {' },
    })) as { content: unknown[]; isError?: boolean };

    expect(res.isError).toBeFalsy();
    expect(JSON.parse(textOf(res)).errorCode).toBe('E017');
  });

  it('check_app_source resolves a saved bot by appId and enforces ownership', async () => {
    vi.mocked(checkSource).mockResolvedValue({ valid: true } as never);
    vi.mocked(appService.get).mockResolvedValue({
      getUserId: () => 'u1',
      getSource: () => 'SAVED',
    } as never);
    const client = await connect();
    await client.callTool({
      name: 'check_app_source',
      arguments: { appId: 'a1' },
    });
    expect(checkSource).toHaveBeenCalledWith('u1', 'SAVED');

    // A bot owned by someone else is rejected and never compiled.
    vi.mocked(checkSource).mockClear();
    vi.mocked(appService.get).mockResolvedValue({
      getUserId: () => 'someone-else',
      getSource: () => 'SECRET',
    } as never);
    const res = (await client.callTool({
      name: 'check_app_source',
      arguments: { appId: 'a1' },
    })) as { content: unknown[]; isError?: boolean };
    expect(res.isError).toBe(true);
    expect(checkSource).not.toHaveBeenCalled();
  });

  it('check_app_source requires source or appId', async () => {
    const client = await connect();
    const res = (await client.callTool({
      name: 'check_app_source',
      arguments: {},
    })) as { content: unknown[]; isError?: boolean };
    expect(res.isError).toBe(true);
  });

  it('format_app_source pretty-prints raw source', async () => {
    vi.mocked(formatter.format).mockResolvedValue({
      ok: true,
      formatted: 'const x = 1;\n',
      changed: true,
    } as never);
    const client = await connect();
    const res = (await client.callTool({
      name: 'format_app_source',
      arguments: { source: 'const  x=1' },
    })) as never;

    expect(formatter.format).toHaveBeenCalledWith('const  x=1');
    expect(JSON.parse(textOf(res))).toEqual({
      ok: true,
      formatted: 'const x = 1;\n',
      changed: true,
    });
  });

  it('format_app_source resolves a saved bot by appId and enforces ownership', async () => {
    vi.mocked(formatter.format).mockResolvedValue({
      ok: true,
      formatted: 'CODE',
      changed: false,
    } as never);
    vi.mocked(appService.get).mockResolvedValue({
      getUserId: () => 'u1',
      getSource: () => 'SAVED',
    } as never);
    const client = await connect();
    await client.callTool({
      name: 'format_app_source',
      arguments: { appId: 'a1' },
    });
    expect(formatter.format).toHaveBeenCalledWith('SAVED');

    // A bot owned by someone else is rejected and never formatted.
    vi.mocked(formatter.format).mockClear();
    vi.mocked(appService.get).mockResolvedValue({
      getUserId: () => 'someone-else',
      getSource: () => 'SECRET',
    } as never);
    const res = (await client.callTool({
      name: 'format_app_source',
      arguments: { appId: 'a1' },
    })) as { content: unknown[]; isError?: boolean };
    expect(res.isError).toBe(true);
    expect(formatter.format).not.toHaveBeenCalled();
  });

  it('format_app_source surfaces an unparseable source as a tool error', async () => {
    vi.mocked(formatter.format).mockResolvedValue({
      ok: false,
      message: 'Unexpected token (1:9)',
    } as never);
    const client = await connect();
    const res = (await client.callTool({
      name: 'format_app_source',
      arguments: { source: 'function ( {' },
    })) as { content: unknown[]; isError?: boolean };
    expect(res.isError).toBe(true);
    expect(textOf(res)).toContain('check_app_source');
  });

  it('format_app_source requires source or appId', async () => {
    const client = await connect();
    const res = (await client.callTool({
      name: 'format_app_source',
      arguments: {},
    })) as { content: unknown[]; isError?: boolean };
    expect(res.isError).toBe(true);
  });

  it('arena_status requires an explicit arenaId (no default-arena fallback)', async () => {
    // arenaId is a required input, so omitting it is an invalid-arguments error
    // rather than a silent fall-through to some default arena.
    const client = await connect();
    const res = (await client.callTool({
      name: 'arena_status',
      arguments: {},
    })) as { isError?: boolean };

    expect(res.isError).toBe(true);
    expect(arenaService.getDefaultForUser).not.toHaveBeenCalled();
  });

  it('arena_status spectates an arena owned by someone else (read-only, by id)', async () => {
    // Owned by u2, caller is u1 — read-only view tools resolve by id without an
    // ownership check, so this must succeed (the arena id is the capability).
    const otherArena = { getId: () => 'ar2', getUserId: () => 'u2' };
    vi.mocked(arenaService.get).mockResolvedValue(otherArena as never);
    vi.mocked(arenaMemberService.getForArena).mockResolvedValue([] as never);
    vi.mocked(buildArenaStatus).mockResolvedValue({ running: true } as never);
    const client = await connect();
    const res = (await client.callTool({
      name: 'arena_status',
      arguments: { arenaId: 'ar2' },
    })) as never;

    expect(arenaService.get).toHaveBeenCalledWith('ar2');
    expect(JSON.parse(textOf(res))).toEqual({ running: true });
  });

  it('pause_arena refuses an arena owned by someone else (writes stay owner-only)', async () => {
    const otherArena = { getId: () => 'ar2', getUserId: () => 'u2' };
    vi.mocked(arenaService.get).mockResolvedValue(otherArena as never);
    const client = await connect();
    const res = (await client.callTool({
      name: 'pause_arena',
      arguments: { arenaId: 'ar2' },
    })) as { isError?: boolean };

    expect(res.isError).toBe(true);
  });

  it('match_summary resolves the arena by id and returns the summary', async () => {
    const arena = { getId: () => 'ar1', getUserId: () => 'u1' };
    vi.mocked(arenaService.get).mockResolvedValue(arena as never);
    vi.mocked(arenaMemberService.getForArena).mockResolvedValue([] as never);
    vi.mocked(buildMatchSummary).mockResolvedValue({
      match: { decided: true, winner: { id: 'a1' } },
    } as never);
    const client = await connect();
    const res = (await client.callTool({
      name: 'match_summary',
      arguments: { arenaId: 'ar1' },
    })) as never;

    expect(arenaService.get).toHaveBeenCalledWith('ar1');
    expect(JSON.parse(textOf(res))).toEqual({
      match: { decided: true, winner: { id: 'a1' } },
    });
  });

  it('match_status resolves the arena by id and returns the status', async () => {
    const arena = { getId: () => 'ar1', getUserId: () => 'u1' };
    vi.mocked(arenaService.get).mockResolvedValue(arena as never);
    vi.mocked(arenaMemberService.getForArena).mockResolvedValue([] as never);
    vi.mocked(buildMatchStatus).mockResolvedValue({
      match: { decided: false, winner: null },
      standings: [],
    } as never);
    const client = await connect();
    const res = (await client.callTool({
      name: 'match_status',
      arguments: { arenaId: 'ar1' },
    })) as never;

    expect(arenaService.get).toHaveBeenCalledWith('ar1');
    expect(JSON.parse(textOf(res))).toEqual({
      match: { decided: false, winner: null },
      standings: [],
    });
  });

  it('restart_arena restarts, resumes, and reports the seed the match runs on', async () => {
    const arena = { getId: () => 'ar1', getUserId: () => 'u1' };
    vi.mocked(arenaService.get).mockResolvedValue(arena as never);
    const env = {
      restart: vi.fn().mockResolvedValue(undefined),
      resume: vi.fn(),
      getSeed: vi.fn().mockReturnValue(12345),
    };
    vi.mocked(environmentService.get).mockResolvedValue(env as never);
    const client = await connect();
    const res = await client.callTool({
      name: 'restart_arena',
      arguments: { arenaId: 'ar1' },
    });
    expect(env.restart).toHaveBeenCalled();
    expect(env.resume).toHaveBeenCalled();
    // The seed is surfaced so a client can reproduce this match (set_arena_seed).
    expect((res.structuredContent as { seed: number }).seed).toBe(12345);
  });

  it('run_match reseeds, restarts+resumes, runs to a decision, and returns the winner', async () => {
    const arena = { getId: () => 'ar1', getUserId: () => 'u1' };
    vi.mocked(arenaService.get).mockResolvedValue(arena as never);
    vi.mocked(arenaMemberService.getForArena).mockResolvedValue([
      {},
      {},
    ] as never);
    const env = {
      getProcesses: () => [{}, {}],
      beginMatch: vi.fn(() => true),
      endMatch: vi.fn(),
      setSeed: vi.fn(),
      getSpeed: () => 1,
      setSpeed: vi.fn(),
      restart: vi.fn().mockResolvedValue(undefined),
      resume: vi.fn(),
      pause: vi.fn(),
      isRunning: () => true,
    };
    vi.mocked(environmentService.get).mockResolvedValue(env as never);
    // isMatchDecided (mocked true) exits the poll loop immediately; the final
    // build returns the decided summary.
    vi.mocked(buildMatchSummary).mockResolvedValue({
      match: { decided: true, winner: { id: 'a1', name: 'Winner' } },
      leaderboard: [{ rank: 1, id: 'a1' }],
    } as never);

    const client = await connect();
    const res = (await client.callTool({
      name: 'run_match',
      arguments: { arenaId: 'ar1', seed: 42 },
    })) as never;

    expect(env.setSeed).toHaveBeenCalledWith(42);
    expect(env.restart).toHaveBeenCalled();
    expect(env.resume).toHaveBeenCalled(); // restart alone leaves it paused
    expect(env.pause).toHaveBeenCalled(); // paused at the decided state
    const out = JSON.parse(textOf(res));
    expect(out.timedOut).toBe(false);
    expect(out.match.winner.id).toBe('a1');
  });

  it('run_match refuses cleanly when a match is already running in the arena', async () => {
    const arena = { getId: () => 'ar1', getUserId: () => 'u1' };
    vi.mocked(arenaService.get).mockResolvedValue(arena as never);
    vi.mocked(arenaMemberService.getForArena).mockResolvedValue([
      {},
      {},
    ] as never);
    const env = {
      getProcesses: () => [{}, {}],
      beginMatch: vi.fn(() => false), // arena already claimed by another match
      endMatch: vi.fn(),
      restart: vi.fn(),
    };
    vi.mocked(environmentService.get).mockResolvedValue(env as never);

    const client = await connect();
    const res = (await client.callTool({
      name: 'run_match',
      arguments: { arenaId: 'ar1' },
    })) as { content: { text?: string }[]; isError?: boolean };

    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(/already has a match running/i);
    expect(env.restart).not.toHaveBeenCalled(); // never touched the live arena
  });

  it('run_match requires at least two apps', async () => {
    const arena = { getId: () => 'ar1', getUserId: () => 'u1' };
    vi.mocked(arenaService.get).mockResolvedValue(arena as never);
    vi.mocked(arenaMemberService.getForArena).mockResolvedValue([{}] as never);
    vi.mocked(environmentService.get).mockResolvedValue({
      getProcesses: () => [{}],
    } as never);
    const client = await connect();
    const res = (await client.callTool({
      name: 'run_match',
      arguments: { arenaId: 'ar1' },
    })) as { content: unknown[]; isError?: boolean };
    expect(res.isError).toBe(true);
  });

  it('recent_logs filters by level, bot, instance, and text', async () => {
    const arena = { getId: () => 'ar1', getUserId: () => 'u1' };
    vi.mocked(arenaService.get).mockResolvedValue(arena as never);
    const logs = [
      { level: 30, appId: 'a1', botIndex: 1, msg: 'hello info' },
      { level: 50, appId: 'a1', botIndex: 2, msg: 'E017: boom' },
      { level: 40, appId: 'a2', botIndex: 1, msg: 'warn other' },
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
            arguments: { arenaId: 'ar1', ...args },
          })) as never
        )
      );

    // recent_logs renames the internal botIndex field to botIndex on output.
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
    vi.mocked(arenaService.get).mockResolvedValue(arena as never);
    const faults = [
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
    ];
    const getRecentFaults = vi.fn().mockReturnValue(faults);
    vi.mocked(environmentService.getByArenaId).mockResolvedValue({
      getRecentFaults,
    } as never);
    const client = await connect();
    const res = (await client.callTool({
      name: 'recent_faults',
      arguments: { arenaId: 'ar1', appId: 'a1', limit: 10 },
    })) as { structuredContent?: unknown };

    expect(getRecentFaults).toHaveBeenCalledWith(10, 'a1');
    // The fault records already carry botId/botIndex, so they pass through as-is.
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
    vi.mocked(arenaService.get).mockResolvedValue(arena as never);
    const env = { setSpeed: vi.fn(), getSpeed: () => 4, getTickMs: () => 25 };
    vi.mocked(environmentService.get).mockResolvedValue(env as never);
    const client = await connect();
    const res = (await client.callTool({
      name: 'set_arena_speed',
      arguments: { arenaId: 'ar1', speed: 4 },
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
    vi.mocked(arenaService.get).mockResolvedValue(arena as never);
    const env = { setSpeed: vi.fn(), getSpeed: () => 0, getTickMs: () => 0 };
    vi.mocked(environmentService.get).mockResolvedValue(env as never);
    const client = await connect();
    await client.callTool({
      name: 'set_arena_speed',
      arguments: { arenaId: 'ar1', speed: 'max' },
    });

    expect(env.setSpeed).toHaveBeenCalledWith(0);
  });

  it('set_arena_seed sets the seed on the resolved arena env', async () => {
    const arena = { getId: () => 'ar1', getUserId: () => 'u1' };
    vi.mocked(arenaService.get).mockResolvedValue(arena as never);
    const env = { setSeed: vi.fn(), getSeed: () => 99 };
    vi.mocked(environmentService.get).mockResolvedValue(env as never);
    const client = await connect();
    const res = (await client.callTool({
      name: 'set_arena_seed',
      arguments: { arenaId: 'ar1', seed: 99 },
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

  it('list_docs returns a (possibly empty) catalog without erroring', async () => {
    // Server unit tests run without the built dist/public assets, so listPublic
    // returns [] — the result is still a valid, non-error array (the fixed
    // types entry is always present).
    const client = await connect();
    const res = (await client.callTool({
      name: 'list_docs',
      arguments: {},
    })) as { content: unknown[]; isError?: boolean };
    expect(res.isError).toBeFalsy();
    const entries = JSON.parse(textOf(res));
    expect(Array.isArray(entries)).toBe(true);
  });

  it('read_doc rejects a bogus id', async () => {
    const client = await connect();
    const res = (await client.callTool({
      name: 'read_doc',
      arguments: { id: 'nope/x' },
    })) as { content: unknown[]; isError?: boolean };
    expect(res.isError).toBe(true);
  });

  it('read_doc returns an error for a well-formed but unreadable id', async () => {
    // docs/dev is a valid id shape, but the file is absent when assets aren't
    // built — this exercises the happy-path parse + the not-found branch.
    const client = await connect();
    const res = (await client.callTool({
      name: 'read_doc',
      arguments: { id: 'docs/dev' },
    })) as { content: unknown[]; isError?: boolean };
    expect(res.isError).toBe(true);
  });

  it('marks tool behaviour with annotations and declares output schemas', async () => {
    const client = await connect();
    const { tools } = await client.listTools();
    const byName = Object.fromEntries(tools.map((t) => [t.name, t]));

    // Read-only tools are hinted so a client can run them freely.
    expect(byName['list_apps'].annotations?.readOnlyHint).toBe(true);
    expect(byName['arena_status'].annotations?.readOnlyHint).toBe(true);
    expect(byName['check_app_source'].annotations?.readOnlyHint).toBe(true);
    expect(byName['format_app_source'].annotations?.readOnlyHint).toBe(true);
    // Destructive tools are hinted so a client can confirm first.
    expect(byName['delete_app'].annotations?.destructiveHint).toBe(true);
    expect(byName['delete_arena'].annotations?.destructiveHint).toBe(true);
    // Typed tools advertise an output schema.
    expect(byName['check_app_source'].outputSchema).toBeTruthy();
    expect(byName['set_app_source'].outputSchema).toBeTruthy();
  });

  it('returns typed structuredContent for object results', async () => {
    const app = { getId: () => 'a1', getUserId: () => 'u1' };
    vi.mocked(appService.get).mockResolvedValue(app as never);
    const client = await connect();
    const res = (await client.callTool({
      name: 'set_app_source',
      arguments: { appId: 'a1', source: 'NEW' },
    })) as { structuredContent?: unknown };

    expect(res.structuredContent).toEqual({ appId: 'a1', updated: true });
  });

  it('exposes workflow prompts and fills in arguments', async () => {
    const client = await connect();

    const prompts = await client.listPrompts();
    expect(prompts.prompts.map((p) => p.name)).toEqual(
      expect.arrayContaining(['write_app', 'debug_app', 'play_match'])
    );

    const filled = await client.getPrompt({
      name: 'write_app',
      arguments: { goal: 'circle and snipe', arenaId: 'ar1' },
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
      params: { name: 'delete_app' },
    });
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({
        event: LogEvent.MCP_TOOL,
        userId: 'u1',
        tool: 'delete_app',
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
      { method: 'tools/call', params: { name: 'list_apps' } },
      { method: 'tools/call', params: { name: 'restart_arena' } },
    ]);
    expect(spy).toHaveBeenCalledTimes(2);
    spy.mockRestore();
  });
});

describe('mcp completion logging (mcp.tool.result)', () => {
  it('logs ok=true with a duration when a tool succeeds', async () => {
    vi.mocked(appService.getForUser).mockResolvedValue([] as never);
    const spy = vi.spyOn(logger, 'info');

    const client = await connect();
    await client.callTool({ name: 'list_apps', arguments: {} });

    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({
        event: LogEvent.MCP_TOOL_RESULT,
        userId: 'u1',
        tool: 'list_apps',
        ok: true,
        durationMs: expect.any(Number),
      }),
      expect.any(String)
    );
    spy.mockRestore();
  });

  it('logs ok=false with the reason when a tool returns an error result', async () => {
    // run_match with a single active bot returns an isError result (fail()).
    const arena = { getId: () => 'ar1', getUserId: () => 'u1' };
    vi.mocked(arenaService.get).mockResolvedValue(arena as never);
    vi.mocked(arenaMemberService.getForArena).mockResolvedValue([{}] as never);
    vi.mocked(environmentService.get).mockResolvedValue({
      getProcesses: () => [{}],
    } as never);
    const spy = vi.spyOn(logger, 'info');

    const client = await connect();
    await client.callTool({ name: 'run_match', arguments: { arenaId: 'ar1' } });

    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({
        event: LogEvent.MCP_TOOL_RESULT,
        tool: 'run_match',
        ok: false,
        error: expect.stringContaining('at least two apps'),
      }),
      expect.any(String)
    );
    spy.mockRestore();
  });
});

describe('mcp per-match logging (mcp.match)', () => {
  it('logs a decided match for run_match with the winner and seed', async () => {
    const arena = { getId: () => 'ar1', getUserId: () => 'u1' };
    vi.mocked(arenaService.get).mockResolvedValue(arena as never);
    vi.mocked(arenaMemberService.getForArena).mockResolvedValue([
      {},
      {},
    ] as never);
    vi.mocked(environmentService.get).mockResolvedValue({
      getProcesses: () => [{}, {}],
      beginMatch: vi.fn(() => true),
      endMatch: vi.fn(),
      setSeed: vi.fn(),
      getSpeed: () => 1,
      setSpeed: vi.fn(),
      restart: vi.fn().mockResolvedValue(undefined),
      resume: vi.fn(),
      pause: vi.fn(),
      isRunning: () => true,
    } as never);
    vi.mocked(buildMatchSummary).mockResolvedValue({
      match: { decided: true, winner: { id: 'a1', name: 'Winner' } },
      leaderboard: [{ rank: 1, id: 'a1' }],
    } as never);
    const spy = vi.spyOn(logger, 'info');

    const client = await connect();
    await client.callTool({
      name: 'run_match',
      arguments: { arenaId: 'ar1', seed: 42 },
    });

    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({
        event: LogEvent.MCP_MATCH,
        context: 'run_match',
        arenaId: 'ar1',
        seed: 42,
        decided: true,
        timedOut: false,
        winnerId: 'a1',
        winnerName: 'Winner',
        durationMs: expect.any(Number),
      }),
      expect.any(String)
    );
    spy.mockRestore();
  });
});
