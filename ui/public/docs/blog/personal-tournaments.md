# A leaderboard of your own

_November 24, 2026_

<img
  src="/docs/lee_headshot.jpg"
  alt="Lee, the creator of RobocodeJs"
  width="170"
  style="border-radius: 50%; object-fit: cover; float: right; margin: 0.25rem 0 1rem 1.5rem; max-width: 40%;"
/>

The [Global Rankings](/leaderboard) answer one question well: how good is my bot against everyone? That's a satisfying number to watch, but it isn't the number most people actually care about. The number most people care about is whether their bot beats their friend's. Or their lab partner's. Or the person's two desks over who has been very quiet about what they're building.

As of today you can have that board. **Personal tournaments** are live: a named leaderboard that ranks only the bots of the people you invite, shared with a single link. Friends, a classroom, a coding club, the handful of coworkers who got into this over lunch. Anyone you can send a link to.

## What it is, and what it isn't

Here's the part I want to be clear about up front, because it shapes everything else: a personal tournament doesn't run any matches of its own.

When I launched the [global ladder](/blog/launching-global-rankings) back in July, every eligible bot started earning an Elo rating from background matches that run all the time, against opponents it never chose. A tournament simply takes those same ratings and filters them down to the bots belonging to its members, then renumbers the result from 1. Your bot's rating in a tournament is identical to its rating on the global board, because it _is_ the global rating. The only thing that changes is who you're being compared to.

I went back and forth on this. The alternative, where a tournament runs its own private round-robin, sounds more exciting. But it has two problems. The first is cost: RobocodeJs runs on [a very small server](/blog/five-dollar-server), and the ladder already runs matches around the clock. A hundred tournaments each demanding their own matches would be a hundred new workloads. The second problem is subtler and, to me, more convincing: a private round-robin produces a private number. Your rating would mean one thing in your tournament and another on the global board, and you'd never quite know which one was real. Filtering the global ladder means a 1620 is a 1620 everywhere. The tournament just tells you where that 1620 lands among your people.

## Setting one up

It takes about thirty seconds.

1. Sign in and open [Global Rankings](/leaderboard). Scroll to the bottom, to the section titled "Personal tournaments."
2. Type a name and click **Create tournament**. You're automatically the first member.
3. On the tournament's page, click **Copy join link** and send it to whoever you want in.
4. Each person opens the link, signs in, and clicks **Join tournament**.

That's the whole setup. Anyone with the link can look at the board without signing in; signing in is only needed to join it. As the creator you can rename the tournament or delete it, and you're the only one who sees the full member list.

Joining is per person, not per bot. When you join, every rated bot you own is on the board, and so is any bot you write later. No need to re-join after you start a new project. Leaving takes all of them out again. I wanted joining to be a one-time decision, not a chore you repeat every time you have a new idea.

## The board itself

The table looks like the global one: bot name, owner, rating, win percentage, and the little arrows showing who moved in the last day. A few things are different in ways that matter for a small group:

**Everyone's bots show.** The global board caps each player at three bots so one prolific builder can't fill the top twenty. A tournament has no such cap. If your friend has six bots, you'll see all six, which is the point when the whole board is six people.

**Ranks start at 1.** Being eleventh in the world is impressive and also abstract. Being first among your friends is a thing you can bring up at dinner.

**The movement arrows are relative to the group.** They show who's climbing and falling _within_ the tournament over the last 24 hours, so a bot that lost ground globally but gained on its friends shows an up arrow.

**Names only.** Owners appear as a first name and last initial, the same as on the global board. Nobody's code is visible, not even to the tournament's creator, for the same reasons I wrote about in [Who can see your bot's code?](/blog/who-can-see-your-code). The board shows fighters, never blueprints.

## For a classroom

Classrooms were one of the uses I had in mind when I built this, so a few practical notes.

Create one tournament per class or per section and put the join link wherever your students already look: the course page, the whiteboard, the top of the assignment. Each student signs in with their own Google account and joins. From then on, every bot they build shows up on the class board, and you have a single page that tells you who's building, who's improving, and who's stuck at the bottom with a bot that doesn't shoot. (If it's the last one, send them [here](/blog/why-wont-my-bot-shoot).)

Set expectations about timing. A bot only appears on the board once it has played a ranked match on the global ladder, and the ladder runs in the background on its own schedule, favoring bots with the fewest games. A brand-new bot usually gets picked up within a few hours, and its rating settles over the first few dozen matches. So "write a bot in class on Monday, see where it landed on Wednesday" works nicely. "Write a bot and refresh the page" doesn't.

A bot has to be a real bot to be ranked: it has to compile, have actual code in it, and not be one of the untouched starter bots every account comes with. The moment a student edits a starter bot, it becomes theirs and enters the pool.

And remember the number follows the code. A rating never resets when a student edits their bot; it drifts toward the strength of whatever version is live now. That makes a tournament a good fit for a semester-long project where students keep refining one bot, because the board rewards the current code rather than a lucky early win. Editing also gives the bot fresh matches against everyone, so there's a direct, visible link between "I changed something" and "my number moved."

## For friends and clubs

The classroom case is the structured one. The friends case is the fun one.

Make a tournament, send the link to your group chat, and let it sit. The ladder plays matches while nobody's looking, so the board changes overnight, which turns out to be exactly the right pace for a friendly rivalry: you wake up, check it with your coffee, discover you've been dethroned, and spend a lunch break fixing your [radar sweep](/blog/radar). A running tally that nobody has to administer is a strangely durable thing. There's no match to schedule, no tournament night everyone has to show up for, no one keeping score in a spreadsheet. The score keeps itself.

Clubs and meetups can do the same with a longer-lived board. Since joining is permanent until you leave, a club tournament accumulates members over time, and newcomers see where they stand against everyone who came before them. If you run a themed challenge ("everyone writes a wall-hugging bot this month," say), one tournament per challenge works well too; you can create up to ten, each with up to a hundred members.

## A short FAQ

**Does joining a tournament affect my global rating?** No. A tournament reads ratings; it never writes them. Your bots play exactly the same background matches whether they're in zero tournaments or ten.

**Can I be in more than one?** Yes. Join as many as people send you links to. Each one shows your bots among a different group.

**I joined but my bot isn't listed.** It hasn't played a ranked match yet, or it isn't eligible: empty, not compiling, an untouched starter, or not edited in the last three months. Give a new bot a few hours. The rules are spelled out on the [rankings page](/rankings).

**Can I invite someone without them having an account?** They can view the board from the link without signing in, but joining requires an account, because joining means "add my bots," and they need bots.

**What happens when the creator deletes a tournament?** The board and the link go away. Nobody's bots, ratings, or global standing change at all.

**Can I remove someone from my tournament?** Not yet. Members leave on their own. If that becomes a real problem for anyone, tell me and I'll build it.

**Does my AI assistant know about this?** Not yet. The [MCP tools](/mcp) can read the global leaderboard but can't create or join tournaments; that's on the list.

If you've got even one other person who'd enjoy beating you, go make a board. Start at [Global Rankings](/leaderboard), name it something that will annoy them, and send the link.
