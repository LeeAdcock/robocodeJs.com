# RobocodeJs for VS Code

Write, check and run your RobocodeJs apps from [Visual Studio Code](https://code.visualstudio.com). Your apps stay on robocodejs.com and keep battling in your arena; the extension is another editor for them, with VS Code's autocomplete, your own keybindings, and the live arena beside your code.

**[Install from the VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=robocode-js.robocodejs)**, or **[open the install page in VS Code](vscode:extension/robocode-js.robocodejs)** directly. You can also search for **RobocodeJs** in VS Code's Extensions view. It needs VS Code 1.101 or later.

### Signing in

Click the tank icon in VS Code's activity bar, then **Sign in**. A browser tab opens on robocodejs.com; sign in with Google if you aren't already, and you're sent back to VS Code. There's no key or token to copy. Sign-in works on the desktop, in remote windows (dev containers, SSH) and in GitHub Codespaces, including Codespaces in the browser.

### Editing your apps

Your apps are listed under **Apps**. Click one to open it. **Saving pushes it to RobocodeJs**, and your arena picks up the change, just as saving in the browser editor does. If the app was changed in the browser since you opened it, VS Code asks whether to overwrite that change or reload it, so neither side is silently lost.

While you type, VS Code autocompletes the whole bot API (`bot`, `arena`, `clock`, `Event` and the timers) with its documentation. Each save checks your code on the server, so syntax errors, undeclared variables ([E027](/error-codes)) and load errors are underlined where they happen. **Format App** applies the same code style as the browser editor.

### Your arena

The **Arena Apps** list shows the apps in your arena. **Drag an app from Apps into Arena Apps** to add it, and drag it back to take it out (right-click works too). Each app shows in one list or the other. Other players' apps that you added by share link appear in Arena Apps as well. Your own apps there have **Compile** (re-run the saved code) and **Reboot** (restart them) buttons.

The Arena Apps title bar runs the match. **Play** and **Pause** swap as the match starts and stops, and **Restart Match** starts a fresh match at normal speed. **Watch Arena** opens the live arena in a panel beside your code, the same view as your arena's share link. The status bar shows the current tick and how many apps are still alive, or the winner once the match is decided.

### Logs and crashes

The **RobocodeJs Bot Logs** output panel streams your bots' console output live, labelled with the tick, the app and the bot number. When a bot crashes at runtime, the error is underlined on the line that failed, and a notification offers to jump there. Saving, compiling or rebooting the app clears it.

### AI assistants in VS Code

The extension also offers RobocodeJs to VS Code's AI chat as an [MCP](/mcp) server, so agent mode in GitHub Copilot can use the same RobocodeJs tools as Claude, once you've signed in. To connect Claude or another assistant instead, see **[Connect an AI (MCP)](/mcp)**.

### Codespaces and dev containers

To have every Codespace or dev container for a project install the extension automatically, add it to the project's `.devcontainer/devcontainer.json`:

```json
"customizations": {
  "vscode": {
    "extensions": ["robocode-js.robocodejs"]
  }
}
```

### Running RobocodeJs locally

If you're working on RobocodeJs itself, point the extension at your local server: set **RobocodeJs: Server Url** (`robocodejs.serverUrl`) in VS Code's settings to `http://localhost:5000`, and reload when prompted. A local server in development mode needs no sign-in. Your robocodejs.com sign-in is kept separately, so switching back doesn't sign you out.
