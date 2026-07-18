# My co-worker is a language model

_April 14, 2026_

<img
  src="/docs/lee_headshot.jpg"
  alt="Lee, the creator of RobocodeJs"
  width="170"
  style="border-radius: 50%; object-fit: cover; float: right; margin: 0.25rem 0 1rem 1.5rem; max-width: 40%;"
/>

Solo development is lonely in a specific way: not the being-alone part, but the lack of anyone to think _out loud_ with. No one to say "does this seem off to you?" No one to catch the obvious thing you've been staring past for an hour. RobocodeJs has been that kind of project for most of its life: one person, one head, every decision and every bug living and dying with me.

Let me be precise about the foundation first, because it matters to me. I wrote the original RobocodeJs entirely by hand: the design, the architecture, the sandbox, the simulation, the bones of the whole implementation are mine, built up over years of evenings. What changed in the last stretch isn't who built this thing. It's the company I keep while evolving it. Not because I hired anyone (it's still just me) but because I started working alongside a language model, and the day-to-day shape of the work is different now. I want to be honest about what that's like, because the marketing version and the real version don't fully overlap.

## What actually changed

The biggest shift is that I'm never stuck at zero anymore. Speed matters less than I expected.

Solo, the expensive moments were never the typing. They were the stalls: sitting in front of a problem I half-understood, not sure which thread to pull, burning an evening on the _approach_ before I'd written a line. Now I can think out loud with something that answers. I describe the problem, it proposes a shape, and even when the shape is wrong, having a concrete wrong answer to react to is worth more than a blank page. Disagreeing with a draft is so much faster than producing one from nothing.

It also changed my habits, and mostly for the better. I make _smaller_ changes now. When you're pairing with something that can generate a lot of plausible code fast, the discipline that matters is keeping each step small enough that you can actually review it. So I lean harder on the things that were always good practice: little diffs, run the tests, read every line before it lands. The AI made me a more careful reviewer precisely because it made producing code so cheap. If I stopped reading closely, I'd be in trouble fast.

The moments that actually sold me weren't about code at all. It reads the application logs with me and points out places where players are quietly having a worse time than they should, the kind of small friction I'd long since stopped seeing. It suggests feature ideas by imagining different kinds of players and asking what each of them would want next, and then it helps me prioritize the list, plan the work, and ship it. That's not autocomplete. That's a colleague with opinions about the roadmap.

## Where it shines

It's fantastic at the stuff that's _knowable but tedious_. Boilerplate. Wiring up a new endpoint that looks like four existing ones. Writing the first draft of a test. Explaining a stack trace from a library I don't use often. Remembering the exact incantation for a tool I touch twice a year. These are the tasks where the answer exists and the only cost is friction, and friction is exactly what it eats.

It's also a surprisingly good rubber duck. Half the time I don't even need its answer; the act of writing the problem down clearly enough to hand over is what unsticks me. It just happens that this rubber duck also occasionally hands back something useful.

## Where it doesn't

It does not hold the whole system in its head the way I do. It doesn't remember why I made a weird decision six months ago, or which shortcut is load-bearing, or that two files that look independent are secretly coupled by an assumption written nowhere. It will confidently produce something that's locally correct and globally wrong, and it will do it in clean, convincing code that reads like it knows what it's doing. That's the real hazard: not obvious garbage, but plausible mistakes.

So the judgment stays mine. It's superb at "how" and unreliable at "should." It'll implement any idea I give it, including the bad ones, without the flicker of doubt a human collaborator would have. The taste, the architecture, the calls about what this game _is_: none of that has moved, and I don't want it to.

## How I feel about it

Complicated, honestly, and I'd distrust anyone who told you it's simple. Some days it feels like the collaborator I never had on a solo project, and the work is more fun for having someone, or something, in the room. Other days I catch myself reaching for it before I've done any thinking of my own, which is its own kind of trap. The tool is good enough that _not_ using your own head becomes an option, and that option is a slow poison for the parts of the craft I care about most.

Where I've landed, for now: it's a co-worker, and a good one, but I'm still the one whose name is on the thing. It drafts; I decide. That division of labor is the whole game, and as long as I keep it, this is the most productive, and least lonely, this project has ever been. If you want to see what happens when you point one of these models at the game itself instead of the codebase, I wrote about that too, over in [pair-programming a bot](/blog/pair-programming-a-tank).
