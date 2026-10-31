# Lesson 16: Connect an AI assistant

**By the end of this lesson you'll be able to:**

- Connect an AI assistant (like Claude) to your RobocodeJs account
- Ask it questions about your apps and arenas, and get a link to watch

**New idea:** _Programs can use other programs through a list of tools._

## The idea

Everything you've done so far, you did by hand: typing code in the editor, pressing **Deploy**, watching the arena. An **AI assistant** can do those same jobs for you, if you give it a way in.

That way in is called **MCP**, the [Model Context Protocol](https://modelcontextprotocol.io). It's a shared language that lets an AI use another program through a menu of **tools**. RobocodeJs offers about thirty of them: `list_apps`, `create_app`, `set_app_source`, `run_match`, and so on. Each tool is one small job, a lot like the methods on `bot` you already know. When you ask the AI to do something, it picks the right tools, calls them, and reads what comes back.

This is the same idea as your robot's API, just one level up. Your code says `bot.turn(90)` and the game turns the tank. The AI says `create_app` and the game creates an app. In both cases a program is using another program through a list of instructions it's allowed to call.

The AI only ever sees **your own** apps and arenas (the one exception is the public `leaderboard`, which anyone can read). It can't touch anybody else's code.

## Connect it

RobocodeJs's MCP server lives at this address:

```
https://robocodejs.com/api/mcp
```

There's no password or key to copy. When your assistant connects, it opens a RobocodeJs tab in your browser, you sign in the same way you do on this site, and you're sent back. Pick the steps for the assistant you use:

**claude.ai or Claude Desktop**

1. Open **Settings → Connectors → Add custom connector**.
2. Paste `https://robocodejs.com/api/mcp` as the URL and save.
3. Click **Connect**. Sign in on the RobocodeJs tab if it asks. When you're returned, the RobocodeJs tools are ready.

**Claude Code** (in a terminal)

```bash
claude mcp add --transport http robocodejs https://robocodejs.com/api/mcp
```

Then start Claude Code. The first time it uses a RobocodeJs tool, it opens your browser so you can sign in.

**Any other MCP client** works too, as long as it supports a remote (streamable HTTP) server with sign-in. Point it at the same address. The [MCP setup page](/mcp) has the full list of tools and a troubleshooting guide.

## Try it

Once connected, start a new chat and ask:

```
List my RobocodeJs apps and arenas.
```

Behind the scenes the AI calls two tools, `list_apps` and `list_arenas`, and tells you what it found. You'll see the apps you made during this course, and at least one arena. The arena marked as your **default** is the one you see on the Arena page.

Now ask:

```
What's happening in my default arena right now? Give me a link so I can watch.
```

This time it calls `arena_status`, which returns a snapshot of every bot: where it is, which way it's facing, and how much health it has. Every arena answer also carries a **watch link** (`https://robocodejs.com/watch/...`). Open it: it's the live arena, the same match the AI just described, playing in your browser. Anyone can open that link, no sign-in needed, so it's also how you show a match to a friend.

## Experiment

- Ask the AI to **explain one of your own apps** to you. It reads the code with `get_app_source`. Does its explanation match what you meant when you wrote it?
- Ask **"who is winning in my arena?"** The AI can call `match_status`, a smaller and faster report that just says whether the match is decided and who's ahead.
- Ask **"what's the top bot on the leaderboard?"** That's the `leaderboard` tool, the global Elo ranking from [Lesson 15](/learn/teamwork).
- Ask **"pause my arena"**, check the arena page, then ask it to **resume** it again.

## Common questions

**The browser tab never opened, or the connection hangs.** Start the connection again from your assistant; that restarts the sign-in. Check that pop-ups aren't blocked for robocodejs.com.

**It says "Please sign in" on the RobocodeJs page.** You're not signed in in that browser. Use **Sign in** at the top right, and the connection finishes by itself.

**The AI can't find my app.** It only sees the account you signed in with. If you have two Google accounts, make sure you connected the one that owns your apps.

**Is the AI doing something I can't?** No. Every tool matches something you can do in the editor or arena page. MCP doesn't unlock new powers. It lets the AI do the clicking and typing, and it lets it do that much faster.

**How do I disconnect?** Remove the connector in your assistant's settings. You can always reconnect later.

## You learned

- **MCP** lets an AI assistant use RobocodeJs through a list of **tools**, the same way your code uses `bot`.
- You connect by adding `https://robocodejs.com/api/mcp` to your assistant and signing in.
- The AI only sees your own apps and arenas, and every arena answer comes with a **watch link**.

---

[← Teamwork and graduation](/learn/teamwork) · [Index](/learn) · Next: [Build an app with AI →](/learn/mcp-build)
