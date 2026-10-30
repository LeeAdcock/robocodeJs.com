import * as vscode from 'vscode';
import { randomUUID } from 'node:crypto';
import type { OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js';
import type {
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js';

// How long to wait for the browser to bounce back after sign-in before giving up.
const SIGN_IN_TIMEOUT_MS = 5 * 60 * 1000;

// The OAuth client side of the MCP SDK's auth flow, backed by VS Code storage.
// RobocodeJs's server is a full OAuth 2.1 authorization server (api/oauth.ts):
// the SDK discovers it, registers this extension as a client (dynamic client
// registration), and runs an authorization-code + PKCE flow. This class supplies
// the storage and the browser round trip.
//
// The redirect is a vscode:// URI handled by this extension rather than a
// loopback HTTP listener, so sign-in also works when VS Code runs remotely (dev
// containers, SSH, Codespaces), where a 127.0.0.1 listener would be on the wrong
// machine.
export class RobocodeAuth implements OAuthClientProvider, vscode.UriHandler {
  // Only an explicit sign-in may open the browser. Otherwise an expired grant
  // found by a background call (refreshing the tree, saving) would pop a tab.
  interactive = false;
  private verifier: string | undefined;
  // The sign-in in progress: the state the SDK put in the authorization URL, and
  // the code the browser brought back for it (settled by handleUri).
  private pending:
    | {
        state: string;
        code: Promise<string>;
        resolve: (code: string) => void;
        reject: (err: Error) => void;
      }
    | undefined;

  constructor(
    private readonly secrets: vscode.SecretStorage,
    private readonly serverUrl: string,
    private readonly callbackUri: string
  ) {}

  get redirectUrl(): string {
    return this.callbackUri;
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      // Shown on the RobocodeJs approval page ("Connect <name>?").
      client_name: 'RobocodeJs for VS Code',
      redirect_uris: [this.callbackUri],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    };
  }

  // Called by the SDK as it builds the authorization URL, so this is where a
  // sign-in begins: from here on, handleUri accepts a callback for this state.
  state(): string {
    const state = randomUUID();
    this.pending?.reject(new Error('Superseded by a newer sign-in.'));
    let resolve!: (code: string) => void;
    let reject!: (err: Error) => void;
    const code = new Promise<string>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    // Nobody may be awaiting yet; don't let a superseded sign-in go unhandled.
    code.catch(() => undefined);
    this.pending = { state, code, resolve, reject };
    return state;
  }

  async clientInformation(): Promise<OAuthClientInformationMixed | undefined> {
    const stored = await this.read<OAuthClientInformationMixed>('client');
    // A registration is bound to its redirect URIs. VS Code, Insiders and the
    // forks each have their own URI scheme, so re-register if it changed.
    if (stored && 'redirect_uris' in stored) {
      if (!stored.redirect_uris.includes(this.callbackUri)) return undefined;
    }
    return stored;
  }

  saveClientInformation(info: OAuthClientInformationMixed): Promise<void> {
    return this.write('client', info);
  }

  tokens(): Promise<OAuthTokens | undefined> {
    return this.read<OAuthTokens>('tokens');
  }

  saveTokens(tokens: OAuthTokens): Promise<void> {
    return this.write('tokens', tokens);
  }

  async redirectToAuthorization(authorizationUrl: URL): Promise<void> {
    if (!this.interactive) return;
    await vscode.env.openExternal(vscode.Uri.parse(authorizationUrl.href));
  }

  saveCodeVerifier(codeVerifier: string): void {
    this.verifier = codeVerifier;
  }

  codeVerifier(): string {
    if (!this.verifier) throw new Error('No sign-in is in progress.');
    return this.verifier;
  }

  async invalidateCredentials(
    scope: 'all' | 'client' | 'tokens' | 'verifier' | 'discovery'
  ): Promise<void> {
    if (scope === 'all' || scope === 'client') await this.remove('client');
    if (scope === 'all' || scope === 'tokens') await this.remove('tokens');
    if (scope === 'all' || scope === 'verifier') this.verifier = undefined;
  }

  signOut(): Promise<void> {
    return this.remove('tokens');
  }

  // Wait for the browser to come back to handleUri with the authorization code
  // for the sign-in the SDK just started.
  async waitForCode(token: vscode.CancellationToken): Promise<string> {
    const pending = this.pending;
    if (!pending) throw new Error('No sign-in is in progress.');
    let timer: NodeJS.Timeout | undefined;
    let cancel: vscode.Disposable | undefined;
    try {
      return await Promise.race([
        pending.code,
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error('Timed out waiting for sign-in.')),
            SIGN_IN_TIMEOUT_MS
          );
          cancel = token.onCancellationRequested(() =>
            reject(new Error('Sign-in cancelled.'))
          );
        }),
      ]);
    } finally {
      clearTimeout(timer);
      cancel?.dispose();
      if (this.pending === pending) this.pending = undefined;
    }
  }

  handleUri(uri: vscode.Uri): void {
    const params = new URLSearchParams(uri.query);
    const code = params.get('code');
    // An unsolicited or stale callback (wrong state) is ignored rather than
    // failing the sign-in in progress: the state check is the CSRF guard.
    if (!this.pending || params.get('state') !== this.pending.state) return;
    if (code) this.pending.resolve(code);
    else
      this.pending.reject(
        new Error(params.get('error_description') ?? 'Sign-in was declined.')
      );
  }

  // Secrets are keyed by server so switching robocodejs.serverUrl (e.g. to a
  // local dev server) never sends one server's token to another.
  private key(name: string): string {
    return `robocodejs.${name}:${this.serverUrl}`;
  }

  private async read<T>(name: string): Promise<T | undefined> {
    const raw = await this.secrets.get(this.key(name));
    return raw ? (JSON.parse(raw) as T) : undefined;
  }

  private async write(name: string, value: unknown): Promise<void> {
    await this.secrets.store(this.key(name), JSON.stringify(value));
  }

  private async remove(name: string): Promise<void> {
    await this.secrets.delete(this.key(name));
  }
}
