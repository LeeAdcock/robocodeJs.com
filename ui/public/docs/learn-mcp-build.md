# Lesson 17: Build an app with AI

**By the end of this lesson you'll be able to:**

- Have an AI assistant create a new app, check it, and put it in your arena
- Improve the app together, one change at a time, and know which version is running

**New idea:** _Check, then ship: test a change before it goes live._

## The idea

Programmers who've been at it a while follow a rhythm: **write** a change, **check** it, **ship** it, then **watch** what it does. You've been doing a hand-made version of this all course: type, press **Deploy**, look at the arena. With an assistant connected (from [Lesson 16](/learn/mcp-setup)), each step has a tool:

- **Write**: the AI reads the real API first, so it doesn't make up methods. It can read the [reference docs](/learn/docs), the exact type definitions (`robocode.d.ts`), and the [example bots](/examples).
- **Check**: `check_app_source` runs the code in a throwaway sandbox and reports any error, **without** touching your arena. `format_app_source` tidies its layout.
- **Ship**: `create_app` makes a brand-new app; `set_app_source` replaces the code of one you already have.
- **Watch**: `arena_status`, `match_status`, and the watch link show what it does.

That **check** step is the big one. In the editor, a mistake only shows up after you Deploy and your bots stop. Checking first means a broken idea never reaches the arena at all.

## Try it

**1. Ask for an app.** In a new chat with your assistant, describe what you want in plain words:

```
Make me a new RobocodeJs app called Scout. It should drive in a wide circle,
sweep its radar, and fire at any enemy it sees. Read the docs and an example
bot first, check the code before saving it, and explain it to me line by line.
```

Watch the steps it takes. A good run looks like: read the docs, write the code, `check_app_source` (and fix anything it reports), `format_app_source`, then `create_app`. The answer includes an **appId**, the app's id, which the AI will use from now on to talk about Scout.

> **Shortcut:** many assistants let you pick a ready-made **prompt** from RobocodeJs called `write_app`. You give it a goal ("circle and snipe") and it follows the same recipe: read, write, format, create.

**2. Put it in the arena.** An app made through the editor joins your arena automatically. An app made through MCP doesn't, so ask:

```
Add Scout to my default arena and give me the watch link.
```

That's `add_app_to_arena`. Open the link. Five Scouts are now on the field.

**3. Read it yourself.** Open **Apps** in the menu bar: Scout is there, with the code the AI wrote. You're still the programmer here. If a line puzzles you, ask the AI what it does, or look it up in the [reference docs](/learn/docs). Code you don't understand is code you can't fix.

**4. Change it.** Now improve it, one idea at a time:

```
Scout keeps driving into walls. Make it turn away when it collides, check the
change, then save it.
```

This time the AI uses `set_app_source`. Your running Scouts pick up the new code right away, just like pressing **Deploy**. Some changes only matter at the very start, like a new speed set inside `Event.START`. For those, ask the AI to **reboot** the app (`reboot_app`), which is the same as the editor's **Reboot**: it reloads the code and runs START again.

## Which version is running?

Every time the AI saves code, the answer includes a **version**, a short code like `3fa9c2e1b7d40c58` that's a fingerprint of the exact text it saved. Change one letter of the code and the version changes. Save the same code twice and it stays the same.

The same version shows up in `list_apps`, `arena_status`, and the match reports. So if you ever wonder "is the arena running the fix, or the old code?", ask the AI to compare the versions. When they match, you're watching exactly the code it saved.

## Experiment

- Remember the mistake from [Lesson 1](/learn/hello), `bot.setName(Rusty);` without quotes? Ask the AI to run `check_app_source` on that line. It reports error [**E027**](/error-codes#e027) (an undeclared variable) with a line number, and nothing in your arena breaks. Look up any code you see on the [error codes](/error-codes) page.
- Ask the AI to **change only one thing** at a time (just the speed, say), and watch the effect after each change. Small steps make it obvious which change helped and which one hurt.
- Ask it to add a `console.log` that prints when Scout spots an enemy. Then ask it for the **recent logs** (`recent_logs`). That's the same console you see under the editor, read by the AI.

## Common questions

**The AI used a method that doesn't exist.** Ask it to read the type definitions (`robocode.d.ts`) and run `check_app_source` again. Telling it to "read the docs first" at the start of the chat prevents most of this.

**I edited Scout in the editor and the AI's change vanished (or the other way round).** The last save wins. If the editor was open while the AI saved, it's still showing the older copy, and typing there saves that older copy over the new one. Reload the editor page before you edit, or let one of you drive at a time.

**`check_app_source` said it was fine, but my bots still crashed.** The check catches mistakes in how the code is _written_ (a typo, a missing bracket, an undeclared name). It can't catch mistakes in what the code _does_ once a match is running, like turning the turret the wrong way. Finding those is the job of the next lesson.

**Can I ask for a really strong bot in one go?** You can ask, but you'll learn more, and usually end up with a better bot, by growing it in small checked steps the way you did in this course.

## You learned

- **Check, then ship**: `check_app_source` finds mistakes before they reach the arena.
- `create_app` makes a new app; add it to an arena with `add_app_to_arena`.
- `set_app_source` is the AI's **Deploy**; `reboot_app` is its **Reboot**.
- Every save has a **version** fingerprint, so you can confirm the arena runs exactly the code you saved.

---

[← Connect an AI assistant](/learn/mcp-setup) · [Index](/learn) · Next: [Test your app with AI →](/learn/mcp-test)
