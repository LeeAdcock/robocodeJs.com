import pino from 'pino';
import { isLocalDev } from './devMode';

// The server's structured application logger (distinct from the per-bot bot
// `console` output, which is streamed to the UI via browser-bunyan). Emits JSON
// in production for ingestion by a log pipeline; pretty, human-readable lines in
// local dev; and is silenced under test to keep the suite output clean.
// Level is overridable via LOG_LEVEL.
const level =
  process.env.LOG_LEVEL ||
  (process.env.NODE_ENV === 'test' ? 'silent' : isLocalDev ? 'debug' : 'info');

export const logger = pino(
  isLocalDev
    ? {
        level,
        transport: {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'HH:MM:ss' },
        },
      }
    : { level }
);

// Stable `event` names for the fault/security conditions worth monitoring or
// alerting on. Logging these as a consistent field lets a log pipeline alert on
// e.g. event="bot.fault" timedOut=true (possible runaway/abuse) or rate spikes
// in event="auth.failed".
export const LogEvent = {
  BOT_FAULT: 'bot.fault', // bot crashed (compile/run/handler/timer/timeout)
  SANDBOX_CATASTROPHIC: 'sandbox.catastrophic', // isolate OOM / fatal V8 error
  AUTH_FAILED: 'auth.failed', // invalid/expired credential
  AUTH_FORBIDDEN: 'auth.forbidden', // authenticated user acting on another's resource
  AUTH_SIGNIN: 'auth.signin', // successful Google sign-in (session established)
  AUTH_TOKEN_CREATED: 'auth.token.created', // API token minted/rotated
  AUTH_TOKEN_REVOKED: 'auth.token.revoked', // API token removed
  RATE_LIMITED: 'rate.limited', // request refused by a rate limiter (429/E022)
  MCP_TOOL: 'mcp.tool', // an MCP tool was invoked (audit trail; token = full control)
  MCP_TOOL_RESULT: 'mcp.tool.result', // an MCP tool finished (outcome + durationMs; diagnostics)
  MCP_MATCH: 'mcp.match', // a run_match match decided (per-match outcome)
  HTTP_ERROR: 'http.error', // unhandled error -> 5xx
  DB_ERROR: 'db.error', // database/pool error
  PROCESS_FATAL: 'process.fatal', // uncaught exception / unhandled rejection
  SHUTDOWN: 'process.shutdown', // graceful shutdown (SIGTERM/SIGINT) lifecycle
  METRICS: 'metrics', // periodic operational gauges heartbeat (time-series/alerting)
  LADDER_MATCH: 'ladder.match', // a global-ladder ranked match completed (GitHub #151)
  ACHIEVEMENT_UNLOCKED: 'achievement.unlocked', // a user earned one or more badges (GitHub #121)
} as const;

// Log a bot fault uniformly. `kind` says where it happened (compile/run/handler/
// timer); `timedOut` is derived from the error so a runaway or sandbox-escape
// attempt that trips the execution timeout can be alerted on specifically.
export function logBotFault(
  ctx: { appId?: string; arenaId?: string; botId?: string },
  kind: string,
  err: unknown
) {
  const message = err instanceof Error ? err.message : String(err);
  const timedOut = /timed out|timeout/i.test(message);
  logger.warn(
    { event: LogEvent.BOT_FAULT, kind, timedOut, ...ctx, err: message },
    `bot ${kind} fault${timedOut ? ' (sandbox timeout)' : ''}`
  );
}
