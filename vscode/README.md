# RobocodeJs for VS Code

Write, check and run your [RobocodeJs](https://robocodejs.com) tank apps from VS Code. Your apps stay on robocodejs.com and keep battling in your arena. The extension is just another editor for them.

> **Prototype.** This is Phase 1 of [GitHub #438](https://github.com/LeeAdcock/robocodeJs.com/issues/438).

## Features

- **Sign in with your RobocodeJs account.** The RobocodeJs sidebar opens a browser sign-in and returns to VS Code. No API key to copy.
- **Your apps in the sidebar.** Click an app to open it. **Saving pushes it to the server**, and your live arenas pick up the change, just like saving in the browser editor.
- **IntelliSense for the bot API.** Completions, hover docs and signatures for `bot`, `arena`, `clock`, `Event` and the timers, from the same `robocode.d.ts` that powers the browser editor.
- **Problems as you save.** Each save runs the server's dry-run check, so syntax errors, undeclared variables (E027) and load errors appear as red squiggles.
- **Compile / Reboot / Format** from the editor title bar or the command palette (`RobocodeJs: …`). Format uses the site's house style.
- **Watch Arena** opens your arena's live spectator page in the browser.

If an app was changed in the browser since you opened it in VS Code, saving asks whether to overwrite the server copy or reload it, rather than silently clobbering one side.

## How it works

The extension is an [MCP](https://modelcontextprotocol.io) client of the RobocodeJs MCP endpoint (`/api/mcp`), the same one AI assistants connect to. Sign-in is the server's OAuth 2.1 flow (dynamic client registration and PKCE). The browser returns to a short-lived listener in the extension, published through VS Code's port forwarding, so it works on the desktop, in remote windows (dev containers, SSH) and in Codespaces in the browser. Tokens are kept in VS Code's secret storage.

Apps are edited as real files in the extension's storage folder, one folder per app with its own `jsconfig.json`. VS Code's TypeScript service only gives full IntelliSense to real files.

## Development

```bash
npm install
npm run build   # type-check + bundle to dist/ (also copies ../ui/public/docs/ts/robocode.d.ts)
npm test        # unit tests (vitest)
npm run lint
```

Open this `vscode/` folder in VS Code and press **F5** to launch an Extension Development Host. To work against a local server, set `robocodejs.serverUrl` to `http://localhost:5000`. Local-dev mode needs no sign-in, so the sidebar connects straight away as the Local Dev user.

`npm run package` builds a `.vsix` for side-loading (**Extensions: Install from VSIX…**).
