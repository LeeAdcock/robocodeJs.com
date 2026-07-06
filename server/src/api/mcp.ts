import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import {
  McpServer,
  ResourceTemplate,
} from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { requireBearerAuth } from '@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js';
import { getOAuthProtectedResourceMetadataUrl } from '@modelcontextprotocol/sdk/server/auth/router.js';
import { z } from 'zod';

import { AuthenticatedRequest, ensureDevUser } from '../middleware/auth';
import { isLocalDev } from '../util/devMode';
import userService from '../services/UserService';
import { provider, RESOURCE_URL } from './oauth';
import User from '../types/user';
import Arena from '../types/arena';
import TankApp from '../types/app';
import appService from '../services/AppService';
import compiler from '../util/compiler';
import arenaService from '../services/ArenaService';
import arenaMemberService from '../services/ArenaMemberService';
import environmentService from '../services/EnvironmentService';
import {
  propagateSource,
  executeInUserArenas,
  rebootInUserArenas,
  deleteAppEverywhere,
} from '../util/botActions';
import { buildArenaStatus } from '../util/arenaStatus';
import { buildMatchSummary } from '../util/matchSummary';
import { logger, LogEvent } from '../util/logger';

const app = express();

// Caps mirrored from the REST API (api/arena.ts) so the MCP tools enforce the
// same limits. Kept in sync by hand; both bound the in-memory EnvironmentService.
const MAX_ARENAS_PER_USER = 10;
const MAX_APPS_PER_ARENA = 4;

// The built static assets (bot API docs, type definitions, sample bots) that the
// UI serves and that we also expose as MCP resources, so a model can read the
// real API before writing a bot. Resolved relative to this compiled module
// (dist/src/api → dist/public) so it works regardless of the process cwd, the
// same way index.ts locates the SPA shell.
const PUBLIC_DIR = path.join(__dirname, '../../public');

// The only public subdirectories these helpers ever serve. Every call site
// passes one of these literals; the runtime allowlist below is defense-in-depth
// so `sub` can never regress into a path-traversal vector even if a future
// caller sourced it from request input (the `filename`/basename guard only
// covers the last path segment, not `sub`).
const PUBLIC_SUBDIRS = ['docs', 'samples', 'ts'] as const;
const isAllowedSub = (sub: string): boolean =>
  (PUBLIC_SUBDIRS as readonly string[]).includes(sub);

// List files in a public subdirectory with the given extension (basename only).
// Returns [] if the directory is absent (e.g. running from source in tests).
const listPublic = (sub: string, ext: string): string[] => {
  if (!isAllowedSub(sub)) return [];
  try {
    return fs
      .readdirSync(path.join(PUBLIC_DIR, sub))
      .filter((f) => f.endsWith(ext))
      .sort();
  } catch {
    return [];
  }
};

// Read one public file, guarding against path traversal by allow-listing the
// subdirectory and reducing the name to its basename before joining. Returns
// null if it can't be read.
const readPublic = (sub: string, filename: string): string | null => {
  if (!isAllowedSub(sub)) return null;
  try {
    return fs.readFileSync(
      path.join(PUBLIC_DIR, sub, path.basename(filename)),
      'utf-8'
    );
  } catch {
    return null;
  }
};

type ToolResult = {
  content: { type: 'text'; text: string }[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

// Wrap a tool's result. In addition to the human-readable text part, a plain
// object is also returned as `structuredContent` so clients can consume a typed
// result (and it satisfies the validated `outputSchema` on tools that declare
// one). Arrays and strings have no object shape, so they stay text-only.
const ok = (data: unknown): ToolResult => {
  const structured =
    typeof data === 'object' && data !== null && !Array.isArray(data)
      ? (data as Record<string, unknown>)
      : undefined;
  return {
    content: [
      {
        type: 'text',
        text: typeof data === 'string' ? data : JSON.stringify(data, null, 2),
      },
    ],
    ...(structured ? { structuredContent: structured } : {}),
  };
};

const fail = (message: string): ToolResult => ({
  content: [{ type: 'text', text: message }],
  isError: true,
});

// Behaviour hints so clients can gate/confirm actions (e.g. prompt before a
// destructive tool, or run a read-only one freely). All tools act only on the
// authenticated user's own resources, so none touch an "open world".
const READ_ONLY = { readOnlyHint: true, openWorldHint: false } as const;
const DESTRUCTIVE = {
  destructiveHint: true,
  idempotentHint: true,
  openWorldHint: false,
} as const;
const IDEMPOTENT = { idempotentHint: true, openWorldHint: false } as const;
const WRITE = { openWorldHint: false } as const;

// Resolve an app that belongs to the authenticated user, or null. Stops a tool
// from touching another user's bot (the MCP equivalent of requireOwner).
const ownedApp = async (user: User, appId: string): Promise<TankApp | null> => {
  const app = await appService.get(appId);
  return app && app.getUserId() === user.getId() ? app : null;
};

// Resolve the arena to act on: the given id (must belong to the user) or the
// user's default arena when omitted — mirrors the REST resolveArena middleware.
const ownedArena = async (
  user: User,
  arenaId?: string
): Promise<Arena | null> => {
  if (arenaId) {
    const arena = await arenaService.get(arenaId);
    return arena && arena.getUserId() === user.getId() ? arena : null;
  }
  return arenaService.getDefaultForUser(user.getId());
};

// Run one match in an arena to a decision (or a timeout) and return its match
// summary. Optionally reseeds first, then runs unbounded ("as fast as the bots
// can be driven"): it restarts the arena — re-firing every bot's START — and
// resumes it (restart() alone silently leaves the arena PAUSED), polls until at
// most one bot still has living tanks (`match.decided`) or the arena stops (all
// dead) or the wall-clock timeout elapses, then pauses and restores the arena's
// prior speed. Shared by the run_match and run_tournament tools.
const DEFAULT_MATCH_TIMEOUT_MS = 60000;
const runMatchToDecision = async (
  env: Awaited<ReturnType<typeof environmentService.get>>,
  members: Awaited<ReturnType<typeof arenaMemberService.getForArena>>,
  opts: { seed?: number; timeoutMs?: number } = {}
): Promise<Awaited<ReturnType<typeof buildMatchSummary>>> => {
  if (opts.seed !== undefined) env.setSeed(opts.seed);
  const priorSpeed = env.getSpeed();
  env.setSpeed(0); // unbounded — decide the match as quickly as possible
  await env.restart();
  env.resume(); // restart() does not resume

  const deadline = Date.now() + (opts.timeoutMs ?? DEFAULT_MATCH_TIMEOUT_MS);
  let summary = await buildMatchSummary(env, members);
  while (!summary.match.decided && env.isRunning() && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    summary = await buildMatchSummary(env, members);
  }

  env.pause();
  env.setSpeed(priorSpeed);
  return buildMatchSummary(env, members);
};

// Build a fresh MCP server bound to one authenticated user. All tools act on
// that user's own resources only, so there is no cross-user addressing (and no
// :userId argument): the bearer token already identifies the actor. Exported so
// tests can drive the tools over an in-memory transport.
export const buildServer = (user: User): McpServer => {
  const server = new McpServer({
    name: 'robocodejs',
    version: '1.0.0',
  });

  // ---- Bots (apps) ----

  server.registerTool(
    'list_bots',
    {
      title: 'List bots',
      description: "List the authenticated user's bots (id and name).",
      inputSchema: {},
      annotations: READ_ONLY,
    },
    async () => {
      const apps = await appService.getForUser(user.getId());
      return ok(apps.map((a) => ({ id: a.getId(), name: a.getName() })));
    }
  );

  server.registerTool(
    'get_bot_source',
    {
      title: 'Get bot source',
      description: "Return a bot's JavaScript source code.",
      inputSchema: { appId: z.string().describe('The bot (app) id') },
      annotations: READ_ONLY,
    },
    async ({ appId }) => {
      const app = await ownedApp(user, appId);
      if (!app) return fail('No such bot, or it is not yours.');
      const source = app.getSource();
      // An empty string reads as ambiguous to a model (error? blank bot?). Be
      // explicit that the bot simply has no source yet.
      if (!source.trim()) {
        return ok(
          `This bot ("${app.getName()}", ${appId}) has no source yet — it ` +
            'is empty. Add code with set_bot_source.'
        );
      }
      return ok(source);
    }
  );

  server.registerTool(
    'create_bot',
    {
      title: 'Create bot',
      description:
        'Create a new bot, optionally setting its name and initial source.',
      inputSchema: {
        name: z.string().optional().describe('Optional bot name'),
        source: z
          .string()
          .optional()
          .describe('Optional initial JavaScript source'),
      },
      outputSchema: { appId: z.string(), name: z.string() },
      annotations: WRITE,
    },
    async ({ name, source }) => {
      const app = await appService.create(user.getId());
      if (name) await app.setName(name);
      if (source) await app.setSource(source);
      return ok({ appId: app.getId(), name: app.getName() });
    }
  );

  server.registerTool(
    'set_bot_source',
    {
      title: 'Set bot source',
      description:
        "Replace a bot's source. Live arenas it's in pick up the change " +
        '(without re-firing START — use reboot_bot for that).',
      inputSchema: {
        appId: z.string().describe('The bot (app) id'),
        source: z.string().describe('New JavaScript source'),
      },
      outputSchema: { appId: z.string(), updated: z.boolean() },
      annotations: IDEMPOTENT,
    },
    async ({ appId, source }) => {
      const app = await ownedApp(user, appId);
      if (!app) return fail('No such bot, or it is not yours.');
      await propagateSource(app, source);
      return ok({ appId, updated: true });
    }
  );

  server.registerTool(
    'rename_bot',
    {
      title: 'Rename bot',
      description: 'Change a bot’s display name.',
      inputSchema: {
        appId: z.string().describe('The bot (app) id'),
        name: z.string().describe('New name'),
      },
      outputSchema: { appId: z.string(), name: z.string() },
      annotations: IDEMPOTENT,
    },
    async ({ appId, name }) => {
      const app = await ownedApp(user, appId);
      if (!app) return fail('No such bot, or it is not yours.');
      await app.setName(name);
      return ok({ appId, name });
    }
  );

  server.registerTool(
    'compile_bot',
    {
      title: 'Compile bot',
      description: "Re-run a bot's current source in each of your live arenas.",
      inputSchema: { appId: z.string().describe('The bot (app) id') },
      outputSchema: { appId: z.string(), compiled: z.boolean() },
      annotations: WRITE,
    },
    async ({ appId }) => {
      const app = await ownedApp(user, appId);
      if (!app) return fail('No such bot, or it is not yours.');
      await executeInUserArenas(user.getId(), app.getId());
      return ok({ appId, compiled: true });
    }
  );

  server.registerTool(
    'check_bot_source',
    {
      title: 'Check bot source',
      description:
        'Dry-run compile a bot WITHOUT deploying it: loads the source in a ' +
        'throwaway sandbox and reports any syntax or load error (with its error ' +
        'code — see the robocodejs://reference/error-codes resource). Pass ' +
        '`source` to check arbitrary code before creating a bot, or `appId` to ' +
        'check a saved bot. A clean result is `{ valid: true }`.',
      inputSchema: {
        source: z.string().optional().describe('Bot source to check'),
        appId: z
          .string()
          .optional()
          .describe("A saved bot to check (used when 'source' is omitted)"),
      },
      outputSchema: {
        valid: z.boolean(),
        stage: z.enum(['compile', 'load']).optional(),
        errorCode: z.string().optional(),
        message: z.string().optional(),
        timedOut: z.boolean().optional(),
      },
      annotations: READ_ONLY,
    },
    async ({ source, appId }) => {
      let code = source;
      if (code === undefined) {
        if (!appId) return fail('Provide `source` or `appId`.');
        const app = await ownedApp(user, appId);
        if (!app) return fail('No such bot, or it is not yours.');
        code = app.getSource();
      }
      return ok(await compiler.check(code));
    }
  );

  server.registerTool(
    'reboot_bot',
    {
      title: 'Reboot bot',
      description:
        'Reload a bot and re-fire its START handler in each of your live arenas.',
      inputSchema: { appId: z.string().describe('The bot (app) id') },
      outputSchema: { appId: z.string(), rebooted: z.boolean() },
      annotations: WRITE,
    },
    async ({ appId }) => {
      const app = await ownedApp(user, appId);
      if (!app) return fail('No such bot, or it is not yours.');
      await rebootInUserArenas(user.getId(), app.getId());
      return ok({ appId, rebooted: true });
    }
  );

  server.registerTool(
    'delete_bot',
    {
      title: 'Delete bot',
      description: 'Remove a bot from every arena and delete it.',
      inputSchema: { appId: z.string().describe('The bot (app) id') },
      outputSchema: { appId: z.string(), deleted: z.boolean() },
      annotations: DESTRUCTIVE,
    },
    async ({ appId }) => {
      const app = await ownedApp(user, appId);
      if (!app) return fail('No such bot, or it is not yours.');
      await deleteAppEverywhere(app);
      return ok({ appId, deleted: true });
    }
  );

  // ---- Arenas ----

  server.registerTool(
    'list_arenas',
    {
      title: 'List arenas',
      description: "List the authenticated user's arenas (ids).",
      inputSchema: {},
      annotations: READ_ONLY,
    },
    async () => {
      const arenas = await arenaService.getForUser(user.getId());
      return ok(arenas.map((a) => ({ id: a.getId() })));
    }
  );

  server.registerTool(
    'create_arena',
    {
      title: 'Create arena',
      description: `Create a new arena (up to ${MAX_ARENAS_PER_USER} per user).`,
      inputSchema: {},
      outputSchema: { id: z.string() },
      annotations: WRITE,
    },
    async () => {
      const existing = await arenaService.getForUser(user.getId());
      if (existing.length >= MAX_ARENAS_PER_USER) {
        return fail(`Arena limit reached (${MAX_ARENAS_PER_USER}).`);
      }
      const arena = await arenaService.create(user.getId());
      return ok({ id: arena.getId() });
    }
  );

  server.registerTool(
    'delete_arena',
    {
      title: 'Delete arena',
      description: 'Tear down an arena and delete it.',
      inputSchema: { arenaId: z.string().describe('The arena id') },
      outputSchema: { arenaId: z.string(), deleted: z.boolean() },
      annotations: DESTRUCTIVE,
    },
    async ({ arenaId }) => {
      const arena = await ownedArena(user, arenaId);
      if (!arena) return fail('No such arena, or it is not yours.');
      await environmentService.dispose(arena.getId());
      await arenaMemberService.deleteForArena(arena.getId());
      await arenaService.delete(arena.getId());
      return ok({ arenaId, deleted: true });
    }
  );

  server.registerTool(
    'arena_status',
    {
      title: 'Arena status',
      description:
        'Snapshot of an arena: size, running state, clock, and every ' +
        "bot's tanks (position, orientation, health, bullets). Omit arenaId " +
        'for your default arena.',
      inputSchema: {
        arenaId: z
          .string()
          .optional()
          .describe('Arena id; defaults to your default arena'),
      },
      // The snapshot is large and evolving, so it's returned as structuredContent
      // without a formal outputSchema rather than pinning a brittle shape here.
      annotations: READ_ONLY,
    },
    async ({ arenaId }) => {
      const arena = await ownedArena(user, arenaId);
      if (!arena) return fail('No such arena, or it is not yours.');
      const env = await environmentService.get(arena);
      const members = await arenaMemberService.getForArena(arena.getId());
      return ok(await buildArenaStatus(env, members));
    }
  );

  server.registerTool(
    'match_summary',
    {
      title: 'Match summary',
      description:
        'Outcome-oriented summary of an arena: a leaderboard ranked by who is ' +
        'winning/won, the resolved winner, per-bot aggregated stats (shots, ' +
        'accuracy, damage taken, distance, collisions), survival (tanks alive, ' +
        'total health), and elimination order. Complements arena_status (which is ' +
        'the raw per-tank snapshot); this is the "who won and how" view and is ' +
        'most useful once the match is decided (`match.decided`). A match is ' +
        'decided when at most one bot still has living tanks. Omit arenaId for ' +
        'your default arena.',
      inputSchema: {
        arenaId: z
          .string()
          .optional()
          .describe('Arena id; defaults to your default arena'),
      },
      // Like arena_status: the shape is broad and evolving, so it is returned as
      // structuredContent without pinning a brittle outputSchema.
      annotations: READ_ONLY,
    },
    async ({ arenaId }) => {
      const arena = await ownedArena(user, arenaId);
      if (!arena) return fail('No such arena, or it is not yours.');
      const env = await environmentService.get(arena);
      const members = await arenaMemberService.getForArena(arena.getId());
      return ok(await buildMatchSummary(env, members));
    }
  );

  server.registerTool(
    'add_bot_to_arena',
    {
      title: 'Add bot to arena',
      description: `Add one of your bots to an arena (max ${MAX_APPS_PER_ARENA + 1} bots). Omit arenaId for your default arena.`,
      inputSchema: {
        appId: z.string().describe('The bot (app) id'),
        arenaId: z
          .string()
          .optional()
          .describe('Arena id; defaults to your default arena'),
      },
      outputSchema: {
        appId: z.string(),
        arenaId: z.string(),
        added: z.boolean(),
      },
      annotations: WRITE,
    },
    async ({ appId, arenaId }) => {
      const botApp = await ownedApp(user, appId);
      if (!botApp) return fail('No such bot, or it is not yours.');
      const arena = await ownedArena(user, arenaId);
      if (!arena) return fail('No such arena, or it is not yours.');

      const members = await arenaMemberService.getForArena(arena.getId());
      if (members.length > MAX_APPS_PER_ARENA) {
        return fail('Arena is full.');
      }
      if (members.some((m) => m.getAppId() === appId)) {
        return fail('Bot is already in this arena.');
      }
      const env = await environmentService.get(arena);
      env.addApp(botApp);
      await arenaMemberService.create(arena.getId(), botApp.getId());
      return ok({ appId, arenaId: arena.getId(), added: true });
    }
  );

  server.registerTool(
    'remove_bot_from_arena',
    {
      title: 'Remove bot from arena',
      description:
        'Remove a bot from an arena. Omit arenaId for your default arena.',
      inputSchema: {
        appId: z.string().describe('The bot (app) id'),
        arenaId: z
          .string()
          .optional()
          .describe('Arena id; defaults to your default arena'),
      },
      outputSchema: {
        appId: z.string(),
        arenaId: z.string(),
        removed: z.boolean(),
      },
      annotations: IDEMPOTENT,
    },
    async ({ appId, arenaId }) => {
      const arena = await ownedArena(user, arenaId);
      if (!arena) return fail('No such arena, or it is not yours.');
      const members = await arenaMemberService.getForArena(arena.getId());
      const member = members.find((m) => m.getAppId() === appId);
      if (!member) return fail('Bot is not in this arena.');
      (await environmentService.getByArenaId(arena.getId()))?.removeApp(appId);
      await member.delete();
      return ok({ appId, arenaId: arena.getId(), removed: true });
    }
  );

  // ---- Arena run control ----

  const control = (
    name: string,
    title: string,
    description: string,
    action: (
      env: Awaited<ReturnType<typeof environmentService.get>>
    ) => unknown,
    annotations: Record<string, boolean> = {}
  ) =>
    server.registerTool(
      name,
      {
        title,
        description,
        inputSchema: {
          arenaId: z
            .string()
            .optional()
            .describe('Arena id; defaults to your default arena'),
        },
        outputSchema: { arenaId: z.string(), ok: z.boolean() },
        annotations: { openWorldHint: false, ...annotations },
      },
      async ({ arenaId }) => {
        const arena = await ownedArena(user, arenaId);
        if (!arena) return fail('No such arena, or it is not yours.');
        const env = await environmentService.get(arena);
        await action(env);
        return ok({ arenaId: arena.getId(), ok: true });
      }
    );

  // Pausing/resuming twice lands in the same state (idempotent); restart always
  // re-runs, so it is not.
  control(
    'pause_arena',
    'Pause arena',
    'Pause an arena’s simulation.',
    (env) => env.pause(),
    { idempotentHint: true }
  );
  control(
    'resume_arena',
    'Resume arena',
    'Resume a paused arena’s simulation.',
    (env) => env.resume(),
    { idempotentHint: true }
  );
  control(
    'restart_arena',
    'Restart arena',
    'Restart an arena: reset and re-run all of its bots, and start it running ' +
      '(a reset begins a fresh match, not a paused one).',
    async (env) => {
      await env.restart();
      env.resume();
    }
  );

  server.registerTool(
    'set_arena_speed',
    {
      title: 'Set arena speed',
      description:
        'Set an arena’s simulation speed. `speed` is a multiplier (1 = the ' +
        'default ~10 ticks/second); higher values run proportionally faster. ' +
        'Pass 0 or "max" to run unbounded — as fast as the bots can be driven. ' +
        'The simulation stays deterministic (bots make the same decisions) at ' +
        'any speed. Omit arenaId for your default arena.',
      inputSchema: {
        speed: z
          .union([z.number().nonnegative(), z.literal('max')])
          .describe('Speed multiplier (1 = default); 0 or "max" = unbounded'),
        arenaId: z
          .string()
          .optional()
          .describe('Arena id; defaults to your default arena'),
      },
    },
    async ({ speed, arenaId }) => {
      const arena = await ownedArena(user, arenaId);
      if (!arena) return fail('No such arena, or it is not yours.');
      const env = await environmentService.get(arena);
      env.setSpeed(speed === 'max' ? 0 : speed);
      return ok({
        arenaId: arena.getId(),
        speed: env.getSpeed(),
        tickMs: env.getTickMs(),
      });
    }
  );

  server.registerTool(
    'set_arena_seed',
    {
      title: 'Set arena seed',
      description:
        'Set an arena’s random seed. Fixing the seed makes the match setup — ' +
        'tank placement and starting orientations — reproducible: restart the ' +
        'arena after setting it to lay out an identical match. Combined with the ' +
        'deterministic simulation, this makes accelerated headless runs fully ' +
        'repeatable. Omit arenaId for your default arena.',
      inputSchema: {
        seed: z.number().int().describe('Integer seed for the arena PRNG'),
        arenaId: z
          .string()
          .optional()
          .describe('Arena id; defaults to your default arena'),
      },
    },
    async ({ seed, arenaId }) => {
      const arena = await ownedArena(user, arenaId);
      if (!arena) return fail('No such arena, or it is not yours.');
      const env = await environmentService.get(arena);
      env.setSeed(seed);
      return ok({ arenaId: arena.getId(), seed: env.getSeed() });
    }
  );

  server.registerTool(
    'run_match',
    {
      title: 'Run a match',
      description:
        'Run one match to a decision and return the outcome (winner + ' +
        'leaderboard). A blocking convenience for the manual set_seed → restart → ' +
        'resume → poll-match_summary loop: it optionally sets `seed` for a ' +
        'reproducible match, restarts the arena (re-firing every bot’s START), ' +
        'resumes it (restart alone silently leaves the arena PAUSED), runs it as ' +
        'fast as possible until at most one bot still has living tanks ' +
        '(match.decided), then pauses and returns the match_summary. Needs at ' +
        'least two active bots. Omit arenaId for your default arena.',
      inputSchema: {
        arenaId: z
          .string()
          .optional()
          .describe('Arena id; defaults to your default arena'),
        seed: z
          .number()
          .int()
          .optional()
          .describe(
            'Optional integer seed for a reproducible match (tank placement + orientations)'
          ),
        timeoutMs: z
          .number()
          .int()
          .positive()
          .optional()
          .describe(
            'Max wall-clock ms to wait for a decision (default 60000); returns the current summary flagged timedOut if exceeded'
          ),
      },
      // The summary shape is broad/evolving (same as match_summary), so it is
      // returned as structuredContent without pinning a brittle outputSchema.
      annotations: WRITE,
    },
    async ({ arenaId, seed, timeoutMs }) => {
      const arena = await ownedArena(user, arenaId);
      if (!arena) return fail('No such arena, or it is not yours.');
      const env = await environmentService.get(arena);
      const members = await arenaMemberService.getForArena(arena.getId());
      if (env.getProcesses().length < 2) {
        return fail('A match needs at least two active bots in the arena.');
      }
      const summary = await runMatchToDecision(env, members, {
        seed,
        timeoutMs,
      });
      return ok({ timedOut: !summary.match.decided, ...summary });
    }
  );

  server.registerTool(
    'run_tournament',
    {
      title: 'Run a tournament',
      description:
        'Battle-royale the arena’s current bots across a panel of N seeds and ' +
        'report an aggregate ranking — a best-of-N because outcomes are highly ' +
        'spawn-sensitive (the same near-mirror bots can flip 1st↔last between ' +
        'seeds), so a single match is not a trustworthy ranking. Runs one ' +
        'run_match per seed (each restarts the roster and runs to a decision), ' +
        'then ranks bots by total placement points (1st = N points … last = 1), ' +
        'tie-broken by wins then average finishing rank. Returns the ranking plus ' +
        'a per-seed breakdown. Needs at least two active bots. Omit arenaId for ' +
        'your default arena.',
      inputSchema: {
        arenaId: z
          .string()
          .optional()
          .describe('Arena id; defaults to your default arena'),
        seeds: z
          .array(z.number().int())
          .max(20)
          .optional()
          .describe(
            'The panel of integer seeds to run (one match each); defaults to [1,2,3,4,5]. Max 20.'
          ),
        timeoutMs: z
          .number()
          .int()
          .positive()
          .optional()
          .describe(
            'Max wall-clock ms to wait for each match to decide (default 60000)'
          ),
      },
      annotations: WRITE,
    },
    async ({ arenaId, seeds, timeoutMs }) => {
      const arena = await ownedArena(user, arenaId);
      if (!arena) return fail('No such arena, or it is not yours.');
      const env = await environmentService.get(arena);
      const members = await arenaMemberService.getForArena(arena.getId());
      if (env.getProcesses().length < 2) {
        return fail(
          'A tournament needs at least two active bots in the arena.'
        );
      }
      const panel = seeds && seeds.length > 0 ? seeds : [1, 2, 3, 4, 5];

      // Aggregate per-app placement points across the panel. Points for a match
      // of K apps: 1st = K, last = 1 — so consistently high placement wins even
      // without outright victories.
      const agg = new Map<
        string,
        {
          id: string;
          name?: string;
          wins: number;
          points: number;
          ranks: number[];
        }
      >();
      const matches: Array<Record<string, unknown>> = [];

      for (const seed of panel) {
        const summary = await runMatchToDecision(env, members, {
          seed,
          timeoutMs,
        });
        const board = summary.leaderboard;
        const k = board.length;
        for (const entry of board) {
          const a = agg.get(entry.id) ?? {
            id: entry.id,
            name: entry.name,
            wins: 0,
            points: 0,
            ranks: [],
          };
          a.name = entry.name;
          a.ranks.push(entry.rank);
          a.points += k - entry.rank + 1;
          if (summary.match.winner?.id === entry.id) a.wins += 1;
          agg.set(entry.id, a);
        }
        matches.push({
          seed,
          decided: summary.match.decided,
          winner: summary.match.winner,
          leaderboard: board.map((e) => ({
            rank: e.rank,
            id: e.id,
            name: e.name,
          })),
        });
      }

      const ranking = [...agg.values()]
        .map((a) => ({
          id: a.id,
          name: a.name,
          wins: a.wins,
          points: a.points,
          avgRank: a.ranks.reduce((s, r) => s + r, 0) / a.ranks.length,
          matches: a.ranks.length,
        }))
        .sort(
          (x, y) =>
            y.points - x.points || y.wins - x.wins || x.avgRank - y.avgRank
        )
        .map((a, i) => ({ rank: i + 1, ...a }));

      return ok({
        arenaId: arena.getId(),
        seeds: panel,
        matchCount: panel.length,
        ranking,
        matches,
      });
    }
  );

  // ---- Observation ----

  server.registerTool(
    'recent_logs',
    {
      title: 'Recent bot logs',
      description:
        'Recent bot console output for an arena (oldest first). The live ' +
        'log stream is not replayable, so this returns a bounded buffer. Use the ' +
        'filters to narrow to one bot, a severity, or a substring. Omit arenaId ' +
        'for your default arena.',
      inputSchema: {
        arenaId: z
          .string()
          .optional()
          .describe('Arena id; defaults to your default arena'),
        limit: z
          .number()
          .int()
          .positive()
          .optional()
          .describe('Return only the most recent N matching entries'),
        minLevel: z
          .enum(['TRACE', 'DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL'])
          .optional()
          .describe('Only entries at this level or higher (e.g. ERROR)'),
        appId: z.string().optional().describe('Only entries from this bot'),
        tankIndex: z
          .number()
          .int()
          .positive()
          .optional()
          .describe('Only entries from this tank (1-based within the bot)'),
        contains: z
          .string()
          .optional()
          .describe('Only entries whose message contains this text'),
      },
      annotations: READ_ONLY,
    },
    async ({ arenaId, limit, minLevel, appId, tankIndex, contains }) => {
      const arena = await ownedArena(user, arenaId);
      if (!arena) return fail('No such arena, or it is not yours.');
      const env = await environmentService.getByArenaId(arena.getId());
      if (!env) return ok([]);
      const LEVELS: Record<string, number> = {
        TRACE: 10,
        DEBUG: 20,
        INFO: 30,
        WARN: 40,
        ERROR: 50,
        FATAL: 60,
      };
      const threshold = minLevel ? LEVELS[minLevel] : 0;
      let logs = env.getRecentLogs() as Array<Record<string, unknown>>;
      logs = logs.filter((entry) => {
        if (
          threshold &&
          typeof entry.level === 'number' &&
          entry.level < threshold
        )
          return false;
        if (appId && entry.appId !== appId) return false;
        if (tankIndex !== undefined && entry.tankIndex !== tankIndex)
          return false;
        if (contains && !String(entry.msg ?? '').includes(contains))
          return false;
        return true;
      });
      // Cap AFTER filtering so `limit` counts matching entries, not raw ones.
      return ok(limit ? logs.slice(-limit) : logs);
    }
  );

  server.registerTool(
    'recent_faults',
    {
      title: 'Recent bot faults',
      description:
        'Recent bot crashes for an arena (oldest first) as structured records: ' +
        'the error code, the fault kind, the message, and the failing line where ' +
        'the sandbox provided one. Richer and more reliable than grepping ' +
        'recent_logs — look codes up in robocodejs://reference/error-codes. Omit ' +
        'arenaId for your default arena.',
      inputSchema: {
        arenaId: z
          .string()
          .optional()
          .describe('Arena id; defaults to your default arena'),
        appId: z.string().optional().describe('Only faults from this bot'),
        limit: z
          .number()
          .int()
          .positive()
          .optional()
          .describe('Return only the most recent N faults'),
      },
      outputSchema: {
        faults: z.array(
          z.object({
            appId: z.string(),
            tankId: z.string(),
            tankIndex: z.number(),
            code: z.string(),
            kind: z.string(),
            message: z.string(),
            line: z.number().optional(),
            column: z.number().optional(),
            timedOut: z.boolean(),
            time: z.number(),
          })
        ),
      },
      annotations: READ_ONLY,
    },
    async ({ arenaId, appId, limit }) => {
      const arena = await ownedArena(user, arenaId);
      if (!arena) return fail('No such arena, or it is not yours.');
      const env = await environmentService.getByArenaId(arena.getId());
      return ok({ faults: env ? env.getRecentFaults(limit, appId) : [] });
    }
  );

  registerResources(server);
  registerPrompts(server);

  return server;
};

// Read-only reference material a model can pull into context before writing a
// bot: the authored API docs, the generated type definitions, and the sample
// bots. These are the same static files the UI serves; exposing them as MCP
// resources is the single biggest lever on generated-bot quality (otherwise the
// model has to guess the bot API). They are identical for every user, so they
// take no auth scoping.
const registerResources = (server: McpServer): void => {
  // Bot API documentation — robocodejs://docs/{slug} (slug = filename w/o .md).
  server.registerResource(
    'docs',
    new ResourceTemplate('robocodejs://docs/{slug}', {
      list: async () => ({
        resources: listPublic('docs', '.md').map((file) => {
          const slug = file.replace(/\.md$/, '');
          return {
            uri: `robocodejs://docs/${slug}`,
            name: slug,
            title: `Docs: ${slug}`,
            mimeType: 'text/markdown',
          };
        }),
      }),
    }),
    {
      title: 'Bot API documentation',
      description:
        'RobocodeJs bot-authoring docs (start with "dev" for the API reference).',
    },
    async (uri, { slug }) => {
      const text = readPublic('docs', `${slug}.md`);
      if (text === null) throw new Error(`Unknown doc: ${slug}`);
      return {
        contents: [{ uri: uri.href, mimeType: 'text/markdown', text }],
      };
    }
  );

  // Sample bots — robocodejs://samples/{name} (name = filename w/o .js).
  server.registerResource(
    'samples',
    new ResourceTemplate('robocodejs://samples/{name}', {
      list: async () => ({
        resources: listPublic('samples', '.js').map((file) => {
          const name = file.replace(/\.js$/, '');
          return {
            uri: `robocodejs://samples/${name}`,
            name,
            title: `Sample bot: ${name}`,
            mimeType: 'text/javascript',
          };
        }),
      }),
    }),
    {
      title: 'Sample bots',
      description: 'Working example bots to learn the API and patterns from.',
    },
    async (uri, { name }) => {
      const text = readPublic('samples', `${name}.js`);
      if (text === null) throw new Error(`Unknown sample: ${name}`);
      return {
        contents: [{ uri: uri.href, mimeType: 'text/javascript', text }],
      };
    }
  );

  // The generated TypeScript definitions — the exact bot API contract.
  server.registerResource(
    'types',
    'robocodejs://types/robocode.d.ts',
    {
      title: 'Bot API type definitions',
      description:
        'Generated robocode.d.ts — the authoritative type signatures for the ' +
        'bot API (bot, arena, clock, events).',
      mimeType: 'text/plain',
    },
    async (uri) => {
      const text = readPublic('ts', 'robocode.d.ts');
      if (text === null) throw new Error('Type definitions are unavailable.');
      return { contents: [{ uri: uri.href, mimeType: 'text/plain', text }] };
    }
  );

  // The E0xx/W0xx error-code reference — lets the model interpret the codes that
  // show up in recent_logs and check_bot_source results.
  server.registerResource(
    'error-codes',
    'robocodejs://reference/error-codes',
    {
      title: 'Bot error-code reference',
      description:
        'The E0xx/W0xx codes that appear in a bot’s console logs and dry-run ' +
        'results, with human descriptions — use it to interpret recent_logs and ' +
        'check_bot_source output.',
      mimeType: 'text/markdown',
    },
    async (uri) => {
      const text = readPublic('docs', 'error-codes.md');
      if (text === null)
        throw new Error('Error-code reference is unavailable.');
      return {
        contents: [{ uri: uri.href, mimeType: 'text/markdown', text }],
      };
    }
  );
};

// Reusable, parameterized workflows surfaced to the client (slash-command style).
// Each one tells the model how to choreograph the resources + tools for a common
// task, so a user doesn't have to spell out the steps.
const registerPrompts = (server: McpServer): void => {
  server.registerPrompt(
    'write_bot',
    {
      title: 'Write a bot',
      description:
        'Design and create a new bot for a goal, grounded in the real API.',
      argsSchema: {
        goal: z
          .string()
          .describe('What the bot should do, e.g. "circle and snipe"'),
        arenaId: z
          .string()
          .optional()
          .describe('Arena to drop it into; defaults to your default arena'),
      },
    },
    ({ goal, arenaId }) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text:
              `Write a RobocodeJs bot with this goal: ${goal}\n\n` +
              `First read the resource robocodejs://docs/dev (the API reference) ` +
              `and robocodejs://types/robocode.d.ts (the exact signatures), and ` +
              `skim a relevant sample under robocodejs://samples/. Then:\n` +
              `1. create_bot (give it a descriptive name and the initial source).\n` +
              `2. add_bot_to_arena${arenaId ? ` (arenaId ${arenaId})` : ''} and ` +
              `restart_arena.\n` +
              `3. Check arena_status and recent_logs; iterate with set_bot_source ` +
              `+ reboot_bot until it behaves. Keep the code idiomatic to the docs.`,
          },
        },
      ],
    })
  );

  server.registerPrompt(
    'debug_bot',
    {
      title: 'Debug a bot',
      description:
        'Diagnose why a bot misbehaves or crashes and propose a fix.',
      argsSchema: {
        appId: z.string().describe('The bot (app) id to debug'),
        arenaId: z
          .string()
          .optional()
          .describe('Arena to inspect; defaults to your default arena'),
      },
    },
    ({ appId, arenaId }) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text:
              `Debug RobocodeJs bot ${appId}.\n\n` +
              `Read its current source (get_bot_source), then recent_faults` +
              `${arenaId ? ` (arenaId ${arenaId})` : ''} for structured crash ` +
              `records (code, kind, message, line) — if it crashed, this is the ` +
              `fastest signal. Also read recent_logs and arena_status to see ` +
              `how it's behaving and any E0xx/W0xx error codes (look them up in ` +
              `robocodejs://reference/error-codes). Cross-reference the API at ` +
              `robocodejs://docs/dev and the signatures at ` +
              `robocodejs://types/robocode.d.ts. Explain the root cause, then fix ` +
              `it with set_bot_source and reboot_bot, and confirm via recent_logs. ` +
              `Validate fixes with check_bot_source before deploying.`,
          },
        },
      ],
    })
  );

  server.registerPrompt(
    'run_match',
    {
      title: 'Run a match',
      description: 'Set up and run a battle, then report the outcome.',
      argsSchema: {
        arenaId: z
          .string()
          .optional()
          .describe('Arena to run in; defaults to your default arena'),
      },
    },
    ({ arenaId }) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text:
              `Run a RobocodeJs match` +
              `${arenaId ? ` in arena ${arenaId}` : ''}.\n\n` +
              `Use list_bots and arena_status to see what's available; make sure ` +
              `at least two bots are in the arena (add_bot_to_arena as needed). ` +
              `restart_arena to begin, then poll arena_status to follow the ` +
              `battle, and report the result (who survived / had the most health) ` +
              `along with anything notable from recent_logs.`,
          },
        },
      ],
    })
  );
};

// Resolve the acting user for an MCP request. In local dev, auth is bypassed and
// every request acts as the fixed "Local Dev" user (token-free connect). In
// production, the SDK's requireBearerAuth verifies the OAuth access token against
// our provider (emitting a spec-compliant 401 + WWW-Authenticate pointing at the
// protected-resource metadata when it's missing/invalid), then we resolve the
// user carried in the token's `extra.userId`.
const resourceMetadataUrl = getOAuthProtectedResourceMetadataUrl(RESOURCE_URL);
const bearer = requireBearerAuth({ verifier: provider, resourceMetadataUrl });

const mcpAuth: express.RequestHandler = (req, res, next) => {
  if (isLocalDev && process.env.NODE_ENV !== 'production') {
    ensureDevUser()
      .then((user) => {
        (req as AuthenticatedRequest).user = user;
        next();
      })
      .catch(() => res.status(401).send('Access forbidden'));
    return;
  }
  // requireBearerAuth sets req.auth (AuthInfo) on success, or answers 401 itself.
  bearer(req, res, () => {
    const userId = (
      req as unknown as { auth?: { extra?: { userId?: string } } }
    ).auth?.extra?.userId;
    (userId ? userService.get(userId) : Promise.resolve(undefined))
      .then((user) => {
        if (!user) {
          res.status(401).send('Access forbidden');
          return;
        }
        (req as AuthenticatedRequest).user = user;
        next();
      })
      .catch(() => res.status(500).send('Internal server error'));
  });
};

// MCP over Streamable HTTP, mounted in-process and gated by mcpAuth so the OAuth
// access token resolves the acting user. Stateless: a fresh server + transport
// per request (auth is per-request and the tools hold no session state), torn
// down when the response closes.
// Audit-log MCP tool invocations (event="mcp.tool") from the JSON-RPC request
// body, so a log pipeline can attribute actions to a user and flag abuse — an
// MCP bearer token grants full control of that user's bots and arenas. Only
// `tools/call` messages are logged (one per call; a batched request is an array);
// the token itself is never logged. Exported for direct unit testing.
export const logMcpRequest = (userId: string, body: unknown): void => {
  const messages = Array.isArray(body) ? body : [body];
  for (const message of messages) {
    const rpc = message as { method?: string; params?: { name?: string } };
    if (rpc?.method === 'tools/call' && rpc.params?.name) {
      logger.info(
        { event: LogEvent.MCP_TOOL, userId, tool: rpc.params.name },
        `mcp tool ${rpc.params.name}`
      );
    }
  }
};

app.post('/api/mcp', mcpAuth, async (req, res) => {
  const user = (req as AuthenticatedRequest).user;
  logMcpRequest(user.getId(), req.body);
  const server = buildServer(user);
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });
  res.on('close', () => {
    transport.close();
    server.close();
  });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err: unknown) {
    logger.error(
      { err: err instanceof Error ? err.message : String(err) },
      'mcp: request handling failed'
    );
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: '2.0',
        error: { code: -32603, message: 'Internal server error' },
        id: null,
      });
    }
  }
});

// Stateless mode does not use server-initiated GET (SSE) or DELETE (session
// teardown) streams; answer them per the MCP spec.
const methodNotAllowed = (_req: express.Request, res: express.Response) => {
  res.status(405).json({
    jsonrpc: '2.0',
    error: { code: -32000, message: 'Method not allowed.' },
    id: null,
  });
};
app.get('/api/mcp', mcpAuth, methodNotAllowed);
app.delete('/api/mcp', mcpAuth, methodNotAllowed);

export default app;
