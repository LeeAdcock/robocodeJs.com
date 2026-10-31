# Lesson 18: Test your app with AI

**By the end of this lesson you'll be able to:**

- Set up a test arena and run whole matches with one request
- Compare two versions of your app fairly, and find out why it lost

**New idea:** _One match is a story; many matches are evidence._

## The idea

In [Lesson 17](/learn/mcp-build) you built Scout and checked that its code was **written** correctly. Now the real question: is it any **good**? The only way to find out is to make it fight, and to do that in a way you can trust.

Here's the catch. At the start of every match, bots are dropped at **random** places, facing random directions. A bad spot can lose a match for a great bot, and a lucky spot can win one for a weak bot. So a single match tells you a story about that one match, not a fact about your bot.

The fix is randomness you can repeat. Every match runs on a number called a **seed**. The same seed always lays out the same starting spots, and because bots can't see the real clock and even their random numbers come from the seed, the same seed and the same code play out **exactly** the same match, every time. That gives you two powerful testing tools:

- **Many seeds** smooth out luck: run ten matches on ten seeds and count the wins.
- **The same seeds** make a fair comparison: test the old Scout and the new Scout on the same ten layouts, and any difference comes from your change, not from luck.

## Try it

**1. Make a test arena.** Testing restarts matches, so it's best done somewhere other than your main arena. Ask:

```
Create a new arena for testing. Add Scout to it, plus a sparring partner:
make an app from the Lighthouse example bot and add that too.
```

The AI calls `create_arena`, reads the [Lighthouse](/samples/lighthouse) sample, creates it as a new app with `create_app`, and adds both with `add_app_to_arena`. A match needs at least two apps.

**2. Run one match.**

```
Run a match in my test arena and tell me who won.
```

That's `run_match`: it restarts the arena, runs it as fast as the server can until only one app has bots left, then pauses it and reports the winner and a leaderboard (health, damage, accuracy, and when each bot was knocked out). It takes seconds, not minutes. The arena is left **paused** afterwards, so ask the AI to resume or restart it if you want to watch.

**3. Run many matches.** Now gather real evidence:

```
Run 10 matches in my test arena with seeds 1 through 10 and give me a
table of the winners.
```

Maybe Scout won 7 of 10. That's a fact about Scout against Lighthouse, far more trustworthy than one match.

**4. Find out why it lost.** Pick one of the seeds Scout lost and ask:

```
Scout lost on seed 4. Look at the recent faults and logs for the test
arena and tell me why.
```

`recent_faults` lists any crashes (the error code, what went wrong, and the line it happened on). `recent_logs` shows the bots' `console.log` output. Together they're how the AI explains a loss. Many assistants also offer a ready-made `debug_app` prompt that runs this whole investigation for you.

**5. Change one thing, then test again on the same seeds.**

```
Make one change to Scout to fix that. Then run seeds 1 through 10 again
and compare with the last table.
```

Same ten layouts, one change. If the wins go from 7 to 9, your change helped. If they drop, undo it. This loop (**measure, change one thing, measure again**) is how real programmers improve anything, from robots to websites.

## Look closer: one tick at a time

Sometimes you need to see exactly what happened in a single moment, like the tick a bot drives into a wall. Ask the AI to set a seed and restart (`set_arena_seed`, `restart_arena`), **pause** it (`pause_arena`), then **step** it forward a few ticks at a time (`step_arena`), reading `arena_status` in between. It's like watching a replay frame by frame. Open the watch link while you do it, and you'll see the arena move one step each time.

To just watch more slowly (or quickly), ask for a different speed: `set_arena_speed` with `0.5` is half speed, `2` is double.

## Experiment

- Run seed 4 **twice**. Is the result exactly the same both times? (It should be. If it isn't, ask the AI to compare the app versions: something changed.)
- Swap Lighthouse for a tougher partner: [Squad](/samples/squad), then [Marksman](/samples/marksman). How does Scout's win count change?
- Ask the AI to run 20 seeds instead of 10. Does the win rate settle down as you add more matches?
- Once Scout is beating your sparring partners, look at the global [leaderboard](/leaderboard). The ladder plays every eligible app against everyone else's, so its Elo rating is the toughest test of all.

## Common questions

**`run_match` says the arena needs at least two apps.** Add another app to the test arena with `add_app_to_arena`. Your own older apps make good sparring partners too.

**It said `timedOut`.** The match wasn't decided in time (by default, a minute of real time). This can happen when bots avoid each other; the match keeps running until health decay forces a winner. Ask the AI to try again with a longer `timeoutMs`.

**Why not just run tests in my main arena?** You can, but `run_match` restarts and then pauses whatever arena it's given. A separate test arena leaves your main match alone.

**Scout wins every test but does badly on the leaderboard.** Your sparring partners aren't the whole world. Ten seeds against one opponent is good evidence about that opponent. The ladder is evidence about everyone.

## You learned

- Starting spots are random, so **one match is a story; many matches are evidence**.
- A **seed** makes a match repeatable. Same seed + same code = same match.
- `run_match` plays a whole match in seconds; run it across many seeds and count the wins.
- To compare two versions fairly, test both on the **same seeds** and change **one thing** at a time.
- `recent_faults` and `recent_logs` explain why a bot lost; `step_arena` lets you replay a moment tick by tick.

You can now write, check, ship, and test bots with an AI as your partner, and you understand every step it takes for you. Go build something clever.

---

[← Build an app with AI](/learn/mcp-build) · [Index](/learn)
