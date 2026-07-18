# Pair-programming a bot with an AI

_February 10, 2026_

<img
  src="/docs/lee_headshot.jpg"
  alt="Lee, the creator of RobocodeJs"
  width="170"
  style="border-radius: 50%; object-fit: cover; float: right; margin: 0.25rem 0 1rem 1.5rem; max-width: 40%;"
/>

You're talking to an AI assistant, Claude say, in a normal chat window, and you tell it "my bot keeps driving into walls, can you fix it and run a match to check?" And it does. It opens your bot's code, edits it, compiles it, starts a fight in your arena, watches what happens, reads the logs, and tells you whether the wall problem is gone. You never touched the editor.

That's what shipped, and it still gets me a little. RobocodeJs now speaks [MCP](/mcp), the Model Context Protocol, which is a standard way for an AI assistant to reach into an app and actually _use_ it, not just talk about it. So an assistant can drive the game the same way you would, through a proper set of tools with your permission.

There's a strange full-circle quality to this for me. I've been writing AIs to play games my whole life. [It's how I got into programming at all.](/blog/a-game-that-taught-me) And Robocode itself is a game about nothing _but_ writing the player. Now there's an AI that writes the AI that plays the game. The ladder I've been climbing since high school grew a new rung on top of me.

## What it can actually do

It's not one magic button; it's a toolbox of around 28 tools, and they cluster into a few kinds of thing:

- **Work with your bots.** Create a new bot, read and rewrite its code, check it for errors, format it, compile it, reboot it. The full write-and-fix loop.
- **Run the arena.** Spin one up, pause and resume, restart a match, change the speed, set a seed so a fight is reproducible. Everything you'd do with the arena controls.
- **Watch what happens.** Pull the live status of a match, get a summary of how it turned out, read recent logs and faults. This is the part that makes it a real collaborator instead of a code generator. It can _see the results_ of what it just did.

The important word there is _loop_. Because the assistant can edit, run, and observe, it can iterate: try something, watch it lose, form a theory about why, change the code, and run it again. The exact cycle you'd go through, except you're describing intent in plain language and it's turning the cranks.

## Setting it up

The whole thing is bearer-token auth: you generate a token, point your assistant at RobocodeJs's MCP endpoint, and from then on it acts as _you_. Only your bots, only your arenas. It's held to the same ownership rules you are, with no path to anyone else's private code that you don't have yourself. I wrote the full walkthrough at [/mcp](/mcp), including where to get your token and how to connect the common assistants. It's a five-minute setup and then it just works.

One thing worth knowing: the tools only touch your own resources, by design. The AI driving your arena is powerful, but it's fenced into your account. That was a hard requirement for me. The same ownership rules that protect your source in the web app protect it here.

## A session, start to finish

Here's a realistic one. You say: _"I want a bot that hangs back and only fires when it has a clean shot. Build it and see if it beats my current one."_

The assistant creates a new bot and writes a first version. Maybe it keeps its distance, scans with the radar, and only calls `bot.turret.fire()` when a target is lined up and `bot.turret.isReady()` is true. It compiles it, drops it into an arena against your existing bot, sets a seed, and runs the match. Then it reads the summary: your old bot won. It pulls the logs, notices the new bot was hesitating, holding fire so conservatively it barely shot at all, and revises the aiming threshold. Runs it again on the same seed for a fair comparison. This time it's closer. A couple more passes and the cautious bot is actually winning, and it hands you the finished code with a note on what it changed.

You steered the whole thing in sentences. It did the editing, the compiling, the running, and the reading-of-results. That's pair-programming, except your pair never gets tired of re-running the match one more time.

I'll be honest that some part of me is still adjusting to this. I built RobocodeJs so a person could feel the specific joy of writing a bot and watching their idea come alive. Handing the keyboard to an AI could sound like it skips that. But in practice it doesn't feel like skipping. It feels like having a collaborator who's fast at the mechanical parts while you stay in charge of the ideas. And for a total beginner, watching an assistant build a working bot from a plain-English description might be the gentlest on-ramp of all.

If you want to try it, grab a token and follow [the setup guide](/mcp). Then tell your assistant to build you something that wins, and watch it go to work.
