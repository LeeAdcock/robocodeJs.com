# Keeping a game online for the price of a coffee

_November 11, 2025_

<img
  src="/docs/lee_headshot.jpg"
  alt="Lee, the creator of RobocodeJs"
  width="170"
  style="border-radius: 50%; object-fit: cover; float: right; margin: 0.25rem 0 1rem 1.5rem; max-width: 40%;"
/>

Every battle you've ever watched on this site (every tank, every bullet, every match)
happens on a single small computer humming away in an Amazon data center, and it costs
me [PERSONAL: roughly what you actually pay per
month to keep it online, if you want to share it]. There's a myth that anything alive
on the internet must be sitting on racks of serious infrastructure. This one isn't. It's
one modest box on AWS Elastic Beanstalk, Node 24 on Amazon Linux. That's the whole
data center.

I chose small on purpose. This is a hobby project I want to keep alive for years, not a
startup that has to justify a bill. And the discipline of "it has to run cheap" has
made it a better-built thing. But cheap has teeth, and one night it bit me.

## The night it ran out of memory

The catch with a small server is memory. Every match that's running holds bots in
memory (separate sandboxes, each with its own footprint), and if enough of them stack
up at once, a small box just doesn't have the RAM. When a Linux process asks for
memory that isn't there, it doesn't politely wait. It gets killed. And the process that
gets killed is usually the big one, which is to say: the game.

[PERSONAL: the night it actually went down — what you were doing when you noticed, how
you found out, what the scramble was like.]

The fix turned out to be almost embarrassingly old-fashioned: a **swap file**. Swap is
disk space the operating system can use as pretend-memory when the real memory runs out.
It's slower, since a hard drive is standing in for RAM, but "slower" is a wonderful problem
to have compared to "dead." With a swap file configured, the box gets to lean on disk
during a spike instead of falling over. It's the server equivalent of a shock absorber.
It doesn't make the car faster; it stops the bump from breaking something.

I still find it funny that the answer to a modern problem (untrusted sandboxes eating
RAM) was a technique older than I am. Sometimes the frugal fix and the correct fix are
the same fix.

## Deploying without going dark

The other thing cheap-and-solo forces you to get right is deploys: the moments when new
code replaces old on the live site. When it's just you, there's nobody to catch a bad
push at 11pm. So I lean on two habits that make releases boring, which is the highest
compliment I can pay a release.

The first is **immutable deploys**. Instead of updating the running server in place,
which risks a half-updated box serving broken pages, a brand-new instance is spun up
alongside the old one, health-checked at a `/health` endpoint, and only swapped in once
it reports healthy. If the new one is broken, the old one keeps serving and nobody
notices. Players in the middle of a match don't see a blip.

The second is that **deploys are tag-triggered**. Merging code to my main branch does
_not_ ship anything. A deploy only happens when I push a version tag, like `v1.2.82`.
That sounds like a small distinction, but it's saved me from myself more than once: it
means "I integrated some work" and "I released to the world" are two separate, deliberate
actions. I can merge all day and the live site doesn't twitch until I decide it's time.

## What "good enough" hosting means

I think there's a temptation, when you build something people start to use, to
over-engineer the foundation: multiple servers, auto-scaling fleets, the works. For a
hobby project that would be a trap. It would cost more, it would be more to maintain, and
it would rob me of the constraint that keeps the code honest. If the game has to fit on
one small box, then I can't get sloppy about memory, and I can't ship features that only
work if I throw hardware at them.

So "good enough" here means: it stays up, it recovers from a spike instead of dying to
one, and a bad deploy can't take it down. That's the bar. Not five nines of uptime for a
game where the stakes are a tank drawing on a screen, just a reliable, cheap, boring box
that's still going to be here next year.

A lot of that same constraint shows up elsewhere, like in how the game streams matches
to your browser (I wrote about that in
[Watching a battle, live](/blog/streaming-the-arena)). Cheap infrastructure is part of
the design, not a compromise I apologize for.
