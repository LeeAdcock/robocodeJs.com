import * as vscode from 'vscode';

import { RobocodeAuth, SignInRequiredError } from './auth';
import { RobocodeClient } from './client';
import { formatLogLine, isErrorLevel, LogEntry } from './logFormat';
import { Fault, faultKey } from './problems';
import { SseParser } from './sse';

// The server predates the bearer log route (it shipped with this feature), so
// retrying can never succeed. Not worth a popup — the rest of the extension
// works — just stop and say so in the extension's own log.
class LogsUnsupportedError extends Error {}

const MIN_RETRY_MS = 2_000;
const MAX_RETRY_MS = 30_000;
// Crashes log at ERROR; give the fault feed a moment to record them all (five
// bots tend to crash together) before fetching it.
const FAULT_CHECK_DELAY_MS = 750;
// Not every recorded fault arrives with an ERROR line on the stream, so also
// check on a slow timer. Two calls a minute against the 60/min MCP budget.
const FAULT_POLL_MS = 30_000;

// Tails the default arena's bot console output into an output channel, and
// reports new runtime crashes as they happen. One long-lived SSE connection to
// GET /api/mcp/arenas/:arenaId/logs, reconnecting with backoff. The server
// replays its recent-logs buffer on every connect; entry ids increase
// monotonically within an arena, so a reconnect only prints what's new.
export class BotLogs implements vscode.Disposable {
  private readonly channel = vscode.window.createOutputChannel(
    'RobocodeJs Bot Logs'
  );
  private running = false;
  // Bumped by every start/stop, so a reconnect loop left over from an earlier
  // start (stop then start in quick succession) notices and exits.
  private generation = 0;
  private abort: AbortController | undefined;
  private arenaId: string | undefined;
  private lastId = 0;
  private readonly seenFaults = new Set<string>();
  private faultTimer: NodeJS.Timeout | undefined;
  private faultPoll: NodeJS.Timeout | undefined;

  constructor(
    private readonly client: RobocodeClient,
    private readonly auth: RobocodeAuth,
    private readonly appName: (appId: string) => string | undefined,
    private readonly onFaults: (faults: Fault[]) => void,
    private readonly log: (line: string) => void
  ) {}

  show(): void {
    this.channel.show(true);
    void this.start();
  }

  // Idempotent: called whenever the user starts working on an app.
  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      this.arenaId = (await this.client.defaultArena()).arenaId;
      // Crashes from before we connected may be from code that has since
      // changed, so they're the baseline rather than news.
      for (const f of await this.client.recentFaults(this.arenaId))
        this.seenFaults.add(faultKey(f));
    } catch (err) {
      this.running = false;
      throw err;
    }
    void this.loop(++this.generation);
    this.faultPoll = setInterval(() => {
      if (vscode.window.state.focused) void this.checkFaults();
    }, FAULT_POLL_MS);
  }

  stop(): void {
    this.running = false;
    this.generation++;
    this.abort?.abort();
    clearTimeout(this.faultTimer);
    this.faultTimer = undefined;
    clearInterval(this.faultPoll);
    this.faultPoll = undefined;
    this.arenaId = undefined;
    this.lastId = 0;
    this.seenFaults.clear();
  }

  dispose(): void {
    this.stop();
    this.channel.dispose();
  }

  private async loop(generation: number): Promise<void> {
    let retryMs = MIN_RETRY_MS;
    const current = () => this.running && generation === this.generation;
    while (current()) {
      const startedAt = Date.now();
      try {
        await this.connectOnce();
      } catch (err) {
        if (!current()) return;
        if (err instanceof SignInRequiredError) {
          this.log('bot logs: sign-in required; stopped');
          this.stop();
          return;
        }
        if (err instanceof LogsUnsupportedError) {
          this.channel.appendLine(
            'Live bot logs need a newer RobocodeJs server than this one.'
          );
          this.log('bot logs: server has no log stream route; stopped');
          this.stop();
          return;
        }
        this.log(
          `bot logs: ${err instanceof Error ? err.message : String(err)}`
        );
      }
      // A connection that stayed up a while was healthy; start backoff over.
      if (Date.now() - startedAt > MAX_RETRY_MS) retryMs = MIN_RETRY_MS;
      await new Promise((r) => setTimeout(r, retryMs));
      retryMs = Math.min(retryMs * 2, MAX_RETRY_MS);
    }
  }

  private async connectOnce(): Promise<void> {
    const arenaId = this.arenaId;
    if (!arenaId) return;
    const res = await this.open(arenaId);
    if (!res.body) throw new Error('log stream had no body');
    const parser = new SseParser();
    const decoder = new TextDecoder();
    const reader = res.body.getReader();
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return;
      for (const data of parser.feed(decoder.decode(value, { stream: true })))
        this.handle(data);
    }
  }

  private async open(arenaId: string): Promise<Response> {
    for (let attempt = 0; ; attempt++) {
      this.abort = new AbortController();
      const token = (await this.auth.tokens())?.access_token;
      const res = await fetch(this.client.logsUrl(arenaId), {
        headers: {
          accept: 'text/event-stream',
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        signal: this.abort.signal,
      });
      if (res.status !== 401 || attempt > 0) {
        // A server without the route falls through to the website's SPA
        // fallback, which answers the HTML shell (200) rather than a 404. A
        // missing arena on a current server is a JSON 404 instead.
        const type = res.headers.get('content-type') ?? '';
        if (
          (res.ok && !type.includes('text/event-stream')) ||
          (res.status === 404 && !type.includes('json'))
        ) {
          await res.body?.cancel();
          throw new LogsUnsupportedError();
        }
        if (!res.ok) throw new Error(`log stream answered ${res.status}`);
        return res;
      }
      // The access token expired. Any MCP call makes the SDK refresh it
      // (or throws SignInRequiredError if the grant is gone); then retry once.
      await res.body?.cancel();
      await this.client.listArenas();
    }
  }

  private handle(data: string): void {
    let entry: LogEntry;
    try {
      entry = JSON.parse(data) as LogEntry;
    } catch {
      return;
    }
    if (typeof entry.id !== 'number' || entry.id <= this.lastId) return;
    this.lastId = entry.id;
    this.channel.appendLine(
      formatLogLine(entry, entry.appId ? this.appName(entry.appId) : undefined)
    );
    if (isErrorLevel(entry.level)) this.scheduleFaultCheck();
  }

  private scheduleFaultCheck(): void {
    if (this.faultTimer) return;
    this.faultTimer = setTimeout(() => {
      this.faultTimer = undefined;
      void this.checkFaults();
    }, FAULT_CHECK_DELAY_MS);
  }

  private async checkFaults(): Promise<void> {
    const arenaId = this.arenaId;
    if (!arenaId) return;
    try {
      const fresh = (await this.client.recentFaults(arenaId)).filter((f) => {
        const key = faultKey(f);
        if (this.seenFaults.has(key)) return false;
        this.seenFaults.add(key);
        return true;
      });
      if (fresh.length) this.onFaults(fresh);
    } catch (err) {
      this.log(
        `bot logs: fault check failed: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }
}
