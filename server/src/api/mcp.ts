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
import { mcpRateLimit } from '../middleware/rateLimit';
import { isLocalDev } from '../util/devMode';
import userService from '../services/UserService';
import { provider, RESOURCE_URL } from './oauth';
import User from '../types/user';
import Arena from '../types/arena';
import App from '../types/app';
import appService from '../services/AppService';
import formatter from '../util/formatter';
import arenaService from '../services/ArenaService';
import arenaMemberService from '../services/ArenaMemberService';
import environmentService from '../services/EnvironmentService';
import {
  propagateSource,
  checkSource,
  executeInUserArenas,
  rebootInUserArenas,
  deleteAppEverywhere,
  sourceSizeError,
} from '../util/botActions';
import { buildArenaStatus } from '../util/arenaStatus';
import { buildMatchSummary, buildMatchStatus } from '../util/matchSummary';
import { runMatchToDecision, ArenaBusyError } from '../util/runMatch';
import { sanitizeBotName } from '../util/botName';
import { isNameProfane } from '../util/nameFilter';
import { logger, LogEvent } from '../util/logger';
import { VERSION } from '../util/version';
import { collectMetrics } from '../util/metrics';

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

// A registered tool's handler. The MCP SDK passes (args, extra); we only need to
// time it and inspect its ToolResult, so the argument list is left open.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ToolHandler = (...args: any[]) => Promise<ToolResult> | ToolResult;

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
// from touching another user's app (the MCP equivalent of requireOwner).
const ownedApp = async (user: User, appId: string): Promise<App | null> => {
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

// Read-only spectating: resolve an arena by id WITHOUT requiring ownership, so
// the view tools (arena_status/match_summary/match_status) can watch any arena
// whose id the caller has — the MCP counterpart of the public REST route
// GET /api/arena/:arenaId and the /watch share link. Omitting arenaId still
// targets the caller's own default arena. Write/control tools keep using
// ownedArena, so only the owner can pause, restart, change speed/seed, or edit
// the roster. A malformed id (which the DB rejects) resolves to null → a clean
// "no such arena" rather than a thrown error.
const readableArena = async (
  user: User,
  arenaId?: string
): Promise<Arena | null> => {
  if (arenaId) {
    try {
      return (await arenaService.get(arenaId)) ?? null;
    } catch {
      return null;
    }
  }
  return arenaService.getDefaultForUser(user.getId());
};

// The run_match tool drives a match with the shared runMatchToDecision helper
// (util/runMatch.ts), which the global ladder uses too so both decide a match
// identically.

// Log one decided (or timed-out) match from run_match, mirroring the global
// ladder's per-match line (event=ladder.match). Without this the logs showed only
// a single tool-level result, so a match that timed out or produced a surprising
// winner was invisible.
const logMatch = (
  context: 'run_match',
  arenaId: string,
  seed: number | undefined,
  durationMs: number,
  summary: Awaited<ReturnType<typeof runMatchToDecision>>
): void => {
  logger.info(
    {
      event: LogEvent.MCP_MATCH,
      context,
      arenaId,
      seed,
      decided: summary.match.decided,
      timedOut: !summary.match.decided,
      winnerId: summary.match.winner?.id ?? null,
      winnerName: summary.match.winner?.name ?? null,
      durationMs,
    },
    `mcp ${context} match ${summary.match.decided ? 'decided' : 'timed out'}`
  );
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

  // Completion logging for every tool. logMcpRequest already emits an
  // `event=mcp.tool` audit line BEFORE a tool runs; this wraps each handler to
  // also emit `event=mcp.tool.result` AFTER it settles, with the outcome
  // (ok/error), duration, and — on failure — the reason. Without it a tool that
  // threw, timed out, or returned the wrong thing left no server-side trace (the
  // MCP SDK turns a thrown handler into an isError result the client sees but we
  // never logged). A rejected handler is logged then re-thrown so the SDK still
  // reports the error to the client; an isError result is logged as ok=false.
  // Wrapping registerTool here covers every current and future tool uniformly.
  const rawRegister = server.registerTool.bind(server);
  server.registerTool = ((
    name: string,
    config: unknown,
    handler: ToolHandler
  ) =>
    rawRegister(
      name,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      config as any,
      async (...args: Parameters<ToolHandler>) => {
        const startedAt = Date.now();
        try {
          const result = await handler(...args);
          logger.info(
            {
              event: LogEvent.MCP_TOOL_RESULT,
              userId: user.getId(),
              tool: name,
              durationMs: Date.now() - startedAt,
              ok: !result?.isError,
              ...(result?.isError ? { error: result.content?.[0]?.text } : {}),
            },
            `mcp tool ${name} ${result?.isError ? 'failed' : 'ok'}`
          );
          return result;
        } catch (err) {
          logger.error(
            {
              event: LogEvent.MCP_TOOL_RESULT,
              userId: user.getId(),
              tool: name,
              durationMs: Date.now() - startedAt,
              ok: false,
              err: err instanceof Error ? err.message : String(err),
            },
            `mcp tool ${name} threw`
          );
          throw err;
        }
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    )) as any;

  // ---- Bots (apps) ----

  server.registerTool(
    'list_apps',
    {
      title: 'List apps',
      description:
        "List the authenticated user's apps (appId, name, and global-ladder rating).",
      inputSchema: {},
      annotations: READ_ONLY,
    },
    async () => {
      const apps = await appService.getForUser(user.getId());
      return ok(
        apps.map((a) => ({
          appId: a.getId(),
          name: a.getName(),
          rating: a.getRating(),
          ratingGames: a.getRatingGames(),
        }))
      );
    }
  );

  server.registerTool(
    'leaderboard',
    {
      title: 'Global leaderboard',
      description:
        'The global bot ladder: the top-rated bots across all users by Elo ' +
        '(bot name, owner, rating, games, win rate). Not user-scoped — public ' +
        "ranking data, no source. Only the calling user's own bots include an " +
        '`appId`; every row carries an opaque `id`.',
      inputSchema: {},
      annotations: READ_ONLY,
    },
    async () => {
      return ok(await appService.getLeaderboard(20, user.getId()));
    }
  );

  server.registerTool(
    'get_app_source',
    {
      title: 'Get app source',
      description: "Return an app's JavaScript source code.",
      inputSchema: { appId: z.string().describe('The app id') },
      annotations: READ_ONLY,
    },
    async ({ appId }) => {
      const app = await ownedApp(user, appId);
      if (!app) return fail('No such app, or it is not yours.');
      const source = app.getSource();
      // An empty string reads as ambiguous to a model (error? blank app?). Be
      // explicit that the app simply has no source yet.
      if (!source.trim()) {
        return ok(
          `This app ("${app.getName()}", ${appId}) has no source yet — it ` +
            'is empty. Add code with set_app_source.'
        );
      }
      return ok(source);
    }
  );

  server.registerTool(
    'create_app',
    {
      title: 'Create app',
      description:
        'Create a new app, optionally setting its name and initial source.',
      inputSchema: {
        name: z.string().optional().describe('Optional app name'),
        source: z
          .string()
          .optional()
          .describe('Optional initial JavaScript source'),
      },
      outputSchema: { appId: z.string(), name: z.string() },
      annotations: WRITE,
    },
    async ({ name, source }) => {
      // Reject an inappropriate name up front, before creating anything, so no
      // orphan app is left behind. App.setName is the authoritative gate; this
      // just turns its rejection into a clear tool error.
      if (name && isNameProfane(sanitizeBotName(name))) {
        return fail(
          'That name was rejected: it appears to contain inappropriate language.'
        );
      }
      if (source) {
        const tooLarge = sourceSizeError(source);
        if (tooLarge) return fail(tooLarge);
      }
      const app = await appService.create(user.getId());
      if (name) await app.setName(name);
      if (source) await app.setSource(source);
      return ok({ appId: app.getId(), name: app.getName() });
    }
  );

  server.registerTool(
    'set_app_source',
    {
      title: 'Set app source',
      description:
        "Replace an app's source. Live arenas it's in pick up the change " +
        '(without re-firing START — use reboot_app for that).',
      inputSchema: {
        appId: z.string().describe('The app id'),
        source: z.string().describe('New JavaScript source'),
      },
      outputSchema: { appId: z.string(), updated: z.boolean() },
      annotations: IDEMPOTENT,
    },
    async ({ appId, source }) => {
      const app = await ownedApp(user, appId);
      if (!app) return fail('No such app, or it is not yours.');
      const tooLarge = sourceSizeError(source);
      if (tooLarge) return fail(tooLarge);
      await propagateSource(app, source);
      return ok({ appId, updated: true });
    }
  );

  server.registerTool(
    'compile_app',
    {
      title: 'Compile app',
      description:
        "Re-run an app's current saved source in each of your live arenas. Does " +
        'NOT change the source (use set_app_source) and does NOT re-fire the ' +
        'START handler (use reboot_app).',
      inputSchema: { appId: z.string().describe('The app id') },
      outputSchema: { appId: z.string(), compiled: z.boolean() },
      annotations: WRITE,
    },
    async ({ appId }) => {
      const app = await ownedApp(user, appId);
      if (!app) return fail('No such app, or it is not yours.');
      await executeInUserArenas(user.getId(), app.getId());
      return ok({ appId, compiled: true });
    }
  );

  server.registerTool(
    'check_app_source',
    {
      title: 'Check app source',
      description:
        'Dry-run compile app source WITHOUT deploying it: loads the source in a ' +
        'throwaway sandbox and reports any syntax or load error (with its error ' +
        'code — see the robocodejs://reference/error-codes resource). Pass ' +
        '`source` to check arbitrary code before creating an app, or `appId` to ' +
        'check a saved app. A clean result is `{ valid: true }`.',
      inputSchema: {
        source: z.string().optional().describe('App source to check'),
        appId: z
          .string()
          .optional()
          .describe("A saved app to check (used when 'source' is omitted)"),
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
        if (!app) return fail('No such app, or it is not yours.');
        code = app.getSource();
      }
      return ok(await checkSource(user.getId(), code));
    }
  );

  server.registerTool(
    'format_app_source',
    {
      title: 'Format app source',
      description:
        "Pretty-print bot JavaScript in RobocodeJs's house style — the same " +
        'Prettier settings the in-app editor and pre-commit hook use (2-space ' +
        'indent, single quotes, semicolons, trailing commas). Pass `source` to ' +
        'format arbitrary code, or `appId` to format one of your saved apps. ' +
        'Returns the formatted text and whether it `changed`; it does NOT save ' +
        '— write the result back with set_app_source. Formatting is cosmetic ' +
        'only and never changes behaviour or fixes logic. Unparseable source ' +
        '(a syntax error) returns `{ ok: false }` with the parser message; ' +
        'validate with check_app_source. For the readability conventions to ' +
        'follow beyond formatting, read robocodejs://docs/code-style.',
      inputSchema: {
        source: z.string().optional().describe('App source to format'),
        appId: z
          .string()
          .optional()
          .describe("A saved app to format (used when 'source' is omitted)"),
      },
      outputSchema: {
        ok: z.boolean(),
        formatted: z.string().optional(),
        changed: z.boolean().optional(),
        message: z.string().optional(),
      },
      annotations: READ_ONLY,
    },
    async ({ source, appId }) => {
      let code = source;
      if (code === undefined) {
        if (!appId) return fail('Provide `source` or `appId`.');
        const app = await ownedApp(user, appId);
        if (!app) return fail('No such app, or it is not yours.');
        code = app.getSource();
      }
      const result = await formatter.format(code);
      if (!result.ok) {
        return fail(
          `Could not format the source: ${result.message}. It likely has a ` +
            'syntax error — validate it with check_app_source.'
        );
      }
      return ok(result);
    }
  );

  server.registerTool(
    'reboot_app',
    {
      title: 'Reboot app',
      description:
        'Reload an app and re-fire its START handler in each of your live arenas.',
      inputSchema: { appId: z.string().describe('The app id') },
      outputSchema: { appId: z.string(), rebooted: z.boolean() },
      annotations: WRITE,
    },
    async ({ appId }) => {
      const app = await ownedApp(user, appId);
      if (!app) return fail('No such app, or it is not yours.');
      await rebootInUserArenas(user.getId(), app.getId());
      return ok({ appId, rebooted: true });
    }
  );

  server.registerTool(
    'delete_app',
    {
      title: 'Delete app',
      description: 'Remove an app from every arena and delete it.',
      inputSchema: { appId: z.string().describe('The app id') },
      outputSchema: { appId: z.string(), deleted: z.boolean() },
      annotations: DESTRUCTIVE,
    },
    async ({ appId }) => {
      const app = await ownedApp(user, appId);
      if (!app) return fail('No such app, or it is not yours.');
      await deleteAppEverywhere(app);
      return ok({ appId, deleted: true });
    }
  );

  // ---- Arenas ----

  server.registerTool(
    'list_arenas',
    {
      title: 'List arenas',
      description: "List the authenticated user's arenas (arenaIds).",
      inputSchema: {},
      annotations: READ_ONLY,
    },
    async () => {
      const arenas = await arenaService.getForUser(user.getId());
      return ok(arenas.map((a) => ({ arenaId: a.getId() })));
    }
  );

  server.registerTool(
    'create_arena',
    {
      title: 'Create arena',
      description: `Create a new arena (up to ${MAX_ARENAS_PER_USER} per user).`,
      inputSchema: {},
      outputSchema: { arenaId: z.string() },
      annotations: WRITE,
    },
    async () => {
      const existing = await arenaService.getForUser(user.getId());
      if (existing.length >= MAX_ARENAS_PER_USER) {
        return fail(`Arena limit reached (${MAX_ARENAS_PER_USER}).`);
      }
      const arena = await arenaService.create(user.getId());
      return ok({ arenaId: arena.getId() });
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
        "app's bots (position, orientation, health, bullets). Read-only, so it " +
        "works for ANY arena id you have (spectate someone else's match via a " +
        'shared arena id), not just your own. Omit arenaId for your default arena.',
      inputSchema: {
        arenaId: z
          .string()
          .optional()
          .describe(
            'Arena id — yours or any arena you want to watch; defaults to your default arena'
          ),
      },
      // The snapshot is large and evolving, so it's returned as structuredContent
      // without a formal outputSchema rather than pinning a brittle shape here.
      annotations: READ_ONLY,
    },
    async ({ arenaId }) => {
      const arena = await readableArena(user, arenaId);
      if (!arena) return fail('No such arena.');
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
        'accuracy, damage taken, distance, collisions), survival (bots alive, ' +
        'total health), and elimination order. Complements arena_status (which is ' +
        'the raw per-bot snapshot); this is the "who won and how" view and is ' +
        'most useful once the match is decided (`match.decided`). A match is ' +
        'decided when at most one app still has living bots. Read-only, so it ' +
        'works for ANY arena id you have, not just your own. Omit arenaId for ' +
        'your default arena.',
      inputSchema: {
        arenaId: z
          .string()
          .optional()
          .describe(
            'Arena id — yours or any arena you want to watch; defaults to your default arena'
          ),
      },
      // Like arena_status: the shape is broad and evolving, so it is returned as
      // structuredContent without pinning a brittle outputSchema.
      annotations: READ_ONLY,
    },
    async ({ arenaId }) => {
      const arena = await readableArena(user, arenaId);
      if (!arena) return fail('No such arena.');
      const env = await environmentService.get(arena);
      const members = await arenaMemberService.getForArena(arena.getId());
      return ok(await buildMatchSummary(env, members));
    }
  );

  server.registerTool(
    'match_status',
    {
      title: 'Match status',
      description:
        'Lightweight, cheap-to-poll status of an arena: whether the match is ' +
        'decided (`match.decided`), the winner once it is, and a coarse ' +
        'standings list (each bot’s rank, bots alive, total health) — with NONE ' +
        'of match_summary’s per-bot stat blocks or arena_status’s per-bot ' +
        'positions. Use this to watch a running match ("is it decided yet / ' +
        'who’s ahead?") without pulling the large payloads; once decided, call ' +
        'match_summary for the full outcome + stats, or arena_status for exact ' +
        'bot positions. Read-only, so it works for ANY arena id you have, not ' +
        'just your own. Omit arenaId for your default arena.',
      inputSchema: {
        arenaId: z
          .string()
          .optional()
          .describe(
            'Arena id — yours or any arena you want to watch; defaults to your default arena'
          ),
      },
      annotations: READ_ONLY,
    },
    async ({ arenaId }) => {
      const arena = await readableArena(user, arenaId);
      if (!arena) return fail('No such arena.');
      const env = await environmentService.get(arena);
      const members = await arenaMemberService.getForArena(arena.getId());
      return ok(await buildMatchStatus(env, members));
    }
  );

  server.registerTool(
    'add_app_to_arena',
    {
      title: 'Add app to arena',
      description: `Add one of your apps to an arena (max ${MAX_APPS_PER_ARENA + 1} apps). Omit arenaId for your default arena.`,
      inputSchema: {
        appId: z.string().describe('The app id'),
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
      if (!botApp) return fail('No such app, or it is not yours.');
      const arena = await ownedArena(user, arenaId);
      if (!arena) return fail('No such arena, or it is not yours.');

      const members = await arenaMemberService.getForArena(arena.getId());
      // Total roster cap is MAX_APPS_PER_ARENA + 1: the guard permits adding
      // while the current count is <= MAX_APPS_PER_ARENA, so the last add lands
      // the (MAX_APPS_PER_ARENA + 1)-th app. Mirrors the REST cap in api/arena.ts.
      if (members.length > MAX_APPS_PER_ARENA) {
        return fail('Arena is full.');
      }
      if (members.some((m) => m.getAppId() === appId)) {
        return fail('App is already in this arena.');
      }
      const env = await environmentService.get(arena);
      env.addApp(botApp);
      await arenaMemberService.create(arena.getId(), botApp.getId());
      return ok({ appId, arenaId: arena.getId(), added: true });
    }
  );

  server.registerTool(
    'remove_app_from_arena',
    {
      title: 'Remove app from arena',
      description:
        'Remove an app from an arena. Omit arenaId for your default arena.',
      inputSchema: {
        appId: z.string().describe('The app id'),
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
      if (!member) return fail('App is not in this arena.');
      (await environmentService.getByArenaId(arena.getId()))?.removeApp(appId);
      await member.delete();
      return ok({ appId, arenaId: arena.getId(), removed: true });
    }
  );

  // ---- Arena run control ----

  // `resultKey` names the per-action boolean the tool returns (e.g. `paused`),
  // matching the verb-specific result convention the mutating app tools use
  // (`updated`/`compiled`/`added`) rather than a generic `ok`.
  const control = (
    name: string,
    title: string,
    description: string,
    resultKey: string,
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
        outputSchema: { arenaId: z.string(), [resultKey]: z.boolean() },
        annotations: { openWorldHint: false, ...annotations },
      },
      async ({ arenaId }) => {
        const arena = await ownedArena(user, arenaId);
        if (!arena) return fail('No such arena, or it is not yours.');
        const env = await environmentService.get(arena);
        await action(env);
        return ok({ arenaId: arena.getId(), [resultKey]: true });
      }
    );

  // Pausing/resuming twice lands in the same state (idempotent); restart always
  // re-runs, so it is not.
  control(
    'pause_arena',
    'Pause arena',
    'Pause an arena’s simulation.',
    'paused',
    (env) => env.pause(),
    { idempotentHint: true }
  );
  control(
    'resume_arena',
    'Resume arena',
    'Resume a paused arena’s simulation.',
    'resumed',
    (env) => env.resume(),
    { idempotentHint: true }
  );
  // restart_arena is its own tool (not via control()) so it can report the seed
  // the new match runs on. A pinned seed reproduces every restart; an unpinned
  // arena mints a fresh seed each restart — returning it lets a client reproduce
  // the match afterwards (set_arena_seed to that value), since the seed is
  // otherwise only broadcast on the SSE event stream the MCP transport can't see.
  server.registerTool(
    'restart_arena',
    {
      title: 'Restart arena',
      description:
        'Restart an arena: reset and re-run all of its bots, and start it ' +
        'running (a reset begins a fresh match, not a paused one). Returns the ' +
        'seed the new match runs on — pin it with set_arena_seed to reproduce ' +
        'this exact match. Omit arenaId for your default arena.',
      inputSchema: {
        arenaId: z
          .string()
          .optional()
          .describe('Arena id; defaults to your default arena'),
      },
      outputSchema: {
        arenaId: z.string(),
        restarted: z.boolean(),
        seed: z.number(),
      },
      annotations: { openWorldHint: false },
    },
    async ({ arenaId }) => {
      const arena = await ownedArena(user, arenaId);
      if (!arena) return fail('No such arena, or it is not yours.');
      const env = await environmentService.get(arena);
      await env.restart();
      env.resume();
      return ok({
        arenaId: arena.getId(),
        restarted: true,
        seed: env.getSeed(),
      });
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
      outputSchema: {
        arenaId: z.string(),
        speed: z.number(),
        tickMs: z.number(),
      },
      annotations: IDEMPOTENT,
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
        'bot placement and starting orientations — reproducible: restart the ' +
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
      outputSchema: { arenaId: z.string(), seed: z.number() },
      annotations: IDEMPOTENT,
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
        'fast as possible until at most one app still has living bots ' +
        '(match.decided), then pauses and returns the match_summary. Needs at ' +
        'least two apps in the arena. Omit arenaId for your default arena.',
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
            'Optional integer seed for a reproducible match (bot placement + orientations)'
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
        return fail('A match needs at least two apps in the arena.');
      }
      const startedAt = Date.now();
      let summary;
      try {
        summary = await runMatchToDecision(env, members, { seed, timeoutMs });
      } catch (err) {
        // Another match is already driving this arena — refuse cleanly rather
        // than corrupting the in-flight match.
        if (err instanceof ArenaBusyError) return fail(err.message);
        throw err;
      }
      logMatch(
        'run_match',
        arena.getId(),
        seed,
        Date.now() - startedAt,
        summary
      );
      return ok({ timedOut: !summary.match.decided, ...summary });
    }
  );

  // ---- Observation ----

  server.registerTool(
    'platform_status',
    {
      title: 'Platform status',
      description:
        'The RobocodeJs server’s health and live operational gauges — the same ' +
        'payload as the public /health endpoint. Platform-wide, not user-scoped ' +
        '(like `leaderboard`, it reports on the whole service). Fields:\n' +
        '- `status` — "ok" while the server is serving\n' +
        '- `version` — the deployed server build; use it to confirm a deploy landed\n' +
        '- `uptimeSec` — seconds since this instance started; resets on every ' +
        'deploy, so a small value can just mean "freshly deployed"\n' +
        '- `metrics.arenas` — arena environments held in memory right now, running ' +
        'or paused (each is disposed ~30 min after it stops)\n' +
        '- `metrics.runningArenas` — of those, how many are actively ticking\n' +
        '- `metrics.isolates` — total bot sandboxes live across all arenas (one ' +
        '8 MB V8 isolate per app); the main resource-pressure signal for the box\n' +
        '- `metrics.maxAvgTickMs` — the busiest arena’s average wall-clock time to ' +
        'compute one tick; single digits are healthy, a steadily rising value ' +
        'means an arena is struggling to keep up\n' +
        '- `metrics.rssMB` / `metrics.heapUsedMB` — the whole server process’s ' +
        'resident and heap memory, in MB, for this instance',
      inputSchema: {},
      annotations: READ_ONLY,
    },
    async () => {
      return ok({
        status: 'ok',
        version: VERSION,
        uptimeSec: Math.round(process.uptime()),
        metrics: collectMetrics(),
      });
    }
  );

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
        appId: z.string().optional().describe('Only entries from this app'),
        botIndex: z
          .number()
          .int()
          .positive()
          .optional()
          .describe(
            'Only entries from this bot instance (1-based within the app)'
          ),
        contains: z
          .string()
          .optional()
          .describe('Only entries whose message contains this text'),
      },
      annotations: READ_ONLY,
    },
    async ({ arenaId, limit, minLevel, appId, botIndex, contains }) => {
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
        if (botIndex !== undefined && entry.botIndex !== botIndex) return false;
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
        appId: z.string().optional().describe('Only faults from this app'),
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
            botId: z.string(),
            botIndex: z.number(),
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
      return ok({
        faults: env ? env.getRecentFaults(limit, appId) : [],
      });
    }
  );

  // The same reference material exposed via registerResources below, mirrored as
  // plain tools. Some MCP clients (notably Claude's connector) reliably consume
  // tools but have limited/spotty support for MCP resources — especially dynamic
  // ResourceTemplate ones — so these tools guarantee every client can read the
  // docs, samples, and type definitions. Ids use a canonical `<kind>/<name>`
  // scheme that maps cleanly onto the public subdirs.
  server.registerTool(
    'list_docs',
    {
      title: 'List reference docs',
      description:
        'Catalog of RobocodeJs bot-authoring reference material (API docs, ' +
        'sample bots, and the generated type definitions) to read with ' +
        'read_doc. This mirrors the MCP resources for clients that can’t read ' +
        'resources. Start with `docs/dev` (the API reference). Returns a list ' +
        'of { id, kind, title }; pass an id to read_doc to fetch its content.',
      inputSchema: {},
      annotations: READ_ONLY,
    },
    async () => {
      const entries: Array<{ id: string; kind: string; title: string }> = [
        ...listPublic('docs', '.md').map((file) => {
          const slug = file.replace(/\.md$/, '');
          return { id: `docs/${slug}`, kind: 'docs', title: `Docs: ${slug}` };
        }),
        ...listPublic('samples', '.js').map((file) => {
          const name = file.replace(/\.js$/, '');
          return {
            id: `samples/${name}`,
            kind: 'samples',
            title: `Sample bot: ${name}`,
          };
        }),
        {
          id: 'types/robocode.d.ts',
          kind: 'types',
          title: 'Bot API type definitions (robocode.d.ts)',
        },
      ];
      return ok(entries);
    }
  );

  server.registerTool(
    'read_doc',
    {
      title: 'Read a reference doc',
      description:
        'Read one piece of reference material by its id from list_docs (e.g. ' +
        '`docs/dev`, `samples/<name>`, or `types/robocode.d.ts`). Returns the ' +
        'raw markdown / JavaScript / TypeScript text. The tool fallback for the ' +
        'MCP resources, for clients that can’t read resources.',
      inputSchema: {
        id: z
          .string()
          .describe(
            'An id from list_docs, e.g. "docs/dev", "samples/<name>", or "types/robocode.d.ts"'
          ),
      },
      annotations: READ_ONLY,
    },
    async ({ id }) => {
      const slash = id.indexOf('/');
      const kind = slash === -1 ? id : id.slice(0, slash);
      const name = slash === -1 ? '' : id.slice(slash + 1);
      // Map the id's kind to a public subdir. Anything else is not a valid id.
      const sub = { docs: 'docs', samples: 'samples', types: 'ts' }[kind];
      if (!sub || !name) {
        return fail(
          `Unknown id "${id}". Use an id from list_docs, e.g. "docs/dev", ` +
            '"samples/<name>", or "types/robocode.d.ts".'
        );
      }
      // Build the filename per kind. readPublic reduces it to a basename and
      // allow-lists the subdir, so it is the traversal guard — don't join paths.
      let filename: string;
      if (kind === 'docs') filename = `${name}.md`;
      else if (kind === 'samples') filename = `${name}.js`;
      else filename = 'robocode.d.ts';
      if (!isAllowedSub(sub)) return fail(`Unknown id "${id}".`);
      const text = readPublic(sub, filename);
      if (text === null) {
        return fail(
          `Could not read "${id}". Use an id from list_docs, e.g. "docs/dev".`
        );
      }
      return ok(text);
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
  // show up in recent_logs and check_app_source results.
  server.registerResource(
    'error-codes',
    'robocodejs://reference/error-codes',
    {
      title: 'Bot error-code reference',
      description:
        'The E0xx/W0xx codes that appear in a bot’s console logs and dry-run ' +
        'results, with human descriptions — use it to interpret recent_logs and ' +
        'check_app_source output.',
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
    'write_app',
    {
      title: 'Write an app',
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
              `skim a relevant sample under robocodejs://samples/ (or, if your ` +
              `client can't read MCP resources, call list_docs then read_doc ` +
              `with ids docs/dev, types/robocode.d.ts, and a samples/<name>). ` +
              `Also read robocodejs://docs/code-style (read_doc id docs/code-style) ` +
              `and follow it: open with a header comment stating the strategy, ` +
              `name the tuning constants, pull tricky math into named helpers, and ` +
              `comment the "why" — write it so a human can get up to speed fast. ` +
              `Then:\n` +
              `1. format_app_source on your code, then create_app (descriptive name + ` +
              `the formatted source).\n` +
              `2. add_app_to_arena${arenaId ? ` (arenaId ${arenaId})` : ''} and ` +
              `restart_arena.\n` +
              `3. Check arena_status and recent_logs; iterate with set_app_source ` +
              `+ reboot_app until it behaves (run format_app_source before each save). ` +
              `Keep the code idiomatic to the docs and readable per docs/code-style.`,
          },
        },
      ],
    })
  );

  server.registerPrompt(
    'debug_app',
    {
      title: 'Debug an app',
      description:
        'Diagnose why a bot misbehaves or crashes and propose a fix.',
      argsSchema: {
        appId: z.string().describe('The app id to debug'),
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
              `Read its current source (get_app_source), then recent_faults` +
              `${arenaId ? ` (arenaId ${arenaId})` : ''} for structured crash ` +
              `records (code, kind, message, line) — if it crashed, this is the ` +
              `fastest signal. Also read recent_logs and arena_status to see ` +
              `how it's behaving and any E0xx/W0xx error codes (look them up in ` +
              `robocodejs://reference/error-codes, or read_doc with id ` +
              `docs/error-codes if your client can't read MCP resources). ` +
              `Cross-reference the API at robocodejs://docs/dev and the ` +
              `signatures at robocodejs://types/robocode.d.ts (or read_doc with ` +
              `ids docs/dev and types/robocode.d.ts). Explain the root cause, then fix ` +
              `it with set_app_source and reboot_app, and confirm via recent_logs. ` +
              `Validate fixes with check_app_source before deploying.`,
          },
        },
      ],
    })
  );

  server.registerPrompt(
    'play_match',
    {
      title: 'Play a match',
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
              `Use list_apps and arena_status to see what's available; make sure ` +
              `at least two bots are in the arena (add_app_to_arena as needed). ` +
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

// mcpRateLimit runs AFTER mcpAuth so req.user is populated and the limit keys
// per user (u:<id>) rather than falling back to IP — see rateLimit.ts.
app.post('/api/mcp', mcpAuth, mcpRateLimit, async (req, res) => {
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
