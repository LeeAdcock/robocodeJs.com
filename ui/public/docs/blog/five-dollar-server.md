# Keeping a game online for the price of a coffee

_November 11, 2025_

<img
  src="/docs/lee_headshot.jpg"
  alt="Lee, the creator of RobocodeJs"
  width="170"
  style="border-radius: 50%; object-fit: cover; float: right; margin: 0.25rem 0 1rem 1.5rem; max-width: 40%;"
/>

Every battle you've ever watched on this site (every tank, every bullet, every match)
happens on a single small computer humming away in an Amazon data center, and most
months it costs me nothing at all. The server and its little database both fit inside
AWS's free tier. What I actually pay for is the exceptions: release days, when two
copies of the site briefly run side by side, and the occasional busy stretch when an
extra server spins up to meet demand. Add it up and a normal month really is coffee
money. There's a myth that anything alive on the internet must be sitting on racks of
serious infrastructure. This one isn't. It's one modest box on AWS Elastic Beanstalk,
Node 24 on Amazon Linux. That's the whole data center.

I chose small on purpose. This is a hobby project I want to keep alive for years, not a
startup that has to justify a bill. And the discipline of "it has to run cheap" has
made it a better-built thing. But cheap has teeth, and one night it bit me.

## The night it ran out of memory

The catch with a small server is memory. And the night it became my problem was,
fittingly, a release night. Back then a deploy updated the box in place: the new
version of the app starts up while the old version is still running, they overlap for a
moment, and then the old one bows out. That overlap was the trap. This app and its
dependencies are simply too big to run twice on a small instance. Halfway through the
deploy, with both versions alive at once, the box ran out of memory.

When a Linux process asks for memory that isn't there, it doesn't politely wait. It
gets killed. And the process that gets killed is usually the big one, which is to say:
the game.

The stopgap turned out to be almost embarrassingly old-fashioned: a **swap file**. Swap
is disk space the operating system can use as pretend-memory when the real memory runs
out. It's slower, since a disk is standing in for RAM, but "slower" is a wonderful
problem to have compared to "dead." With swap configured, the box could lean on disk
through the squeeze instead of falling over. It's the server equivalent of a shock
absorber. It doesn't make the car faster; it stops the bump from breaking something.

I still find it funny that the answer to a modern problem (two copies of an app elbowing
each other for RAM) was a technique older than I am. But swap was the workaround, not
the fix. The fix was changing how deploys work altogether.

## Deploying without going dark

The real lesson of that night was to stop asking one small box to do something it was
never sized for. So releases changed shape: instead of updating the running server in
place, every deploy now goes to a **brand-new instance**. The fresh box spins up
alongside the old one, gets health-checked at a `/health` endpoint, and traffic swaps
over only once it reports healthy. If the new version is broken, the old one keeps
serving and nobody notices.

That one change solved both problems at once. No box ever has to hold two versions of
the app again, so the memory squeeze is gone by construction. And the site never goes
dark during a release, because the old version keeps serving until the new one has
proven itself. The honest footnote is that matches live in the server's memory, so a
deploy does restart any battle in progress; the page stays up, but the fight starts
fresh.

The other habit that keeps releases boring: **deploys are tag-triggered**. Merging code
to my main branch does _not_ ship anything. A deploy only happens when I push a version
tag, like `v1.2.82`. That sounds like a small distinction, but it means "I integrated
some work" and "I released to the world" are two separate, deliberate actions. I can
merge all day and the live site doesn't twitch until I decide it's time.

## What "good enough" hosting means

The shape I've landed on is: one small box as the baseline, and headroom I only pay for
when something actually happens. On a busy day, another server scales up to meet the
demand and disappears when the crowd does. On a release day, two instances overlap for
a few minutes and then it's back to one. The rest of the time, the whole operation
idles inside the free tier. I'm paying for spikes, not for idleness, and the constraint
of the small baseline keeps the code honest: I can't get sloppy about memory, and I
can't ship features that only work if I throw hardware at them.

So "good enough" here means: it stays up, it recovers from a spike instead of dying to
one, and a bad deploy can't take it down. That's the bar. Not five nines of uptime for a
game where the stakes are a tank drawing on a screen, just a reliable, cheap, boring box
that's still going to be here next year.

A lot of that same constraint shows up elsewhere, like in how the game streams matches
to your browser (I wrote about that in
[Watching a battle, live](/blog/streaming-the-arena)). Cheap infrastructure is part of
the design, not a compromise I apologize for.
