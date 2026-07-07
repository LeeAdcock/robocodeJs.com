# RobocodeJs

**Welcome to the arena! RobocodeJs is a browser-based programming game where you write JavaScript to control a team of battle bots. Brainstorm a strategy, program your bots, and set them loose in the arena to find and defeat the competition — it all runs right in your browser. Onwards to fame and glory!**

The arena is a square battlefield where teams of bots fight. Each app you write is the shared "brain" for one team — five bots that scan with radar, aim a turret, and drive around hunting the other teams. Your goal is simple: knock them out before they knock out you. Edit your code and save, and every bot on your team instantly starts using the new logic — so you can reset the match, add or remove opponents, and keep tuning your strategy in seconds.

See that arena? It's a live demo — real bots battling right now. In a few minutes, yours can be in there too.

# Get started

**The fastest way in:** sign in with your Google account, then open the menu and choose
**Apps → Create new application**. Your bots drop straight into the arena and you're ready
to code — no setup, no downloads, nothing to install. Follow the quick walkthrough below
to see how a bot comes together, step by step.

**Prefer a different on-ramp?** Pick the path that fits you:

- **New to coding?** Start the **[Learn to Code course](/learn)** — a guided, 15-lesson
  path that takes you from "what is code?" to a fully featured battle bot, no experience
  needed.
- **Coming from classic Robocode?** Read **[Coming from classic Robocode](/classic)** for
  a quick map of what's the same, what's different, and how to port your instincts.
- **Want the details?** Keep the **[API reference](/dev)** and **[game rules &
  physics](/rules)** handy, and browse the **[example bots](/examples)**.
- **Want an AI to help?** Connect Claude (or any MCP client) to write, run, and watch
  your bots for you — see **[Connect an AI (MCP)](/mcp)**.

# Coding your first JavaScript bot

This quick walkthrough shows the key steps to building a bot — naming it, firing its
turret, and getting it moving — so you can see how the pieces fit together. Prefer to
start by reading instead? Take the guided **[Learn to Code course](/learn)** or dive into
the full **[documentation](/dev)**.

Everything you control hangs off the `bot` object. **Name your bot:**

```js
bot.setName('My first bot');
```

**Fire when the turret is loaded** — it needs time to reload, so check first, and run that check every clock tick:

```js
function fireIfReady() {
  if (bot.turret.isReady()) {
    bot.turret.fire();
  }
}

clock.on(Event.TICK, fireIfReady);
```

**Get it moving** — drive when the match starts, and turn a little each time you fire:

```js
bot.on(Event.START, () => {
  bot.setSpeed(2);
});

bot.on(Event.FIRED, () => {
  bot.turn(10);
});
```

Save in the editor and every bot on your team picks up the new logic instantly. That's the shape of a bot — react to events, and control the `bot` with each one.

# Next steps!

That's the gist — a bot that drives, fires, and turns. It won't dominate the arena yet, but you've seen how the pieces fit together.

Ready to build your own? Take the guided **[Learn to Code course](/learn)** for the full step-by-step path, skim the detailed **[RobocodeJs documentation](/dev)**, study a few **[example bots](/examples)**, or [deepen your knowledge](https://learnjavascript.online/) of JavaScript itself.

---

_RobocodeJs is a passion project, a web-enabled version of, and love letter to, the classic Robocode. [Read the story](/about), or say hi at [Lee@RobocodeJs.com](mailto:Lee@RobocodeJs.com)._
