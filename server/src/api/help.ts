import express, { Request, Response } from 'express';
import Classifier from 'ml-classify-text';
import auth, { AuthenticatedRequest } from '../middleware/auth';
import cookieParser from 'cookie-parser';

// The navbar search box (`/api/ask`) maps a free-text query to the most relevant
// docs page. Matching happens in three tiers, most specific first:
//   1. An explicit error code (E017) -> deep-link to that entry.
//   2. A KEYWORD MAP (below) -> a robust, transparent list of the words/phrases a
//      player is likely to type per topic. This tier is deterministic: a search
//      for "error", "shoot", "radar", "timer", etc. always lands somewhere useful,
//      which the bag-of-words classifier alone did not guarantee (single words and
//      shared words like "bot" fell through to /help or the wrong section).
//   3. A bag-of-words CLASSIFIER as a fuzzy fallback for natural-language
//      phrasings that don't contain a known keyword.

const logsAnswer = (req: Request): string => {
  const user = (req as unknown as AuthenticatedRequest).user;
  return user
    ? `/user/${user.getId()}/arena/logs`
    : '/learn/docs#consolelogging';
};

// Ordered by priority: the first category whose keywords appear (as whole words)
// in the query wins. Keep vocabularies distinctive so overlaps are rare; where a
// query could match two, the earlier entry is the better default.
const KEYWORD_ROUTES: {
  keywords: string[];
  answer?: string;
  resolve?: (req: Request) => string;
}[] = [
  {
    // Debugging / faults -> the error-code reference (specific E0xx codes are
    // handled by the regex above this map).
    answer: '/error-codes',
    keywords: [
      'error',
      'errors',
      'crash',
      'crashed',
      'crashing',
      'exception',
      'fault',
      'faulted',
      'debug',
      'debugging',
      'broken',
      'not working',
      "isn't working",
      'stopped working',
      'died',
      'why did my bot die',
    ],
  },
  {
    // Connecting an AI assistant over MCP -> the MCP setup guide. Distinctive
    // vocabulary (deliberately NOT bare "ai", which a player uses for their bot's
    // own AI logic).
    answer: '/mcp',
    keywords: [
      'mcp',
      'model context protocol',
      'claude',
      'claude desktop',
      'connector',
      'connect claude',
      'ai assistant',
      'api token',
      'bearer token',
    ],
  },
  {
    // Aiming ahead of a mover -> the Leading lesson (no dedicated /learn/docs anchor).
    // Placed before the turret so "aim ahead" / "moving target" wins over "aim".
    answer: '/learn/leading',
    keywords: [
      'leading',
      'lead the target',
      'lead a target',
      'lead my shot',
      'aim ahead',
      'moving target',
      'intercept',
      'hit a mover',
      'predict where',
    ],
  },
  {
    // Staying alive -> the Survival lesson.
    answer: '/learn/survival',
    keywords: [
      'survive',
      'survival',
      'flee',
      'retreat',
      'run away',
      'running away',
      'low health',
      'avoid getting hit',
      'stay alive',
    ],
  },
  {
    // Team play & messaging -> the Teamwork lesson (send/receive has no clean
    // /learn/docs anchor; the lesson is the better resource).
    answer: '/learn/teamwork',
    keywords: [
      'teamwork',
      'team',
      'teammate',
      'teammates',
      'communicate',
      'communication',
      'send a message',
      'send message',
      'receive a message',
      'message my team',
      'talk to teammates',
      'broadcast',
    ],
  },
  {
    // Console output -> the live log panel (or the docs when signed out).
    resolve: logsAnswer,
    keywords: [
      'log',
      'logs',
      'logging',
      'console',
      'console.log',
      'print',
      'output',
      'stdout',
    ],
  },
  {
    answer: '/learn/docs#turret',
    keywords: [
      'fire',
      'fired',
      'firing',
      'shoot',
      'shooting',
      'shot',
      'gun',
      'cannon',
      'weapon',
      'turret',
      'aim',
      'aiming',
      'bullet',
      'reload',
      'ammo',
    ],
  },
  {
    answer: '/learn/docs#radar',
    keywords: [
      'radar',
      'scan',
      'scans',
      'scanning',
      'scanned',
      'detect',
      'detecting',
      'sensor',
    ],
  },
  {
    answer: '/learn/docs#clock',
    keywords: [
      'timer',
      'timers',
      'tick',
      'ticks',
      'interval',
      'timeout',
      'setinterval',
      'settimeout',
      'clock',
      'schedule',
      'delay',
    ],
  },
  {
    answer: '/learn/docs#events-overview',
    keywords: [
      'event',
      'events',
      'handler',
      'handlers',
      'listener',
      'listen',
      'on hit',
      'on start',
      'on collided',
      'on scanned',
      'on detected',
    ],
  },
  {
    answer: '/learn/docs#bot',
    keywords: [
      'move',
      'moving',
      'movement',
      'drive',
      'driving',
      'speed',
      'accelerate',
      'navigate',
      'navigation',
      'steer',
      'turn',
      'turning',
      'reverse',
      'forward',
      'backward',
      'dodge',
    ],
  },
  {
    answer: '/learn/docs#arena',
    keywords: [
      'arena',
      'marker',
      'distance',
      'angle',
      'bearing',
      'orientation',
      'coordinate',
      'coordinates',
      'position',
      'wall',
      'walls',
      'edge',
      'north',
      'south',
      'east',
      'west',
      'direction',
    ],
  },
  {
    // Getting started -> the Learn course index. Low priority so a search that
    // also names a topic (e.g. "learn to fire") still lands on that topic.
    answer: '/learn',
    keywords: [
      'learn',
      'tutorial',
      'getting started',
      'get started',
      'how do i start',
      'where do i start',
      'where do i begin',
      'how do i begin',
      'beginner',
      'new to robocode',
      "i'm new",
      'learn to code',
      'the course',
      'lessons',
      'teach me',
    ],
  },
  {
    // The project itself -> the About page (history, contact, credits).
    answer: '/about',
    keywords: [
      'about',
      'about robocodejs',
      'what is robocodejs',
      'who made',
      'who created',
      'who built',
      'contact',
      'email',
      'get in touch',
      'say hi',
      'github',
      'open source',
      'the project',
      'credits',
      'history',
    ],
  },
];

const escapeRegExp = (s: string): string =>
  s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Precompile one whole-word matcher per route (built once, not per request).
const KEYWORD_MATCHERS = KEYWORD_ROUTES.map((route) => ({
  ...route,
  regex: new RegExp(
    '\\b(' + route.keywords.map(escapeRegExp).join('|') + ')\\b',
    'i'
  ),
}));

// Bag-of-words fallback for natural-language questions that contain no keyword.
const arena = [
  'how do I create a marker?',
  'How do I calculate distance?',
  'how do I calculate bearing?',
  'how do i get arena size?',
  'what is the arena size?',
  'how big is the arena?',
  'which direction is up?',
  'which direction is north?',
  'where am I?',
];
const turret = [
  'How do I use the turret?',
  "why won't the turret shoot?",
  'How long until turret ready to fire?',
  'How do I know if I shot something?',
  'how do I hit an enemy?',
];
const radar = [
  'How do I use the radar?',
  'How do I find other bots?',
  'how do I find enemies?',
  'what does the radar scan return?',
  'How long until radar ready to scan?',
];
const bot = [
  'How do I make the bot move?',
  'why does the bot stop?',
  'how fast does it go?',
  'how do I turn left?',
  'how do I steer?',
  'how do I control the bot?',
];
const logs = [
  'how do I view the logs?',
  'where are the logs?',
  'how do I view the console?',
  'where does console.log go',
];
const clock = [
  'how does the clock work?',
  'how do timers work?',
  'how do I delay an action?',
  'how do I repeat an action?',
  'what time is it?',
  'how many ticks are in a second?',
];
const errors = [
  'why did my bot crash?',
  'why is my bot not working?',
  'why did my code fail?',
  'how do I fix an error?',
  'what went wrong?',
];
const events = [
  'what events are there?',
  'how do I use events?',
  'how do I run code at the start?',
  'how do I react to being hit?',
  'how do I detect a collision?',
];
const learn = [
  'how do I get started?',
  'where do I begin?',
  'teach me to make a bot',
  'I am new here',
];
const mcp = [
  'how do I use an AI to write my bot?',
  'how do I connect an assistant?',
  'how do I use claude with this?',
];
const about = [
  'who made this?',
  'tell me about robocodejs',
  'is this open source?',
  'how do I get in touch?',
];

const classifier = new Classifier();
classifier.train(arena, 'arena');
classifier.train(turret, 'turret');
classifier.train(logs, 'logs');
classifier.train(radar, 'radar');
classifier.train(bot, 'bot');
classifier.train(clock, 'clock');
classifier.train(errors, 'errors');
classifier.train(events, 'events');
classifier.train(learn, 'learn');
classifier.train(mcp, 'mcp');
classifier.train(about, 'about');

const CLASSIFIER_ANSWERS: Record<string, string> = {
  arena: '/learn/docs#arena',
  clock: '/learn/docs#clock',
  bot: '/learn/docs#bot',
  radar: '/learn/docs#radar',
  turret: '/learn/docs#turret',
  events: '/learn/docs#events-overview',
  errors: '/error-codes',
  learn: '/learn',
  mcp: '/mcp',
  about: '/about',
};

const app = express();

app.get('/api/ask', [
  cookieParser(),
  auth(false),
  async (req: Request, res: Response) => {
    const question = req.query.question ? String(req.query.question) : '';
    if (question) {
      // 1. An error code (e.g. "E017") isn't natural language and won't
      // classify — deep-link straight to its entry. Lowercase to match showdown's
      // auto-generated heading anchor (## E017 -> id "e017").
      const codeMatch = question.match(/\b([EW]0\d\d)\b/i);
      if (codeMatch) {
        return res.send({
          answer: `/error-codes#${codeMatch[1].toLowerCase()}`,
        });
      }

      // 2. Keyword map — deterministic, first match by priority order.
      for (const route of KEYWORD_MATCHERS) {
        if (route.regex.test(question)) {
          return res.send({
            answer: route.resolve ? route.resolve(req) : route.answer,
          });
        }
      }

      // 3. Fuzzy fallback for keyword-free natural language.
      const predictions = classifier.predict(question);
      if (predictions.length) {
        const label = predictions[0]['_label'];
        if (label === 'logs') return res.send({ answer: logsAnswer(req) });
        if (CLASSIFIER_ANSWERS[label])
          return res.send({ answer: CLASSIFIER_ANSWERS[label] });
      }
    }
    return res.send({ answer: '/help' });
  },
]);

export default app;
