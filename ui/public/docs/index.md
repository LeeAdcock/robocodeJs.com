# RobocodeJs

**Welcome to the arena! RobocodeJs is a browser-based programming game that teaches [event-driven programming](https://en.wikipedia.org/wiki/Event-driven_programming) with JavaScript. Brainstorm your own winning strategy, program your bot's artificial intelligence, and set it loose in the arena in teams to defeat your competition. Onwards to fame and glory!**

The battle arena is a square space filled with groups of bots working together as a team. Each app you program is the artificial intelligence for each member of a team. Your goal is to find and destroy your enemies before they eliminate you from the game. You'll have the use of your bot's radar and a turret mounted cannon.

As you work to develop your application code, the bots in the arena will immediately adapt to the changes you make. Quickly reset the match and start a new game, or add or remove bots as you try out different iterations on your strategy.

# Getting started

Pick the path that fits you:

- **New to coding?** Start the **[Learn to Code course](/learn)** — a guided, 14-lesson
  path that takes you from "what is code?" to a fully featured battle bot, no experience
  needed.
- **Coming from classic Robocode?** Read **[Coming from classic Robocode](/classic)** for
  a quick map of what's the same, what's different, and how to port your instincts.
- **Want the details?** Keep the **[API reference](/dev)** and **[game rules &
  physics](/rules)** handy, and browse the **[example bots](/examples)**.

To create your first bot, sign in with your Google account and use the menu to select
**Apps → Create new application**; your bots are added to the arena and you're ready to
code. The quick walkthrough below builds a simple bot in a few minutes — or jump straight
into the [course](/learn).

## Naming your Bot

In our applications, the bots are represented by the `bot` object which has a collection of methods and properties you can use to control your bot. For our first bot, we'll use the `setName(...)` method to provide our bot its new name. This method takes a text string as its only parameter, pick a name that will spark fear among the other bots in the arena!

```
bot.setName('My first bot')
```

Clicking the "Save" button in the editor will send your new application to all of your bots, and they will immediately execute it and start using their new logic.

## Firing the Turret

Next, let's write a JavaScript function that will fire the bot's turret, if it's loaded. The turret takes time to reload, so you'll usually want to check its status before you try to use it. All of the turret controls are on the `bot.turret` object.

```
function fireIfReady() {
  if(bot.turret.isReady()) {
    bot.turret.fire()
  }
}
```

To call this function and run your new turret behavior, let's attach it to an event. In this case we want to keep checking if the turret is ready to fire, so let's attach this behavior to the `clock`'s `Event.TICK` event. The clock tick is the smallest increment of time in the arena, and ensures we'll execute this code as soon as the turret is ready. We pass the `clock.on` method the type of event and the function we created to execute when this event happens. You can only have one event handler defined for each event type, so if you call this again it will overwrite any other event handler you've already set.

```
clock.on(Event.TICK, fireIfReady)
```

## Movement

Right now our bot just sits in place. Let's get it moving and have it turn each time it fires. Driving is controlled with `bot.setSpeed(...)`, while `bot.turn(...)` rotates the bot by a relative number of degrees. Angles in the arena are measured in degrees on a compass, with 0° pointing straight up (north) and angles increasing clockwise.

Let's start the bot driving when the match begins by handling the `Event.START` event — a good place to set up your bot's initial behavior, since it runs whenever your code is loaded:

```
bot.on(Event.START, () => {
  bot.setSpeed(2)
})
```

And let's turn a little each time the turret fires, by attaching a function to the `Event.FIRED` event on our bot:

```
function turnRight() {
  bot.turn(10)
}

bot.on(Event.FIRED, turnRight)
```

There are several other ways to define and pass functions in JavaScript, and you'll see those other ways in some of our examples. The result is the same, but different approaches may be better in different situations for helping increase your code's readability.

# Next steps!

You've created your first bot! This simple logic is probably not likely to dominate the arena, but it's a great first step as you begin to learn RobocodeJs.

Next you may want to skim through the detailed [RobocodeJs documentation](/dev), study a few [more examples](/examples), or [deepen your knowledge](https://learnjavascript.online/) on the JavaScript programming language.

---

_RobocodeJs is a passion project by **Lee Adcock** — a love letter to the classic Robocode. [Read the story](/about), or say hi at [Lee@RobocodeJs.com](mailto:Lee@RobocodeJs.com)._
