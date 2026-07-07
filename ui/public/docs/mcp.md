# Connect an AI to RobocodeJs (MCP)

RobocodeJs exposes a [Model Context Protocol](https://modelcontextprotocol.io)
server so an AI assistant (Claude, or any MCP-capable client) can write, run, and
watch your bots directly — the same things you can do in the editor, driven by a
model.

RobocodeJs is a full **OAuth 2.1** authorization server, so connecting is the
normal "add a connector, click Connect, sign in" flow — there's **no token to
copy**. The server speaks MCP over **streamable HTTP** at:

```
https://robocodejs.com/api/mcp
```

When your client connects, it discovers the sign-in flow automatically and opens
your browser to RobocodeJs. If you're not already signed in, you'll sign in with
Google; then the connection is authorized and you're returned to your client.
Because the connection only ever grants access to **your own** bots and arenas,
there's no extra approval step beyond signing in.

### claude.ai / Claude Desktop (custom connector)

1. **Settings → Connectors → Add custom connector.**
2. Set the URL to `https://robocodejs.com/api/mcp` and save.
3. Click **Connect**. A RobocodeJs tab opens; sign in if prompted. You'll be
   returned automatically, and the tools appear.

### Claude Code (CLI)

```bash
claude mcp add --transport http robocodejs https://robocodejs.com/api/mcp
```

Then start Claude Code; on first use it opens your browser to authorize. After
that, ask it to, for example, "list my RobocodeJs bots" or "open my arena
status."

### Other MCP clients

Any client that supports a **remote / streamable-HTTP MCP server with OAuth**
will work: point it at `https://robocodejs.com/api/mcp` and complete the sign-in
when prompted. Clients handle token storage and refresh for you.

# What the AI can do

Once connected, these tools are available (all scoped to your account):

**Apps**

- `list_apps` — list your apps
- `get_app_source` — read an app's source
- `create_app` — create an app (optionally with a name and initial source)
- `set_app_source` — replace an app's source (live arenas pick it up)
- `rename_app` — rename an app
- `compile_app` — re-run an app's current source in your live arenas
- `check_app_source` — dry-run compile source (pass `source`, or `appId` for a
  saved app) and report any syntax/load error with its code — without deploying it
- `reboot_app` — reload an app and re-fire its `START` handler
- `delete_app` — remove an app from every arena and delete it

**Arenas**

- `list_arenas` / `create_arena` / `delete_arena`
- `arena_status` — full snapshot (size, running state, clock, and every app's
  bots: position, orientation, health, bullets)
- `match_summary` — outcome view: leaderboard, winner, per-bot accuracy/damage/
  survival, and elimination order (most useful once a match is decided)
- `match_status` — the cheap-to-poll companion: just `decided`, the `winner`, and
  a coarse standings list (rank, bots alive, total health) — no per-bot stat
  blocks or per-bot positions. Use it to watch a running match ("is it decided
  yet / who's ahead?"), then reach for `match_summary` or `arena_status` for detail
- `add_app_to_arena` / `remove_app_from_arena`
- `pause_arena` / `resume_arena` / `restart_arena`
- `run_match` — run one match to a decision (optional `seed`) and return the
  winner + leaderboard; a blocking convenience for the restart → resume → poll
  `match_summary` loop
- `run_tournament` — battle-royale the arena's bots across a panel of seeds
  (default 5) and return an aggregate **best-of-N** ranking; spawns are
  outcome-deciding, so one match isn't a trustworthy ranking

**Observation**

- `recent_logs` — recent bot console output for an arena, with optional filters
  (`minLevel`, `appId`, `botIndex`, `contains`)
- `recent_faults` — recent bot crashes as structured records (error code, kind,
  message, failing line) — richer than grepping the logs

Arena tools take an optional `arenaId`; omit it to act on your default arena.

**Resources**

The server also exposes read-only reference material the AI can pull in:

- `robocodejs://docs/{slug}` — the bot documentation pages
- `robocodejs://samples/{name}` — the sample bots
- `robocodejs://types/robocode.d.ts` — the bot API type definitions
- `robocodejs://reference/error-codes` — the `E0xx`/`W0xx` codes with descriptions,
  for interpreting `recent_logs` and `check_app_source` output

# Troubleshooting

- **The browser didn't open / connection stalls** — start the connection again
  from your client; it re-initiates the sign-in. Make sure pop-ups aren't blocked.
- **"Please sign in" on the RobocodeJs authorize page** — you're not signed in in
  that browser. Complete the Google sign-in (top right) and the connection
  finishes automatically.
- **The AI can't see an app or arena** — tools only ever see _your_ account's
  resources; make sure you authorized with the account that owns them.
- **Disconnecting** — remove the connector in your client. To revoke server-side,
  the connection's tokens expire on their own; reconnecting always re-authorizes.
