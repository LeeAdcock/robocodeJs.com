// The two starter bots seeded into every new account (UserService.create). They
// are extracted here so the global ladder (GitHub #151) can exclude *untouched*
// starters from matchmaking: an app whose source still exactly equals one of
// these templates has never been edited, so it shouldn't clutter the rankings
// with identical 1500-rated clones. Once a user edits the source it no longer
// matches and becomes eligible.
export interface StarterBot {
  name: string;
  source: string;
}

export const STARTER_BOTS: StarterBot[] = [
  {
    name: 'My First Bot',
    source: `
// Set the bot's name
bot.setName('My First Bot')

// Begin accelerating
bot.setSpeed(2)

// Fire when turret is ready
function fireIfReady() {
  if(bot.turret.isReady()) {
    bot.turret.fire()
  }
}
clock.on(Event.TICK, fireIfReady)

// After firing, turn to the right
function turnRight() {
  bot.turn(10)
}
bot.on(Event.FIRED, turnRight)
              `,
  },
  {
    name: 'Target Practice',
    source: `
// Set the bot's name
bot.setName('Target Practice')
`,
  },
];

// The exact seed sources, for an O(1) "is this an untouched starter?" check.
export const STARTER_SOURCES: ReadonlySet<string> = new Set(
  STARTER_BOTS.map((b) => b.source)
);

export const isUntouchedStarter = (source: string): boolean =>
  STARTER_SOURCES.has(source);
