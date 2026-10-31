# Developing the RobocodeJs VS Code extension

`README.md` in this folder is the extension's **Marketplace page** (`vsce` packs it into the `.vsix`), so keep it written for users. Development notes live here; `.vscodeignore` keeps this file out of the package.

## Build, test, package

```bash
npm install
npm run build   # type-check + bundle to dist/ (also copies ../ui/public/docs/ts/robocode.d.ts)
npm test        # unit tests (vitest)
npm run lint
npm run package # a .vsix for side-loading (Extensions: Install from VSIX…)
```

Open this `vscode/` folder in VS Code and press **F5** to launch an Extension Development Host. To work against a local server, set `robocodejs.serverUrl` to `http://localhost:5000` (or `http://localhost:8080` for the API server alone). Local-dev mode needs no sign-in, so the sidebar connects straight away as the Local Dev user.

## Versioning and publishing

The extension carries the project's release version: the root `npm run release` sets `vscode/package.json` to the server's new version, and CI (`test/version.test.ts`) fails if they drift. Publish from a released tag, after its deploy, and only when `vscode/` changed. See the release section of the root `CLAUDE.md`.

## How it works

- **Server access.** The extension is an [MCP](https://modelcontextprotocol.io) client of the RobocodeJs MCP endpoint (`/api/mcp`), the same one AI assistants connect to. The one non-MCP call is the live bot log stream, `GET /api/mcp/arenas/:arenaId/logs` (server-sent events, same bearer token). MCP tokens are never accepted on the cookie-authenticated REST API.
- **Sign-in.** The server's OAuth 2.1 flow (dynamic client registration and PKCE). The browser returns to a short-lived `127.0.0.1` listener in the extension, published through `vscode.env.asExternalUri`, so it works on the desktop, in remote windows and in browser Codespaces (which drops the callback path, so the listener accepts any path; the `state` value is the guard). Tokens are kept in VS Code's secret storage, per server URL.
- **Editing.** Apps are edited as real files in the extension's storage folder, one folder per app with its own `jsconfig.json` next to `robocode.d.ts`, because VS Code's TypeScript service only gives full IntelliSense to real files. Saving pushes with `set_app_source`.
- **Arena panel.** A webview that frames the site's public `/watch/:arenaId` page, which the server allows VS Code's origins to frame. The webview needs `enableScripts: true` (sandbox flags are inherited by nested frames), while its own CSP grants no `script-src`.
- **Status and Arena Apps.** Both read the `match_status` poll (every 15 s while the window is focused); mind the per-user MCP budget of 60 calls a minute when adding polling.
