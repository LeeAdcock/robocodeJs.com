import express from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';

import auth, { AuthenticatedRequest } from '../middleware/auth';
import User from '../types/user';
import Arena from '../types/arena';
import TankApp from '../types/app';
import appService from '../services/AppService';
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
import { logger } from '../util/logger';

const app = express();

// Caps mirrored from the REST API (api/arena.ts) so the MCP tools enforce the
// same limits. Kept in sync by hand; both bound the in-memory EnvironmentService.
const MAX_ARENAS_PER_USER = 10;
const MAX_APPS_PER_ARENA = 4;

type ToolResult = {
  content: { type: 'text'; text: string }[];
  isError?: boolean;
};

const ok = (data: unknown): ToolResult => ({
  content: [
    {
      type: 'text',
      text: typeof data === 'string' ? data : JSON.stringify(data, null, 2),
    },
  ],
});

const fail = (message: string): ToolResult => ({
  content: [{ type: 'text', text: message }],
  isError: true,
});

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
    },
    async ({ appId }) => {
      const app = await ownedApp(user, appId);
      if (!app) return fail('No such bot, or it is not yours.');
      return ok(app.getSource());
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
    },
    async ({ appId }) => {
      const app = await ownedApp(user, appId);
      if (!app) return fail('No such bot, or it is not yours.');
      await executeInUserArenas(user.getId(), app.getId());
      return ok({ appId, compiled: true });
    }
  );

  server.registerTool(
    'reboot_bot',
    {
      title: 'Reboot bot',
      description:
        'Reload a bot and re-fire its START handler in each of your live arenas.',
      inputSchema: { appId: z.string().describe('The bot (app) id') },
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
    action: (env: Awaited<ReturnType<typeof environmentService.get>>) => unknown
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
      },
      async ({ arenaId }) => {
        const arena = await ownedArena(user, arenaId);
        if (!arena) return fail('No such arena, or it is not yours.');
        const env = await environmentService.get(arena);
        await action(env);
        return ok({ arenaId: arena.getId(), ok: true });
      }
    );

  control('pause_arena', 'Pause arena', 'Pause an arena’s simulation.', (env) =>
    env.pause()
  );
  control(
    'resume_arena',
    'Resume arena',
    'Resume a paused arena’s simulation.',
    (env) => env.resume()
  );
  control(
    'restart_arena',
    'Restart arena',
    'Restart an arena: reset and re-run all of its bots.',
    (env) => env.restart()
  );

  // ---- Observation ----

  server.registerTool(
    'recent_logs',
    {
      title: 'Recent bot logs',
      description:
        'Recent bot console output for an arena (oldest first). The live ' +
        'log stream is not replayable, so this returns a bounded buffer. ' +
        'Omit arenaId for your default arena.',
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
          .describe('Return only the most recent N entries'),
      },
    },
    async ({ arenaId, limit }) => {
      const arena = await ownedArena(user, arenaId);
      if (!arena) return fail('No such arena, or it is not yours.');
      const env = await environmentService.getByArenaId(arena.getId());
      if (!env) return ok([]);
      return ok(env.getRecentLogs(limit));
    }
  );

  return server;
};

// MCP over Streamable HTTP, mounted in-process and gated by auth(true) so the
// bearer token resolves the acting user. Stateless: a fresh server + transport
// per request (auth is per-request and the tools hold no session state), torn
// down when the response closes.
app.post('/api/mcp', auth(true), async (req, res) => {
  const user = (req as AuthenticatedRequest).user;
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
app.get('/api/mcp', auth(true), methodNotAllowed);
app.delete('/api/mcp', auth(true), methodNotAllowed);

export default app;
