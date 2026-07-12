# I let an AI push to production

_June 9, 2026_

<img
  src="/docs/lee_headshot.jpg"
  alt="Lee, the creator of RobocodeJs"
  width="170"
  style="border-radius: 50%; object-fit: cover; float: right; margin: 0.25rem 0 1rem 1.5rem; max-width: 40%;"
/>

The first time I typed something like "cut a release and ship it" to an AI assistant and
then watched a deploy roll out to the real server that real people use, my stomach did a
little flip. Production is production. There's a version of this sentence that ends with a
horror story, and I'd read plenty of them.

It didn't end that way, and the reason it didn't is that the scary part, "AI pushes to
prod," is the least interesting part of the setup. The interesting part is the
plumbing around it, which I'd built long before an AI ever touched it, specifically so
that no single actor, human or otherwise, could do something irreversible by accident.

[PERSONAL: the specific moment an AI assistant either genuinely saved you or genuinely
scared you during a deploy — what happened, what you were doing.]

## What "shipping" actually is here

RobocodeJs runs on AWS Elastic Beanstalk on a small instance. But deploying doesn't mean
copying files onto the server and crossing your fingers. A deploy is a chain of steps,
each of which is boring on purpose:

- **Cut the release.** One script builds the UI and the server, bumps the version, and
  regenerates the lockfile. Same steps, same order, every time.
- **Nothing deploys on a merge.** Merging a change to `main` does not touch production.
  Let me say that again, because it's the load-bearing wall: merging is not shipping.
- **Deploys are triggered by a version tag.** Production only updates when someone pushes
  a `vX.Y.Z` git tag. The pipeline watches for that tag and nothing else.
- **Immutable deploys with a health check.** New instances come up alongside the old ones
  and have to pass a `/health` check before traffic moves. If the new version can't stand
  up, the old one keeps serving. Zero downtime, and a bad build doesn't take the site
  down. It just fails to replace the good one.

So "let the AI ship" really means: let the AI run the boring, well-defined command and,
if I choose, push the tag that the whole safety net is built around.

## The guardrail is that a human pushes the tag

Let me lay out the boundary I drew, and why.

An AI assistant is very good at the parts that are procedure. It'll build, run the
package step, tell me the new version number, write the commit, and lay out exactly what
would happen next. That's real work and it removes real friction. What I keep for myself
is the single irreversible act: **pushing the release tag.** That one keystroke is the
thing that moves production, and I want a human deciding, in that specific second, that
this is the moment.

I do trust the tools. But the tag push is the one step designed to be the point of no
return, so it's the one step where a human pausing for two seconds is worth the friction.
Everything upstream of it (the build, the version bump, the summary of what's about to
change) is fair game to hand off, because none of it deploys anything. And everything
downstream (the immutable rollout, the `/health` gate) is automated so that even a
mistake at the tag has a floor under it.

For scale, here's what a release used to look like when it was all me: build the UI,
build the server, run the packaging script, commit the version bump it produces, tag the
release, push the tag, and then sit there refreshing the AWS console until the health
check went green. None of it hard, all of it fussy, every step an opportunity to do
things slightly out of order and spend the evening figuring out what I'd done. The
checklist never scared me. My ability to follow a checklist at 11pm did.

## Where it helps, and where it doesn't

Where it helps: the tedium. Remembering the exact convention for the bump commit message.
Not fat-fingering the version number. Catching that I forgot to build the UI before
packaging. These are exactly the small, repetitive, easy-to-botch things that cause
outages precisely because they're beneath your attention.

Where it doesn't: judgment about _whether_ to ship. An assistant will happily tell me a
release is ready when the only thing it checked is that the build passed. It doesn't know
that I promised myself I'd never deploy on a Friday afternoon, or that there's a known
flaky thing I want to eyeball first. That judgment stays mine, and I think it should.

So no, I didn't hand production to a machine. I handed it the checklist, kept the one
button that matters, and built the whole system so that even the button has a safety net
under it. That's the version of "AI in production" I can sleep next to. If you're
curious how the AI reaches into RobocodeJs itself, that's a different door,
[the MCP setup](/mcp), but the deploy pipeline is the part I was most nervous to open,
and it turned out to be the part I trust the most.
