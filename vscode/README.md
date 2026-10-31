# RobocodeJs for VS Code

Write, check and run your [RobocodeJs](https://robocodejs.com) tank apps without leaving VS Code. Your apps stay on robocodejs.com and keep battling in your arena; VS Code becomes another place to edit them, with full autocomplete and the live arena beside your code.

## Getting started

1. Click the **RobocodeJs** tank in the activity bar.
2. Click **Sign in**. A browser tab opens on robocodejs.com; sign in with Google if you aren't already, and you're sent back to VS Code. There's no key or token to copy.
3. Click one of your apps to open it, make a change, and save. Your arena picks it up straight away.

New to RobocodeJs? The [Learn to Code course](https://robocodejs.com/learn) takes you from your first line of code to a battle-ready bot.

## Features

### Write your apps

- **Your apps in the sidebar.** Click one to open it; **saving sends it to RobocodeJs**, just like saving in the browser editor.
- **Autocomplete for the whole bot API.** Completions, hover docs and signatures for `bot`, `arena`, `clock`, `Event` and the timers.
- **Errors as you save.** Syntax errors, undeclared variables and load errors are underlined where they happen.
- **Format App** tidies your code in the same style as the browser editor.
- **No lost work.** If an app was changed in the browser since you opened it, saving asks whether to keep your version or reload theirs.

### Run your arena

- **Arena Apps.** Drag apps from **Apps** into **Arena Apps** to add them to your arena, and drag them back to take them out (right-click works too). Apps you added from another player's share link appear there as well.
- **Match controls.** **Play** and **Pause** swap as the match starts and stops, and **Restart Match** starts a fresh match at normal speed.
- **Compile and Reboot** on each of your apps in the arena: re-run its saved code, or restart it from scratch.
- **Watch the arena live** in a panel beside your code, or open it full size in your browser.
- **Status bar.** The current tick and how many apps are still alive, or the winner once the match is decided.

### Debug your bots

- **Bot Logs.** Your bots' console output streams live into the **RobocodeJs Bot Logs** panel, labelled with the tick, the app and the bot.
- **Crashes in your code.** When a bot crashes, the error is underlined on the line that failed, and a notification offers to jump there.

### Use AI assistants

- Once you're signed in, **GitHub Copilot's agent mode** can use RobocodeJs directly: reading your apps, checking code, and running matches for you.

## Requirements

- VS Code 1.101 or later. Works on the desktop, in remote windows (dev containers, SSH) and in GitHub Codespaces, including Codespaces in the browser.
- A RobocodeJs account. Signing in with Google creates one.

## Your data

The extension talks only to robocodejs.com, and only to your own apps and arena. Your sign-in is kept in VS Code's secure storage, and you can end it at any time with **RobocodeJs: Sign Out**. See the [privacy policy](https://robocodejs.com/privacy).

## More

- [The RobocodeJs VS Code guide](https://robocodejs.com/vscode)
- [Bot API reference](https://robocodejs.com/learn/docs) and [example bots](https://robocodejs.com/examples)
- [Game rules and physics](https://robocodejs.com/rules) and the [FAQ](https://robocodejs.com/faq)
