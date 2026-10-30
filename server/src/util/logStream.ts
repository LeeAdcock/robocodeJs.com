import type { Request, Response } from 'express';

import Arena from '../types/arena';
import environmentService from '../services/EnvironmentService';
import { openSseStream } from './sse';

// Stream an arena's bot console logs as SSE. Shared by the owner-gated REST
// route (GET /api/user/:userId/arena[s/:arenaId]/logs, cookie auth — the
// browser editor) and its MCP-resource counterpart (GET
// /api/mcp/arenas/:arenaId/logs, OAuth bearer — the VS Code extension), so the
// two can't drift. Callers must have already checked that the actor owns the
// arena: console output is the author's private debug channel.
export const streamArenaLogs = async (
  req: Request,
  res: Response,
  arena: Arena
): Promise<void> => {
  const stream = openSseStream(req, res);

  function listener(event: unknown) {
    stream.send(event);
  }

  const env = await environmentService.get(arena);
  // The live log stream is not replayable, so a page that opens mid-match would
  // otherwise start blank. Replay the recent-logs buffer first, then stream live.
  env.getRecentLogs().forEach((entry) => listener(entry));
  env.addListener('log', listener);

  req.on('close', () => {
    env.removeListener('log', listener);
    stream.close();
  });
};
