# The tidy button

_July 13, 2027_

<img
  src="/docs/lee_headshot.jpg"
  alt="Lee, the creator of RobocodeJs"
  width="170"
  style="border-radius: 50%; object-fit: cover; float: right; margin: 0.25rem 0 1rem 1.5rem; max-width: 40%;"
/>

There's a button in the bot editor that gets no glory. It doesn't fire anything or move
anything. It's the Reformat button (Ctrl-R if you're in a hurry), and it takes whatever
state your code is in, however mangled the indentation, however chaotic the spacing,
and lays it back out clean. I want to give it a proper introduction, because it carries
sixty years of history and one of my favorite ideas in software.

## What it does here

Press it and your bot's source is rewritten in place: same code, same behavior, tidy
shape. Under the hood it's **Prettier**, the standard formatter of the JavaScript
world, running entirely in your browser. There's a pleasing recursion in that: the same
tool that formats this site's own source code, automatically, every time I commit, is
bundled into the editor to format yours.

Two details I sweated. First, it fails soft: if your code is too broken to parse, the
button quietly leaves it alone rather than mangling it further. A formatter should
never make things worse. Second, humans aren't its only users; the
[AI tools](/blog/pair-programming-a-tank) get a `format_app_source` tool of their own,
and the assistants are encouraged to tidy before every save. Everyone's bots end up
readable, whoever or whatever wrote them.

Why bother, in a game? Because beginner code gets messy _fast_, and messy code is hard
to debug in exactly the way beginners can least afford. When your brackets are aligned,
a missing one is visible. When every block is indented the same way, "this line is
inside the wrong `if`" jumps off the screen. The tidy button is a
[debugging tool](/blog/why-wont-my-bot-shoot) wearing a janitor's uniform. And for
someone [just learning](/learn), it's a quiet teacher: format often enough and you
absorb what well-shaped code looks like without anyone lecturing you.

## Sixty years of tidying

Making machines clean up code is a genuinely old dream. The idea has a name from the
mainframe era, [pretty-printing](https://en.wikipedia.org/wiki/Pretty-printing), and
one of its earliest landmarks is a program called GRINDEF, written by Bill Gosper
around 1967, which formatted Lisp using combinatorial search. Read that again: in an
era of punch cards and room-sized computers, people were already spending precious
machine time making code easier for humans to look at. That's how much layout matters.

What the following decades added, besides better algorithms, was mostly _arguing_.
Programmers fought style wars over brace placement, with whole factions named after
their conventions, and the tabs-versus-spaces feud ran so long it became a sitcom
punchline. The arguments were endless because the stakes were tiny and personal: code
layout felt like handwriting, and no one wants their handwriting corrected.

## The peace treaty

Then came the insight that ended the war, and it's the reason the tidy button behaves
the way it does. In December 2016, James Long and Pieter Vanderwerff spent a winter
break building what became
[Prettier](https://blog.vjeux.com/2025/javascript/birth-of-prettier.html), with
Christopher Chedeau championing it to the world. It was built on a beautifully small
formal foundation, an algorithm from a paper called, fittingly, "A Prettier Printer,"
and its testing north star was elegant too: formatting a file twice must give exactly
the same answer as formatting it once.

But the real breakthrough wasn't technical. Prettier's insight was that the way to end
a style argument is to remove the decision. It's deliberately, almost rudely,
unconfigurable. You don't debate where the brace goes; the tool decides, everyone's
code comes out the same, and the argument evaporates, not because anyone won but
because there's nothing left to argue about. Within a few years the overwhelming
majority of JavaScript developers had adopted it, and the idea spread to other
languages' formatters. The holy war didn't end in victory. It ended in irrelevance.

I find that genuinely beautiful, and it's the same philosophy this game leans on
everywhere: [remove the decision, keep the momentum](/blog/it-moved-moment). You don't
configure the formatter here, just as you don't set up a toolchain or pick a
project structure. You write your bot, you mash Ctrl-R, and the machine sweats the
layout so you can spend your opinions on something that actually wins matches.

Sixty years from GRINDEF to a button in a tank game. The dream was always the same:
let humans think about what the code _does_, and let the computer worry about how it
looks.
