import * as vscode from 'vscode';
import * as http from 'node:http';
import { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import type { OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js';
import type {
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js';

// How long to wait for the browser to bounce back after sign-in before giving up.
const SIGN_IN_TIMEOUT_MS = 5 * 60 * 1000;

// The callback listener tries this port first so the forwarded redirect URI —
// and with it the client registration — stays the same across sign-ins (in
// Codespaces the port is part of the forwarded hostname). Any free port works.
const PREFERRED_CALLBACK_PORT = 33418;
const CALLBACK_PATH = '/callback';

// Thrown when the stored credentials no longer work and the user has to sign in
// again (the SDK has already tried a refresh).
export class SignInRequiredError extends Error {
  constructor() {
    super('Sign in to RobocodeJs to continue.');
  }
}

// The user dismissed the sign-in; not an error worth reporting.
export class SignInCancelledError extends Error {
  constructor() {
    super('Sign-in cancelled.');
  }
}

const page = (message: string) =>
  '<!doctype html><meta charset="utf-8"><title>RobocodeJs</title>' +
  '<body style="font-family:system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem">' +
  `<h1>RobocodeJs</h1><p>${message}</p></body>`;

// The OAuth client side of the MCP SDK's auth flow, backed by VS Code storage.
// RobocodeJs's server is a full OAuth 2.1 authorization server (api/oauth.ts):
// the SDK discovers it, registers this extension as a client (dynamic client
// registration), and runs an authorization-code + PKCE flow. This class supplies
// the storage and the browser round trip.
//
// The browser comes back to a short-lived HTTP listener in the extension host,
// published through vscode.env.asExternalUri. That one mechanism covers every
// way VS Code runs: on the desktop the URI stays 127.0.0.1; in a remote window
// (dev container, SSH) VS Code forwards it to a localhost port on the user's
// machine; and in browser Codespaces it becomes the forwarded
// https://…app.github.dev address. (A vscode:// redirect does not survive the
// browser client — there is no desktop app to hand it to.)
export class RobocodeAuth implements OAuthClientProvider {
  private verifier: string | undefined;
  // Set only for the duration of signIn: the listener and the external URI the
  // browser will be sent back to. Its absence is also what keeps background
  // calls from ever registering a client or opening the browser.
  private callback:
    { server: http.Server; uri: string; authorizationUrl?: string } | undefined;
  // The sign-in in progress: the state the SDK put in the authorization URL, and
  // the code the browser brought back for it (settled by the listener).
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
    // Sign-in progress for the Output channel. Never passed a code or token.
    private readonly log: (line: string) => void = () => undefined
  ) {}

  // Never undefined: the SDK reads a missing redirectUrl as a non-interactive
  // (client-credentials) client and then skips refreshing tokens altogether.
  // Outside a sign-in the placeholder is never used to redirect anywhere —
  // redirectToAuthorization refuses first.
  get redirectUrl(): string {
    return this.callback?.uri ?? `http://127.0.0.1${CALLBACK_PATH}`;
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      // Shown on the RobocodeJs approval page ("Connect <name>?").
      client_name: 'RobocodeJs for VS Code',
      redirect_uris: this.callback ? [this.callback.uri] : [],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    };
  }

  // Start the callback listener and work out the URI the browser can reach it
  // on. Must run before the SDK starts the flow, since it reads redirectUrl.
  async beginSignIn(): Promise<void> {
    await this.endSignIn();
    const server = http.createServer((req, res) => this.onCallback(req, res));
    await listen(server, PREFERRED_CALLBACK_PORT).catch(() =>
      listen(server, 0)
    );
    const { port } = server.address() as AddressInfo;
    const external = await vscode.env.asExternalUri(
      vscode.Uri.parse(`http://127.0.0.1:${port}${CALLBACK_PATH}`)
    );
    this.callback = { server, uri: external.toString(true) };
    this.log(
      `sign-in: listening on 127.0.0.1:${port}, redirect ${this.callback.uri}`
    );
  }

  async endSignIn(): Promise<void> {
    const callback = this.callback;
    this.callback = undefined;
    if (callback) await new Promise((r) => callback.server.close(r));
  }

  // Called by the SDK as it builds the authorization URL, so this is where a
  // sign-in begins: from here on, the listener accepts a callback for this state.
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
    if (!this.callback) {
      // Background call: the stored registration is all a token refresh needs.
      // Without one we were never signed in, and registering (or opening a
      // browser) is reserved for an explicit sign-in.
      if (!stored) throw new SignInRequiredError();
      return stored;
    }
    // Signing in: a registration is bound to its redirect URIs, and the
    // forwarded callback can differ between machines and sessions.
    if (stored && 'redirect_uris' in stored) {
      if (!stored.redirect_uris.includes(this.callback.uri)) return undefined;
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
    if (!this.callback) throw new SignInRequiredError();
    this.callback.authorizationUrl = authorizationUrl.href;
    await vscode.env.openExternal(vscode.Uri.parse(authorizationUrl.href));
  }

  // Show the in-progress sign-in's approval page again (e.g. the first tab was
  // closed or opened out of sight). Reusing the same URL keeps its state, so
  // whichever tab the user approves in completes this one sign-in.
  async reopenAuthorization(): Promise<void> {
    const url = this.callback?.authorizationUrl;
    if (url) await vscode.env.openExternal(vscode.Uri.parse(url));
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

  // Wait for the browser to come back to the listener with the authorization
  // code for the sign-in the SDK just started.
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
            reject(new SignInCancelledError())
          );
        }),
      ]);
    } finally {
      clearTimeout(timer);
      cancel?.dispose();
      if (this.pending === pending) this.pending = undefined;
    }
  }

  private onCallback(req: http.IncomingMessage, res: http.ServerResponse) {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const reply = (status: number, message: string) => {
      res.writeHead(status, { 'content-type': 'text/html; charset=utf-8' });
      res.end(page(message));
    };
    // An unsolicited or stale callback (wrong state) is refused without
    // touching the sign-in in progress: the state check is the CSRF guard.
    const pending = this.pending;
    const state = url.searchParams.get('state');
    this.log(
      `sign-in: callback ${url.pathname} state=${state ? 'present' : 'missing'} ` +
        `waiting=${pending ? 'yes' : 'no'} match=${!!pending && state === pending.state}`
    );
    if (url.pathname !== CALLBACK_PATH || !pending) {
      reply(
        400,
        'This VS Code window isn’t waiting for a sign-in. Start again from VS Code.'
      );
      return;
    }
    if (state !== pending.state) {
      reply(
        400,
        'This link is from an earlier sign-in attempt. Use the newest sign-in tab, or start again from VS Code.'
      );
      return;
    }
    const code = url.searchParams.get('code');
    if (code) {
      reply(
        200,
        'You’re signed in. You can close this tab and return to VS Code.'
      );
      pending.resolve(code);
    } else {
      const reason =
        url.searchParams.get('error_description') ?? 'Sign-in was declined.';
      reply(400, 'Sign-in did not complete. Return to VS Code to try again.');
      pending.reject(new Error(reason));
    }
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

// Bind to loopback only: the listener must never be reachable from the network
// directly, only through VS Code's own port forwarding.
const listen = (server: http.Server, port: number) =>
  new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
