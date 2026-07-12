# Chasing the "it moved!" moment

_May 9, 2023_

<img
  src="/docs/lee_headshot.jpg"
  alt="Lee, the creator of RobocodeJs"
  width="170"
  style="border-radius: 50%; object-fit: cover; float: right; margin: 0.25rem 0 1rem 1.5rem; max-width: 40%;"
/>

If you asked me what RobocodeJs is optimized for, I wouldn't say "learning to code" or
"strategy" or "fun," even though I want all three. I'd say it's optimized for a single
feeling, one that lasts about half a second: the first time your code makes something
happen in the world. The "it moved!" moment. Everything else in the project is scaffolding
around getting you there fast, and I think it's worth explaining why I care about that one
instant so much.

## The half-second that hooks people

There's a specific spark that happens the first time you write instructions and then watch
them come true. You typed a few lines, you hit run, and a thing on the screen did what you
said. It's a small miracle and it never fully wears off, but the first hit is the
strongest. That moment is where "computers are intimidating" quietly flips to "wait, I can
do this."

Mine happened in high school, in Visual Basic of all places. I'd built a version of Risk,
not for the game itself, really, but so I could write AI players for it. I still remember
the first time I hit run and watched my little artificial opponents start taking territory
on their own, following logic I'd written, making choices while I just sat there watching.
Nobody was pressing the keys. The thing I'd imagined was happening in front of me. I've
been chasing variations of that half-second ever since. It's the same feeling that later
hooked me on [the original Robocode](/blog/a-game-that-taught-me), and the reason this
whole project exists.

## Every decision serves the moment

So I treat "time to first movement" as the number that matters, and almost every design
choice falls out of trying to shrink it.

No install, because a download and a toolchain is an afternoon of distance, and the spark
doesn't survive an afternoon. The whole reason this is JavaScript in a browser instead of
Java on your machine is to delete that gap.

The editor is right there in the page, next to the arena, because the second you have an
idea you should be able to type it and see it, with no context-switch between where you
write and where you watch.

The arena is already running when you arrive. No project to configure, no match to set up,
no "new game" ceremony. Your bot drops into a live fight.

And the [Learn course](/learn) is built backwards from the moment. The very first lesson,
[Hello](/learn/hello), isn't a tour of syntax or a lecture on variables. It's the shortest
honest path to a tank that moves. I fought the urge to explain things first. Explanation
can wait; the spark can't.

None of these are big clever features. They're mostly removals, things I chose not to put
between you and the arena. Good onboarding, I've come to believe, is mostly subtraction.

## Watching it happen to someone else

The reason I trust this instinct is that I've gotten to watch it land on real people.
There's a particular body-language shift when it works. Someone leans back, or laughs, or
immediately leans in and starts typing the next thing without being asked. You can see the
question change in real time from "am I allowed to do this" to "okay, what if I make it do
_that_."

The time it hit me hardest wasn't in this game at all. My daughter Claire and her friend,
nine years old, spent a school year coding robots through story missions in the Wonder
League. After school, on weekends, iterating and failing and trying again. Their two-girl
team ended up
[winning first place in their age group of an international competition](https://www.wtvr.com/2018/05/23/this-all-girls-team-from-chesterfield-just-won-an-international-robotics-competition)
with twenty-two thousand kids in it. Nobody lectured them into that. They got hooked the
same way I did: they told a machine to do something, it did it, and after that no one
could tell them coding wasn't for them. I've been designing for that exact moment ever
since, the one where the machine does what a kid told it to and something in her decides
she's a person who can do this.

That second reaction, the unprompted "what if," is the whole game to me. Once someone
starts asking "what if," they've stopped being taught and started playing, and the playing
teaches them everything else. My only job is to get them to that first "what if" before
anything has a chance to stop them.

So that's the north star. Not a feature list, not a curriculum. A feeling, arriving fast.
If you've never felt it, or you want to feel it again, the door is right here:
[go make something move](/learn/hello). It's a couple of minutes away, which is exactly
how far away I want it to be.
