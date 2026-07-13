# The user who reads the manual

_July 28, 2026_

<img
  src="/docs/lee_headshot.jpg"
  alt="Lee, the creator of RobocodeJs"
  width="170"
  style="border-radius: 50%; object-fit: cover; float: right; margin: 0.25rem 0 1rem 1.5rem; max-width: 40%;"
/>

Earlier this year I gave AI assistants a way to play RobocodeJs:
[an MCP server](/blog/pair-programming-a-tank) with a few dozen tools for writing bots,
running matches, and reading the results. I wrote about what it does for players back
then. This post is about the other side of it, because building an interface for an AI
turned out to be the strangest API design work I've ever done, and it taught me things I
didn't expect.

Here's the shape of the strangeness. Every user I'd ever designed for skims. People
don't read docs; they click the biggest button, try something, and back out if it looks
wrong. An AI assistant is the opposite user. It reads everything you give it, takes every
word literally, and then does exactly what the words say, including the words you didn't
mean.

## Naming is behavior

With human users, a sloppy name costs a support question. With an AI, a sloppy name costs
a wrong action, immediately and confidently.

Early versions of my tools took a bare `id` parameter. Which id? The app's? The arena's?
A human squints at context and guesses right. The assistant guessed too, and when it
guessed wrong it didn't hesitate or ask, it just called the tool with the wrong id and
kept going. The fix was almost embarrassing in its simplicity: call the thing `appId` or
`arenaId`, everywhere, without exception. Wrong calls mostly stopped.

Same story with results. If a tool that pauses the arena returns a generic `updated:
true`, the assistant can't tell whether it paused, resumed, or did nothing. So every
action now answers with the verb it performed: `paused`, `resumed`, `restarted`. It reads
like pedantry. It works like magic. Precision that would be politeness for a human is
load-bearing for a machine.

## Give it eyes before you give it hands

My first instinct was to expose actions: create the bot, save the code, run the match.
The tools I added later turned out to matter more: read the match summary, read the
logs, read the recent faults, check the platform's health.

Without those, the assistant was a code generator with a lever to pull. It would write a
bot, run a match, and have no idea what happened next. With them, it became something
closer to a collaborator: it watches the fight it just started, notices its bot never
fired, reads the log, and fixes the actual problem. If you're building tools for an AI,
the observability tools aren't the garnish. They're the difference between an intern who
leaves after handing you a file and one who sticks around to see if it worked.

And because this user reads the manual, the manual is part of the API. The server hands
the assistant the full bot documentation, the type definitions, and the sample bots as
resources it can pull up whenever it wants. It uses them constantly. Somewhere in there
is a small career irony: after decades of writing docs nobody reads, I finally have a
user who reads every word.

## The tool I had to take away

Not everything survived contact. At one point there was a tournament tool that could run
a whole bracket of matches in one call. It seemed convenient. It was a trap. A single
call that runs for minutes holds everything else hostage, and an eager assistant will
happily stack up three of them. I removed it, put a hard wall-clock limit on running a
single match, and made sure concurrent matches can't pile up. The lesson generalizes:
an AI will use whatever you expose at full throttle, so a tool's worst case matters more
than its best case. Design the ceiling, not the demo.

The same thinking applies to safety. Every MCP tool acts only on the token owner's own
bots and arenas, mirroring the exact ownership rules the website enforces. The assistant
gets your keys, not the building's. That was non-negotiable from day one, for reasons I
wrote about when I let [an AI near my deploys](/blog/letting-claude-ship): the boundary
has to be structural, not behavioral.

## The punchline

The strangest part is where all this rigor ended up. Renaming parameters until they can't
be misread, returning honest verbs, exposing what happened and not just what to do,
bounding the worst case: none of that is AI-specific. It's just good API design that I'd
been getting away with not doing. The literal-minded user didn't need a special
interface. It needed the interface I should have built anyway, and it refused to work
until I did.

If you want to try the result, the setup guide is at [/mcp](/mcp). And if you're building
tools for assistants yourself, design for the user who reads everything. It sets a higher
bar, and everyone else gets to clear it too.
