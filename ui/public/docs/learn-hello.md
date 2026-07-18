# Lesson 1: Hello, bot!

**By the end of this lesson you'll be able to:**

- Create your very own robot
- Give it a name with a line of code

**New idea:** _A program is a list of instructions._

## What is code?

A **robot** in this game doesn't think on its own: it does exactly what you tell it. The way you tell it is by writing **code**: a list of instructions, one after another, that the robot follows from top to bottom. That list of instructions is called a **program**.

Think of it like a recipe. A recipe is a list of steps in order, and if you follow them you get a cake. Code is a recipe for your robot.

## Make your first bot

1. Look at the menu bar at the top. Click **Apps**, then **Create new application**.
2. A code editor opens. This is where your robot's recipe lives.
3. You'll see some starter code. Select it all and delete it so we can start fresh.

## Try it

Type (or paste) this single line into the editor:

```
bot.setName('Rusty');
```

Now press the **Deploy** button, or `Ctrl-S`. Look at the arena on the right. Your robot is now named **Rusty**!

Let's read that line like a sentence:

- `bot` is **your robot**. You'll talk to it a lot.
- `.setName(...)` is an **instruction**: "set your name."
- `'Rusty'` is the name itself. The quotes `' '` mean it's **text** (programmers call text a _string_). You can put any name between the quotes.

The semicolon `;` at the end marks the end of the instruction, like a period ends a sentence.

## Experiment

- Change `'Rusty'` to your own robot's name and press Deploy again. Watch the name update.
- What happens if you remove the quotes and just write `bot.setName(Rusty);`? Deploy and peek at the **log panel**. You'll likely see an error. Quotes matter! Put them back.

## Common questions

**Nothing changed when I deployed.** Look at the indicator next to your bot's name. If it says **Unsaved changes**, your code hasn't reached the arena yet. Press **Deploy**. If it says **Saved and Deployed**, your bots are running this code, so check that your bot was added to the arena. New bots are added automatically when you create them.

**What's the difference between Deploy and Reboot?** **Deploy** loads your new code while your robot keeps doing what it was doing. **Reboot** reloads your code _and_ restarts your robot from the beginning. For now, Deploy is all you need.

**Do I have to call it `bot`?** Yes, `bot` is the name the game gives your robot. It's always there for you to use.

## You learned

- A **program** is a list of instructions the robot follows in order.
- `bot.setName('...')` sets your robot's name. Text goes in quotes (a _string_).

---

[Course index](/learn) · Next: [Do something every moment →](/learn/events)
