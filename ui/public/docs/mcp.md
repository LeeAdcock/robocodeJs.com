# Connect an AI to RobocodeJs (MCP)

RobocodeJs exposes a [Model Context Protocol](https://modelcontextprotocol.io)
server so an AI assistant (Claude, or any MCP-capable client) can write, run, and
watch your bots directly — the same things you can do in the editor, driven by a
model.

This page is unlisted; it's here if you know the URL.

## 1. Get an API token

The MCP server authenticates with a personal API token. To mint one:

1. **Sign in** to RobocodeJs in your browser (the normal Google sign-in).
2. In the **same browser**, visit:

   ```
   https://robocodejs.com/api/token/new
   ```

   (Replace `robocodejs.com` with the host you use.) You'll get back something
   like:

   ```json
   { "token": "81c9cbc3-e863-4b02-885e-365c6a1a52d2" }
   ```

3. **Copy the token** and keep it somewhere safe.

A few things to know:

- The token is only stored as a hash, so it is shown **once**. We can't recover
  it — if you lose it, just mint a new one.
- **Each visit to `/api/token/new` creates a fresh token and invalidates the
  previous one.** That's also how you "revoke": mint a new token and the old one
  stops working immediately.
- Treat the token like a password. It grants full control of _your_ bots and
  arenas (and nothing else — it can't touch other users).

## 2. Point your client at the MCP server

The server speaks MCP over **streamable HTTP** at:

```
https://robocodejs.com/api/mcp
```

Authenticate by sending your token as a bearer header:

```
Authorization: Bearer <your-token>
```

### Claude Code (CLI)

```bash
claude mcp add --transport http robocodejs https://robocodejs.com/api/mcp \
  --header "Authorization: Bearer 81c9cbc3-e863-4b02-885e-365c6a1a52d2"
```

Then start Claude Code and ask it to, for example, "list my RobocodeJs bots" or
"open my arena status."

### Other MCP clients

Any client that supports a **remote/streamable-HTTP MCP server with a custom
header** will work: point it at `https://robocodejs.com/api/mcp` and add the
`Authorization: Bearer <token>` header.

> Note: clients that only support OAuth-based remote connectors (rather than a
> custom header) aren't supported yet — bearer-token auth is the only mechanism
> for now.

### Local development

When running the server locally in dev mode, authentication is bypassed (every
request acts as the built-in "Local Dev" user), so you can connect to
`http://localhost:5000/api/mcp` **without a token**.

## 3. What the AI can do

Once connected, these tools are available (all scoped to your account):

**Bots**

- `list_bots` — list your bots
- `get_bot_source` — read a bot's source
- `create_bot` — create a bot (optionally with a name and initial source)
- `set_bot_source` — replace a bot's source (live arenas pick it up)
- `rename_bot` — rename a bot
- `compile_bot` — re-run a bot's current source in your live arenas
- `check_bot_source` — dry-run compile source (pass `source`, or `appId` for a
  saved bot) and report any syntax/load error with its code — without deploying it
- `reboot_bot` — reload a bot and re-fire its `START` handler
- `delete_bot` — remove a bot from every arena and delete it

**Arenas**

- `list_arenas` / `create_arena` / `delete_arena`
- `arena_status` — full snapshot (size, running state, clock, and every bot's
  tanks: position, orientation, health, bullets)
- `add_bot_to_arena` / `remove_bot_from_arena`
- `pause_arena` / `resume_arena` / `restart_arena`

**Observation**

- `recent_logs` — recent bot console output for an arena, with optional filters
  (`minLevel`, `appId`, `tankIndex`, `contains`)
- `recent_faults` — recent bot crashes as structured records (error code, kind,
  message, failing line) — richer than grepping the logs

Arena tools take an optional `arenaId`; omit it to act on your default arena.

**Resources**

The server also exposes read-only reference material the AI can pull in:

- `robocodejs://docs/{slug}` — the bot documentation pages
- `robocodejs://samples/{name}` — the sample bots
- `robocodejs://types/robocode.d.ts` — the bot API type definitions
- `robocodejs://reference/error-codes` — the `E0xx`/`W0xx` codes with descriptions,
  for interpreting `recent_logs` and `check_bot_source` output

## Troubleshooting

- **401 from `/api/mcp`** — the token is missing, mistyped, or has been rotated
  by a later visit to `/api/token/new`. Mint a fresh one and update your client.
- **`/api/token/new` returns 401** — you're not signed in _in that browser_. Sign
  in first, then revisit the URL.
- **The AI can't see a bot or arena** — tools only ever see _your_ account's
  resources; make sure you're using the token minted under that account.
