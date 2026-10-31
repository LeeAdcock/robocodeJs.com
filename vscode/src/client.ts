import * as vscode from 'vscode';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { UnauthorizedError } from '@modelcontextprotocol/sdk/client/auth.js';

import { RobocodeAuth, SignInRequiredError } from './auth';

export { SignInRequiredError };
export { SignInCancelledError } from './auth';
import { CheckResult, Fault } from './problems';

// One of the user's apps, as list_apps returns it.
export interface AppSummary {
  appId: string;
  name: string;
  version: string;
  rating: number;
  ratingGames: number;
}

export interface ArenaSummary {
  arenaId: string;
  watchUrl: string;
  isDefault: boolean;
}

// The parts of match_status / run_match results the extension shows.
export interface MatchStanding {
  rank: number;
  id: string;
  name?: string;
  alive: boolean;
  botsAlive: number;
  totalHealth: number;
}

export interface MatchStatus {
  running: boolean;
  clock: { time: number };
  match: {
    decided: boolean;
    suddenDeath: boolean;
    winner: { id: string; name?: string } | null;
  };
  standings: MatchStanding[];
}

export interface MatchResult {
  watchUrl: string;
  timedOut: boolean;
  match: MatchStatus['match'];
}

// A typed wrapper over the RobocodeJs MCP endpoint (POST /api/mcp). The bearer
// token from the OAuth flow is only accepted under /api/mcp — the REST API is
// cookie-authenticated — so the extension reaches the server through MCP tools,
// plus the one bearer-authed stream at /api/mcp/arenas/:arenaId/logs. The
// server is stateless, so a connection is cheap to re-establish.
export class RobocodeClient {
  private client: Client | undefined;
  private signingIn: Promise<void> | undefined;

  constructor(
    private readonly serverUrl: string,
    private readonly auth: RobocodeAuth
  ) {}

  get mcpUrl(): URL {
    return new URL('/api/mcp', this.serverUrl);
  }

  // Run the browser sign-in and leave the client connected.
  get isSigningIn(): boolean {
    return this.signingIn !== undefined;
  }

  // Single-flight: a second Sign In while one is waiting on the browser must
  // not start another flow. That would replace the first flow's state and
  // listener, so approving in the first tab lands on a stale callback.
  signIn(token: vscode.CancellationToken): Promise<void> {
    this.signingIn ??= this.runSignIn(token).finally(() => {
      this.signingIn = undefined;
    });
    return this.signingIn;
  }

  private async runSignIn(token: vscode.CancellationToken): Promise<void> {
    await this.disconnect();
    await this.auth.beginSignIn();
    try {
      const transport = this.transport();
      try {
        await this.connectWith(transport);
        return; // Already had working credentials.
      } catch (err) {
        if (!(err instanceof UnauthorizedError)) throw err;
      }
      // The SDK has registered the client and opened the browser; finish the
      // flow with the code the browser brings back, then connect afresh (a
      // transport that failed auth can't be reused for the session).
      const code = await this.auth.waitForCode(token);
      await transport.finishAuth(code);
      await this.connectWith(this.transport());
    } finally {
      // After finishAuth: the code exchange must present the same redirect URI.
      await this.auth.endSignIn();
    }
  }

  async signOut(): Promise<void> {
    await this.disconnect();
    await this.auth.signOut();
  }

  async disconnect(): Promise<void> {
    const client = this.client;
    this.client = undefined;
    await client?.close().catch(() => undefined);
  }

  listApps(): Promise<AppSummary[]> {
    return this.call('list_apps', {});
  }

  listArenas(): Promise<ArenaSummary[]> {
    return this.call('list_arenas', {});
  }

  // get_app_source answers an empty app with an explanatory sentence instead of
  // an empty string, so callers pass the app's listed `version` to tell the two
  // apart (see sourceFromText).
  getSourceText(appId: string): Promise<string> {
    return this.call('get_app_source', { appId }, { raw: true });
  }

  setSource(
    appId: string,
    source: string
  ): Promise<{ appId: string; updated: boolean; version: string }> {
    return this.call('set_app_source', { appId, source });
  }

  createApp(
    name: string
  ): Promise<{ appId: string; name: string; version: string }> {
    return this.call('create_app', { name });
  }

  check(source: string): Promise<CheckResult> {
    return this.call('check_app_source', { source });
  }

  format(
    source: string
  ): Promise<{ ok: boolean; formatted?: string; changed?: boolean }> {
    return this.call('format_app_source', { source });
  }

  compile(appId: string): Promise<{ compiled: boolean }> {
    return this.call('compile_app', { appId });
  }

  reboot(appId: string): Promise<{ rebooted: boolean }> {
    return this.call('reboot_app', { appId });
  }

  async defaultArena(): Promise<ArenaSummary> {
    const arenas = await this.listArenas();
    const arena = arenas.find((a) => a.isDefault) ?? arenas[0];
    if (!arena) throw new Error('You have no arenas yet.');
    return arena;
  }

  async recentFaults(arenaId: string): Promise<Fault[]> {
    const result = await this.call<{ faults: Fault[] }>('recent_faults', {
      arenaId,
    });
    return result.faults;
  }

  matchStatus(arenaId: string): Promise<MatchStatus> {
    return this.call('match_status', { arenaId });
  }

  runMatch(arenaId: string): Promise<MatchResult> {
    // run_match waits up to 60s server-side for a decision.
    return this.call('run_match', { arenaId }, { timeoutMs: 90_000 });
  }

  // The bot log stream URL for an arena (see server/src/api/mcp.ts).
  logsUrl(arenaId: string): URL {
    return new URL(`/api/mcp/arenas/${arenaId}/logs`, this.serverUrl);
  }

  private transport(): StreamableHTTPClientTransport {
    return new StreamableHTTPClientTransport(this.mcpUrl, {
      authProvider: this.auth,
    });
  }

  private async connectWith(
    transport: StreamableHTTPClientTransport
  ): Promise<Client> {
    const client = new Client({
      name: 'robocodejs-vscode',
      version: '0.0.1',
    });
    await client.connect(transport);
    this.client = client;
    return client;
  }

  private async connected(): Promise<Client> {
    if (this.client) return this.client;
    // No stored-token precheck: a local dev server (robocodejs.serverUrl =
    // http://localhost:5000) accepts MCP without any token, so "signed in"
    // means "a connection works", not "we hold tokens".
    try {
      return await this.connectWith(this.transport());
    } catch (err) {
      // Connecting non-interactively: a 401 that survived the SDK's refresh
      // attempt means the grant is gone (RobocodeAuth refuses to open the
      // browser outside signIn, so this never pops a surprise tab).
      if (
        err instanceof UnauthorizedError ||
        err instanceof SignInRequiredError
      )
        throw new SignInRequiredError();
      throw err;
    }
  }

  // `raw` returns the text untouched: bot source like `42` is valid JSON too.
  private async call<T>(
    name: string,
    args: Record<string, unknown>,
    { raw = false, timeoutMs }: { raw?: boolean; timeoutMs?: number } = {}
  ): Promise<T> {
    const client = await this.connected();
    let result;
    try {
      result = await client.callTool(
        { name, arguments: args },
        undefined,
        timeoutMs ? { timeout: timeoutMs } : undefined
      );
    } catch (err) {
      if (
        err instanceof UnauthorizedError ||
        err instanceof SignInRequiredError
      ) {
        await this.disconnect();
        throw new SignInRequiredError();
      }
      throw err;
    }
    const content = result.content as { type: string; text?: string }[];
    const text = content.find((c) => c.type === 'text')?.text ?? '';
    if (result.isError) throw new Error(text || `${name} failed.`);
    if (raw) return text as T;
    // Object results also arrive as structuredContent; arrays and strings only
    // as text (JSON for arrays — see `ok` in server/src/api/mcp.ts).
    if (result.structuredContent) return result.structuredContent as T;
    try {
      return JSON.parse(text) as T;
    } catch {
      return text as T;
    }
  }
}
