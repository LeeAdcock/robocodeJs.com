# How the rankings work

The [Global Rankings](/leaderboard) board shows the strongest bots across every player, scored by an **Elo rating**, the same head-to-head system used in chess. In the background, RobocodeJs quietly matches bots against one another and lets them fight; winners climb, losers slip. This page explains how a bot gets onto the board, how ranked matches are run, and exactly how the rating math works.

Ratings ride your bot's **current code**. Improving your logic and letting it keep playing pushes the score up; a change that makes it weaker (or neglecting it while others improve) drifts it back down. Editing a bot never resets its rating. It just clears any "broken" flag so the bot can be matched again.

# Getting on the leaderboard

Only bots that have actually played a ranked match appear on the board. To be picked for the background ladder, a bot must meet **all** of these:

- **Not deleted, and not flagged broken.** A bot that fails to compile or crashes through a whole match gets flagged broken and sits out until you edit it again.
- **Has real code.** Empty source is skipped.
- **Not an untouched starter.** The starter bots seeded into every new account ("My First Bot" and "Target Practice") only enter the ladder once you've edited them, so the board isn't flooded with identical 1500-rated clones.
- **Recently edited.** The bot's source must have been changed within the last **3 months**.
- **Owner recently active.** The owner must have signed in within the last **3 months**.

The **display board** adds a couple of rules on top of eligibility:

| Board rule | Detail |
| --- | --- |
| Must have played | Only bots with at least one ranked game are shown. |
| Broken / deleted | Excluded. |
| Demo bots | The built-in demo account's bots never appear. |
| Per-owner cap | Each player shows at most **3** bots on the board, so one prolific player can't fill it. |
| Order | By **rating** (highest first), then by number of ranked games as a tie-break. |

The board shows each bot's name, its owner (abbreviated), its rating, and its win percentage. It never exposes anyone's source code.

# How ranked matches run

The ladder is a background system: you don't schedule matches, and there's no button to press. It runs continuously on the server, one match at a time, and politely **yields to live players**: when real arenas are busy, ranked matches back off so they never slow down someone who's actually playing.

Each ranked match is:

- **One-on-one.** Two bots (two teams of five) battle in a private, throwaway arena that isn't saved anywhere.
- **Randomly seeded.** Starting positions and orientations come from a random seed, so every match is a fresh scenario.
- **Decisive.** The match runs at full speed until one side is wiped out. To prevent stalemates, a **sudden-death** phase eventually forces a finish by slowly decaying health, so every ranked match produces a winner. (The match clock resets at the start of each match, so nobody inherits the previous match's sudden-death timer.)

Matchmaking is lightly biased so the ratings converge on something meaningful rather than pairing at pure random: it favors the **least-played** bots (so new bots get games and their ratings settle quickly) and then picks an opponent **closest in rating** (since evenly matched fights carry the most information). You can't choose your own opponent, which keeps anyone from farming easy wins.

# How ratings are calculated (Elo)

RobocodeJs uses standard [Elo rating math](https://en.wikipedia.org/wiki/Elo_rating_system). Every bot starts at a fixed rating; after each match, the two ratings shift based on who was expected to win.

| Constant | Value | What it means |
| --- | --- | --- |
| Starting rating | **1500** | Where every brand-new bot begins. |
| Placement games | **10** | A bot's first 10 ranked matches use a bigger swing. |
| Placement K-factor | **40** | The maximum a rating can move per game during placement. |
| Established K-factor | **24** | The maximum per-game move once placement is over. |

**Expected score.** Before a match, each bot has an expected chance of winning based on the rating gap. The formula is the classic logistic curve:

```
expected(A) = 1 / (1 + 10^((ratingB − ratingA) / 400))
```

A **400-point** rating gap means the favorite is expected to win about **91%** of the time. Equal ratings mean a 50/50 expectation.

**The update.** After the match, a bot's rating moves by

```
new = old + K × (actualScore − expectedScore)
```

where `actualScore` is **1** for a win and **0** for a loss, and `K` is the bot's K-factor. Because the move scales with the surprise, **upsets count for more**: beating a much stronger bot gains you a lot, while beating a much weaker one you were expected to beat gains you very little. Losing works the same way in reverse.

**Placement vs. established.** For its first **10** matches a bot uses the larger K-factor of **40**, so its rating moves fast and homes in on its true strength quickly. After that, K drops to **24**, so an established rating is steadier and only changes gradually. Each bot uses its own K-factor in a given match, so a brand-new bot in placement can swing more than the settled opponent it just faced.

Ratings are stored and shown as **whole numbers** (they're rounded after each update).

# On-demand matches (MCP)

Separate from the background Elo ladder, you can run matches on demand through the [MCP integration](/mcp), handy when you want to compare the bots in one of your arenas head-to-head, right now. There's no button for it in the UI; it's available as the `run_match` tool for an AI assistant (or any MCP client) connected to your account.

`run_match` restarts your arena, runs a single match to a decision, and returns the winner and leaderboard. Because a single match is very sensitive to the random starting positions (the same bots can flip between first and last from one seed to the next), one match isn't a trustworthy ranking. For a best-of-N, call `run_match` across several `seed`s and aggregate the placements yourself (e.g. award N points for 1st down to 1 for last, summed across the seeds). Unlike the ladder, these matches don't touch anyone's Elo rating.

---

See also: the [game rules & physics](/rules) for how combat is resolved, the [Global Rankings](/leaderboard) board itself, and [Connect an AI (MCP)](/mcp) to run matches.
