// The blog's single source of truth: one entry per post, newest first. The
// index page renders (and date-filters) this list, and the post page uses it
// to hide posts whose date hasn't arrived yet — so future-dated posts can be
// merged/deployed ahead of time and "publish themselves" on schedule. The
// markdown bodies live in public/docs/blog/<slug>.md.
//
// Note this is presentation, not secrecy: the markdown ships in the static
// bundle, so a future post is technically fetchable by URL before its date.

export interface BlogPostMeta {
  slug: string;
  title: string;
  /** ISO date (YYYY-MM-DD); the post becomes visible on this local date. */
  date: string;
  summary: string;
}

/** Local-date ISO stamp (YYYY-MM-DD) — string-comparable against post dates. */
export const toISODate = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate()
  ).padStart(2, '0')}`;

export const isPublished = (post: BlogPostMeta, now: Date): boolean =>
  post.date <= toISODate(now);

/** Posts visible as of `now`, newest first. */
export const publishedPosts = (now: Date): BlogPostMeta[] =>
  BLOG_POSTS.filter((p) => isPublished(p, now));

export const findPost = (slug: string): BlogPostMeta | undefined =>
  BLOG_POSTS.find((p) => p.slug === slug);

/** Render an ISO date for display, e.g. "July 12, 2026". */
export const formatDate = (iso: string): string => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
};

export const BLOG_POSTS: BlogPostMeta[] = [
  {
    slug: 'what-the-masters-knew',
    title: 'What the masters knew',
    date: '2028-01-11',
    summary:
      'The classic Robocode community spent two decades doing science to a game. What wave surfing and guess-factor targeting look like translated into this arena.',
  },
  {
    slug: 'who-can-see-your-code',
    title: 'Who can see your bot’s code?',
    date: '2027-11-09',
    summary:
      'Nobody can read your bot’s source but you. On share links, open spectating, and the difference between sharing the fighter and sharing the blueprint.',
  },
  {
    slug: 'crossing-the-wall',
    title: 'How bot.turn() crosses the wall',
    date: '2027-09-14',
    summary:
      'The sandbox is sealed, and yet the tank turns. The bridge that lets a bot’s requests through the wall without letting anything else through.',
  },
  {
    slug: 'running-strangers-code',
    title: 'How do you let strangers run code on your server?',
    date: '2027-07-13',
    summary:
      'Every bot is code written by someone I’ve never met, running on my machine. The story of the sandbox that makes that safe.',
  },
  {
    slug: 'two-simulations-one-game',
    title: 'Two simulations, one game',
    date: '2027-05-11',
    summary:
      'The server decides what really happens; your browser quietly predicts the in-between frames. Why the game runs the physics twice, and how they stay in sync.',
  },
  {
    slug: 'testing-a-game-engine',
    title: 'How do you unit-test a game you can’t see?',
    date: '2027-03-09',
    summary:
      'Testing a real-time battle simulator without ever opening a browser. Mock tanks, real sandboxes, and one match played tick by tick in a test.',
  },
  {
    slug: 'one-brain-five-tanks',
    title: 'One brain, five tanks',
    date: '2027-01-12',
    summary:
      'Your bot isn’t one tank, it’s five, all running the same code. How to make them cooperate instead of tripping over each other.',
  },
  {
    slug: 'radar',
    title: 'Radar',
    date: '2026-11-10',
    summary:
      'A short one. Everything your bot knows about the world comes through the radar, and there’s an art to sweeping it.',
  },
  {
    slug: 'repeatable-randomness',
    title: 'Making randomness repeatable',
    date: '2026-09-08',
    summary:
      'A fair ladder needs matches you can replay exactly. How a single number makes the game’s “randomness” perfectly reproducible.',
  },
  {
    slug: 'what-mcp-taught-me',
    title: 'The user who reads the manual',
    date: '2026-08-11',
    summary:
      'Building an MCP interface for AI assistants turned out to be the strangest API design work I’ve ever done. What a perfectly literal user taught me about naming, observability, and worst cases.',
  },
  {
    slug: 'launching-global-rankings',
    title: 'Every bot now has a number',
    date: '2026-07-12',
    summary:
      'The Global Rankings are live: every eligible bot now carries a persistent Elo rating, earned in matches it never has to enter. How the ladder works, and why your rating rides your current code.',
  },
  {
    slug: 'letting-claude-ship',
    title: 'I let an AI push to production',
    date: '2026-06-09',
    summary:
      'Handing my release process to an AI assistant: tagged deploys, health checks, and the guardrails that let me sleep at night.',
  },
  {
    slug: 'rebalanced-in-a-weekend',
    title: 'I rebalanced the whole game in a weekend',
    date: '2026-05-12',
    summary:
      'Faster reloads, a penalty for wild shots, quicker turrets, and a red flash when a bot gets hit. A playability pass, and the reasoning behind each number.',
  },
  {
    slug: 'building-with-an-ai-copilot',
    title: 'My co-worker is a language model',
    date: '2026-04-14',
    summary:
      'What changed when I started building RobocodeJs with an AI pair-programmer: where it shines, where it doesn’t, and how my habits adapted.',
  },
  {
    slug: 'learn-to-code-series',
    title: 'You don’t need to know how to code',
    date: '2026-03-10',
    summary:
      'Introducing the Learn series: a hands-on course that takes you from never having written a line of code to fielding a thinking bot.',
  },
  {
    slug: 'pair-programming-a-tank',
    title: 'Pair-programming a tank with an AI',
    date: '2026-02-10',
    summary:
      'RobocodeJs now speaks MCP, so an AI assistant can write, run, and watch your bots right alongside you. Here’s how to set it up and what it can do.',
  },
  {
    slug: 'five-dollar-server',
    title: 'Keeping a game online for the price of a coffee',
    date: '2025-11-11',
    summary:
      'RobocodeJs runs on a very small server. A tour of the frugal hosting setup, the night it ran out of memory, and what I learned.',
  },
  {
    slug: 'why-wont-my-bot-shoot',
    title: 'Why won’t my bot shoot?',
    date: '2025-07-08',
    summary:
      'A debugging walkthrough: the five usual reasons a bot sits there doing nothing, and how to read the logs to find out which one is yours.',
  },
  {
    slug: 'streaming-the-arena',
    title: 'Watching a battle, live',
    date: '2025-03-11',
    summary:
      'How the arena in your browser stays in lockstep with the match on the server, using a decades-old, wonderfully boring web technology.',
  },
  {
    slug: 'aim-where-theyll-be',
    title: 'Aim where they’ll be',
    date: '2024-11-12',
    summary:
      'Shooting at where an enemy is means missing a moving target. The gentle bit of math behind leading your shots.',
  },
  {
    slug: 'react-dont-poll',
    title: 'React, don’t poll',
    date: '2024-07-14',
    summary:
      'The difference between a bot that checks everything every tick and one that waits to be told something happened, and why the second one is easier to write.',
  },
  {
    slug: 'starter-bot-tour',
    title: 'A tour of the bots that ship with the game',
    date: '2024-03-12',
    summary:
      'A guided read through the sample bots (Lighthouse, Marksman, Squad, and friends) and the one idea each is designed to teach.',
  },
  {
    slug: 'stationary-bots-die',
    title: 'Stationary bots die',
    date: '2024-01-16',
    summary:
      'The single most important habit for a beginner bot, in five tactics. Sitting still is a choice, and it’s usually the wrong one.',
  },
  {
    slug: 'a-brief-history-of-robot-tanks',
    title: 'A brief history of robot tanks',
    date: '2023-11-14',
    summary:
      'Born at IBM as a way to teach Java, kept alive by its community for two decades. The story of classic Robocode, the RoboWiki, and the players who turned a game into a science.',
  },
  {
    slug: 'why-javascript-not-java',
    title: 'Why JavaScript, not Java?',
    date: '2023-09-12',
    summary:
      'The classic game was Java, and Java is a fine language. So why did I rebuild it in JavaScript? Because of everything that happens before you write any code.',
  },
  {
    slug: 'tank-turret-radar',
    title: 'The tank, the turret, and the radar',
    date: '2023-07-11',
    summary:
      'Your bot is three machines bolted together, each of which turns on its own. Understanding that is most of understanding the game.',
  },
  {
    slug: 'it-moved-moment',
    title: 'Chasing the “it moved!” moment',
    date: '2023-05-09',
    summary:
      'The whole game is designed around one feeling: the first time your code makes something happen. Everything else is in service of getting you there faster.',
  },
  {
    slug: 'walls-and-retreat',
    title: 'Hug no walls, pick your fights',
    date: '2023-03-14',
    summary:
      'Two intermediate habits that quietly win matches: staying off the walls, and knowing when a fight isn’t worth your health.',
  },
  {
    slug: 'a-game-that-taught-me',
    title: 'A game that taught me to think',
    date: '2022-12-12',
    summary:
      'Where RobocodeJs comes from: a childhood spent with the original Robocode, and why I wanted to hand that same spark to someone who has never coded.',
  },
];
