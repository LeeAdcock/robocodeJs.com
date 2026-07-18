# Privacy Policy

Last updated: July 18, 2026

RobocodeJs ([https://robocodejs.com](https://robocodejs.com)) is a browser-based programming game where you write JavaScript bots that battle in an arena. This policy describes what data the service actually collects, what it's used for, and what control you have over it. We've kept it short and specific on purpose — there is no fine print.

The short version: we collect the minimum needed to run the game — your Google sign-in profile, the bots and arenas you create, and standard server logs. We run no analytics or advertising, use exactly one cookie, and never sell your data or share it for marketing.

## What we collect

**Your Google profile.** Sign in with Google is the only sign-in method. When you sign in, Google shares your name, email address, and profile picture with us, and we store them with your account, along with when the account was created and when it was last active. We require a verified email address to create an account. We never see your Google password.

**What you create.** Your bot programs (source code and names), your arenas, your match results and ratings, and any achievements you unlock are stored with your account.

**Server logs.** Like almost every web service, our servers log requests — including IP addresses — for rate limiting, abuse prevention, and debugging. Logs are operational data: we keep them for a short period and don't use them to profile you.

That's the complete list. We don't collect payment information (there's nothing to buy), location data, or contacts, and we don't buy data about you from anyone else.

## Cookies and tracking

We use **one cookie**: a session cookie named `auth` that holds your Google sign-in credential so you stay signed in. It is inaccessible to scripts (HttpOnly), the sign-in it carries expires on its own within about an hour, and it is deleted when you log out. That's the only cookie — there is no consent banner because there's nothing to consent to beyond signing in.

We run **no analytics, no advertising, no tracking pixels, and no third-party trackers** of any kind.

Your browser's local storage holds a few preferences — color theme, editor font size, debug view — purely for your convenience. They never leave your browser.

## What's public

RobocodeJs is a competitive game, so some things are visible to others by design:

- **The rankings page.** If your bots compete on the global ladder, your display name (the name on your Google account), your bot's name, and its rating appear on the public leaderboard, visible to anyone.
- **Spectating.** If you share your arena's watch link, anyone with the link can watch your matches live — bot names, positions, and battle events.
- **Sharing a bot.** If you share a bot's add-link, other players can field your bot in their own arenas.

Your bot's **source code is always private to you**. Spectators and players who add your bot see only its behavior in the arena — never the code. Your email address is never shown publicly.

Your display name comes from your Google account, which for many people is their real name. If you'd rather compete under a different name, change the display name on your Google account.

## Background matches

To keep the global ladder fresh, our servers periodically run automated ranked matches between eligible bots, including yours, even while you're offline. These matches use your bot's current code, run entirely on our servers, and record only the outcome (ratings and win counts).

## Connecting AI tools

You can optionally connect AI assistants to your account through a standard connector sign-in flow (OAuth). A connected assistant can read and edit your bots and control your arenas **on your behalf** — access you grant explicitly when you connect. To disconnect, remove the connector in your AI client; the credentials behind the connection are short-lived and expire on their own. We store those credentials only as cryptographic hashes — we can't read them back, and neither could anyone who obtained our database.

What you share _with_ an AI assistant (for example, bot code you paste into a chat) is handled under that provider's privacy policy, not ours.

## Who else touches your data

We use two infrastructure providers, and no others:

- **Google** provides sign-in. Google's handling of your Google account is governed by [Google's privacy policy](https://policies.google.com/privacy).
- **Amazon Web Services** hosts our servers and database in the United States (Northern Virginia). Your data is processed and stored in the United States.

We never sell your data, and we don't share it with advertisers, data brokers, or "business partners." We would disclose data only if required by law, or as needed to protect the service and its users from abuse.

## Retention and deletion

We keep your data for as long as your account exists. Deleting a bot in the app removes it from your account immediately, though residual copies may persist in our database and backups for a time.

To delete your account and its data entirely, email us at [info@robocodejs.com](mailto:info@robocodejs.com) from the address on your account and we'll take care of it. We may retain minimal records where we have a legal obligation to do so.

## Children and classrooms

RobocodeJs is not directed at children under 13, and we don't knowingly collect personal information from them. Because sign-in requires a Google account, Google's own age rules apply.

We know RobocodeJs is used in classrooms, and it's built to be classroom-friendly: no ads, no tracking, and minimal data collection. If you're a teacher using RobocodeJs with students, have them sign in with school-managed Google accounts, and note that the school or teacher is responsible for obtaining any parental consent required in your jurisdiction. If you believe a child has created an account we shouldn't have, contact us and we'll remove it.

## Changes to this policy

If we change this policy, we'll post the new version here and update the date at the top. Meaningful changes will be called out on the site.

## Contact

Questions, concerns, or deletion requests: [info@robocodejs.com](mailto:info@robocodejs.com)
