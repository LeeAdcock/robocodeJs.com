import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import {
  McpServer,
  ResourceTemplate,
} from '@modelcontextprotocol/sdk/server/mcp.js';
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

// The built static assets (bot API docs, type definitions, sample bots) that the
// UI serves and that we also expose as MCP resources, so a model can read the
// real API before writing a bot. Resolved relative to this compiled module
// (dist/src/api → dist/public) so it works regardless of the process cwd, the
// same way index.ts locates the SPA shell.
const PUBLIC_DIR = path.join(__dirname, '../../public');

// List files in a public subdirectory with the given extension (basename only).
// Returns [] if the directory is absent (e.g. running from source in tests).
const listPublic = (sub: string, ext: string): string[] => {
  try {
    return fs
      .readdirSync(path.join(PUBLIC_DIR, sub))
      .filter((f) => f.endsWith(ext))
      .sort();
  } catch {
    return [];
  }
};

// Read one public file, guarding against path traversal by reducing the name to
// its basename before joining. Returns null if it can't be read.
const readPublic = (sub: string, filename: string): string | null => {
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
              `Read its current source (get_bot_source), then recent_logs` +
              `${arenaId ? ` (arenaId ${arenaId})` : ''} and arena_status to see ` +
              `how it's behaving and any E0xx/W0xx error codes. Cross-reference ` +
              `the API at robocodejs://docs/dev and the signatures at ` +
              `robocodejs://types/robocode.d.ts. Explain the root cause, then fix ` +
              `it with set_bot_source and reboot_bot, and confirm via recent_logs.`,
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
