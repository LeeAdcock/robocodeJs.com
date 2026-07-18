# Watching a battle, live

_March 11, 2025_

<img
  src="/docs/lee_headshot.jpg"
  alt="Lee, the creator of RobocodeJs"
  width="170"
  style="border-radius: 50%; object-fit: cover; float: right; margin: 0.25rem 0 1rem 1.5rem; max-width: 40%;"
/>

When you open a RobocodeJs arena, bots are already moving, bullets are already flying, and your browser somehow knows about all of it in real time. A reasonable question is: _how?_ Your browser didn't ask for each frame. It's not refreshing the page ten times a second. So how does the news of a live battle get from my server to your screen?

The answer is a lovely, underused piece of the web called **Server-Sent Events**, and I want to make the case for it, because it's one of those choices where the boring option turned out to be the right one.

## A broadcast, not a conversation

Normally the web works like a conversation of questions. Your browser asks ("give me this page"), the server answers, and then it's over. If you want new information, you ask again. That's fine for a page. It's terrible for a live battle, where the state changes ten times a second and you'd be asking constantly.

Server-Sent Events flips it. Your browser opens _one_ connection and just... leaves it open. Then the server sends little text messages down that pipe whenever it has something to say (a bot moved, a shot was fired, someone got hit), and the browser receives each one as it arrives. The server talks, the browser listens. Under the hood it's just an ordinary web (HTTP) response that never quite finishes, dribbling out lines of text forever. That simplicity is the whole appeal.

RobocodeJs runs two of these streams side by side. One carries the game events: the movements and hits and deaths that the arena draws. The other carries the bots' console logs, so when your bot prints something, you see it in the log panel in real time. Same mechanism, two channels: one for the picture, one for the words.

## The neat part: joining a battle already in progress

The detail I'm most proud of is this one. A live match is stateful: five bots per app, each somewhere in the arena, each with some health, mid-fight. If you wander in as a spectator halfway through, how do you catch up? You missed the first half of the story.

The way I handle it: the arena is an **event emitter**, a little broadcaster that everything watching subscribes to. When a new spectator connects and subscribes, the first thing they receive is a **replay of the current state** (every app in the match, every bot and where it is right now) before the live stream continues. So a latecomer gets bootstrapped instantly. One moment you have an empty arena, the next it's fully populated with the battle as it stands, and from there you're just riding the same live stream as everyone else who was already watching.

It means you can reload the page, or close the arena and reopen it while a match is running, and you're instantly back in sync with the battle as it stands, without any awkward "waiting for the next update" gap.

## Why not WebSockets?

The usual reflex for "real-time in the browser" is WebSockets, a full two-way channel where both sides can talk. And WebSockets are great, when you need both sides talking. But look at what's actually happening here: the server has everything to say and the browser has nothing to send back over this channel. The commands, the bot code, the button clicks all go through ordinary requests. The live arena is a one-way firehose from server to browser, and that's precisely the shape SSE fits.

So SSE buys me a simpler system for exactly my problem. It's plain HTTP, which means it plays nicely with everything already in front of my server: no special protocol upgrade, no extra library on the server to manage socket lifecycles, and it reconnects on its own if the connection drops. For a solo project on a small, cheap box, "one less moving part" is worth a great deal. I reached for the fancier tool first, like everyone does, and then realized I was carrying a two-way radio to a one-way broadcast.

The broadcast, by the way, is only half the illusion. Ten updates a second would look choppy on their own; the smoothness you see between them is your browser predicting the motion itself. But that's a story for another post.
