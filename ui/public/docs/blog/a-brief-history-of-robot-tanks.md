# A brief history of robot tanks

_November 14, 2023_

<img
  src="/docs/lee_headshot.jpg"
  alt="Lee, the creator of RobocodeJs"
  width="170"
  style="border-radius: 50%; object-fit: cover; float: right; margin: 0.25rem 0 1rem 1.5rem; max-width: 40%;"
/>

Every game on this site owes its existence to a Java program born at IBM around the
turn of the millennium, and I think the story deserves telling properly, because it's
one of the best stories in programming culture: a teaching toy that escaped the lab,
got adopted by strangers, and was kept alive by them for more than twenty years.

## Born as a lesson, escaped as a game

**Robocode** appeared in 2000, created by Mathew Nelson at IBM, and its official
purpose was almost comically modest: a fun way to learn Java. You wrote a robot tank's
brain, extended a class, filled in some event handlers, and set it loose in an arena
against other people's brains. The learning-Java part worked. But something else worked
far better than anyone planned: it turned out that "my code fights your code" is one of
the most compelling competitive formats ever accidentally invented.

You didn't play Robocode so much as coach it. Your tank went into the arena alone,
carrying only what you'd thought to teach it, and you sat there watching your ideas be
right or wrong at machine speed. [That feeling is the entire reason I'm building this
site](/blog/a-game-that-taught-me), and in the early 2000s it hooked thousands of us:
students, professionals sneaking matches between meetings, kids like me who had just
met Java in a classroom and suddenly had a reason to care about it.

## The second life

The pivotal moment came in 2005, when Robocode was open-sourced. Corporate projects
that stop being strategic usually just stop. This one got adopted. A devoted community
picked it up, and for many years its steward was Flemming N. Larsen, who carried the
game forward release after release while the rest of the software world churned. It's
worth pausing on how unusual that is: a game with no company behind it, no revenue, no
marketing, maintained across decades because people simply refused to let it die.

And the community didn't just maintain it. They turned it into a field of study. The
[RoboWiki](https://robowiki.net) grew into a deep well of strategy where players
documented, named, and debated techniques with the seriousness of an academic journal;
ideas like wave surfing and guess-factor targeting were reverse-engineered from
watching bots fight and then written up for the next generation. And the RoboRumble ran
as a never-ending tournament between hundreds of community entries, a permanent
proving ground where every theory eventually met every other theory. A game about
pretend tanks quietly produced one of the internet's best examples of open,
collaborative research.

## Still going

Here's the part that delights me most: it's all still alive. The original Robocode
still runs, the RoboWiki still answers questions, and the game's creator eventually
returned to build a modern successor,
[Robocode Tank Royale](https://github.com/robocode-dev/tank-royale), which lets you
write bots in almost any language. Twenty-plus years for a piece of software is
geologic time. Twenty-plus years for a *community* is rarer still.

RobocodeJs is my small branch on that family tree. I rebuilt the idea
[for the browser and JavaScript](/blog/why-javascript-not-java) because I wanted the
spark to reach people the original couldn't: the kid with a school Chromebook, the
curious adult who will never install a Java toolchain. But I want to be clear about
lineage. The event-driven robots, the compass, the radar-and-turret anatomy, the whole
grammar of the game: that's Robocode's design, honored as faithfully as a browser
allows. If you're arriving here from the classic, [this page](/classic) maps everything
you already know onto this arena.

And if you've never played the original: go. It's still there, still wonderful, and it
can do things a browser sandbox can't. Somewhere in its arena, bots written by people
who have long since forgotten them are still fighting, which might be the most
Robocode fact of all. The tanks outlive the coaches. I find that oddly hopeful, and
it's the standard this site aspires to: build a thing worth keeping alive, and hand
people enough joy that they do.
