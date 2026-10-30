import * as vscode from 'vscode';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { UnauthorizedError } from '@modelcontextprotocol/sdk/client/auth.js';

import { RobocodeAuth } from './auth';
import { CheckResult } from './problems';

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

// Thrown when the stored credentials no longer work and the user has to sign in
// again (the SDK has already tried a refresh).
export class SignInRequiredError extends Error {
  constructor() {
    super('Sign in to RobocodeJs to continue.');
  }
}

// A typed wrapper over the RobocodeJs MCP endpoint (POST /api/mcp). The bearer
// token from the OAuth flow is only accepted there — the REST API is
// cookie-authenticated — so the extension reaches the server entirely through
// MCP tools. The server is stateless, so a connection is cheap to re-establish.
export class RobocodeClient {
  private client: Client | undefined;

  constructor(
    private readonly serverUrl: string,
    private readonly auth: RobocodeAuth
  ) {}

  get mcpUrl(): URL {
    return new URL('/api/mcp', this.serverUrl);
  }

  // Run the browser sign-in and leave the client connected.
  async signIn(token: vscode.CancellationToken): Promise<void> {
    const transport = this.transport();
    this.auth.interactive = true;
    try {
      await this.connectWith(transport);
      return; // Already had working credentials.
    } catch (err) {
      if (!(err instanceof UnauthorizedError)) throw err;
    } finally {
      this.auth.interactive = false;
    }
    // The SDK has registered the client and opened the browser; finish the
    // flow with the code the browser brings back, then connect afresh (a
    // transport that failed auth can't be reused for the session).
    const code = await this.auth.waitForCode(token);
    await transport.finishAuth(code);
    await this.connectWith(this.transport());
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
      // attempt means the grant is gone (RobocodeAuth doesn't open the browser
      // outside signIn, so this never pops a surprise tab).
      if (err instanceof UnauthorizedError) throw new SignInRequiredError();
      throw err;
    }
  }

  // `raw` returns the text untouched: bot source like `42` is valid JSON too.
  private async call<T>(
    name: string,
    args: Record<string, unknown>,
    { raw = false } = {}
  ): Promise<T> {
    const client = await this.connected();
    let result;
    try {
      result = await client.callTool({ name, arguments: args });
    } catch (err) {
      if (err instanceof UnauthorizedError) {
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
