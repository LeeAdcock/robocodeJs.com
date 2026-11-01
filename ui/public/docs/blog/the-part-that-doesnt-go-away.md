# The part of the job that doesn't go away

_December 22, 2026_

<img
  src="/docs/lee_headshot.jpg"
  alt="Lee, the creator of RobocodeJs"
  width="170"
  style="border-radius: 50%; object-fit: cover; float: right; margin: 0.25rem 0 1rem 1.5rem; max-width: 40%;"
/>

The [Learn course](/learn) has a new ending. After fifteen lessons of writing a bot by hand, there's now a **Part 5: Coding with an AI assistant**, three lessons where you connect an assistant to your account and let it write, check, ship, and test bots alongside you. I want to explain why those lessons exist, why they come last, and what I think they're really teaching, because the answer has less to do with AI than the title suggests.

## The job is changing

I've been writing software for most of my life, and the job has changed under me more than once. Compilers made assembly a specialty. IDEs made whole classes of typo extinct. Search engines meant nobody had to memorize an API again. Each time, the thing that got cheap was something we'd previously mistaken for the job itself, and each time the job turned out to be something else.

This time the thing getting cheap is the typing. A sentence of plain English becomes working code in seconds, and the code is usually fine. I've written about [what that's like day to day](/blog/building-with-an-ai-copilot) on this project, and about [letting an assistant run the release](/blog/letting-claude-ship). The short version: I read far more than I write now, I make smaller changes than I used to, and I am a more careful reviewer than I have ever been, because producing plausible code costs nothing and plausible is not the same as right.

What's left when the typing is cheap? Knowing what you want precisely enough to say it. Knowing whether what came back is actually what you asked for. Finding out why it isn't. Deciding what to change next. Those were always the job. We just taught the typing because it was the visible part. Now they're nearly all of it, and they're what I want a student to leave this course with.

## The worry

There's an obvious worry here for anyone learning to code today: if the machine writes it, why learn? And there's a subtler one that I take more seriously. A student who starts with the assistant never builds the muscle to tell good code from code that merely looks good. The hazard with these tools isn't garbage. Garbage is easy to spot. The hazard is clean, confident, well-named code that does the wrong thing, and the only defense against it is being able to read.

So Part 5 is deliberately at the end. You get there after you can write a bot yourself. Not as a rite of passage, but because the assistant is a faster pair of hands, and a pair of hands is only useful to someone who knows what they're trying to build. [Lesson 17](/learn/mcp-build) puts it bluntly: code you don't understand is code you can't fix.

## What the three lessons actually teach

Each lesson has a tool on the surface and a habit underneath. The tools are specific to RobocodeJs and will change. The habits are the point.

[**Lesson 16: Connect an AI assistant.**](/learn/mcp-setup) The surface is setup: pointing Claude, or any MCP client, at the game and signing in. The idea underneath is that programs use other programs through a list of tools. Your code says `bot.turn(90)` and the game turns the tank. The assistant says `create_app` and the game creates an app. It's the same shape one level up, and once a student sees that, "AI integration" stops being magic and becomes an API like any other. The lesson also makes a promise I think matters: the assistant can do nothing you can't do yourself. It has your permissions, your apps, and your arena. It just clicks faster.

[**Lesson 17: Build an app with AI.**](/learn/mcp-build) The surface is asking for a bot and getting one. The habit is a rhythm every working programmer follows: write, check, ship, watch. The check step is the big one. The assistant runs the code in a throwaway sandbox before anything touches the arena, so a broken idea never reaches the field. Then the lesson asks the student to open the code the assistant wrote and read it, line by line, and to make every change one idea at a time so it's obvious which change helped. Every save comes back with a version fingerprint, and the lesson teaches the question a professional asks a dozen times a day: is what's running actually the thing I just saved?

[**Lesson 18: Test your app with AI.**](/learn/mcp-test) The surface is running matches. The habit is the one I'd most want a student to carry out of this course: one match is a story, many matches are evidence. Spawn positions are random, so a single win proves nothing. The lesson has the student run ten seeds and count, then change one thing and run the same ten seeds again. That's a controlled experiment, and the student is doing it without ever hearing the phrase. When a seed loses, they read the faults and the logs to find out why, and when they need to see a single moment, they step the arena forward one tick at a time. Measure, change one thing, measure again. Nothing about that is specific to bots, or to AI.

## What future-proof actually means

I can't tell you which assistant will matter in five years, or whether the protocol these lessons use will still be the one everybody speaks. Anyone who claims to know is guessing. What I'm fairly sure of is that no tool is going to make these four things optional: saying precisely what you want, reading what you got, proving whether it works, and knowing what to change next. Every tool shift I've lived through made those skills more valuable, not less, because each one removed a layer of busywork that had been hiding them.

A student who finishes all eighteen lessons has practiced each of those twice. Once by hand, with a bot they built from nothing, and once by directing an assistant and checking its work. More importantly, they can feel the difference between the two, and they know which parts of the second depend on the first. That's the version of future-proof I can actually deliver: not a bet on a tool, but a habit of staying in charge of the ideas while the tools get better at the rest.

If you've finished Part 4, [Lesson 16](/learn/mcp-setup) is waiting. If you haven't started, start at [Lesson 1](/learn/hello). The order is the point.
