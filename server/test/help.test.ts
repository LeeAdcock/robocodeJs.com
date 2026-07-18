import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';

// help.ts -> middleware/auth -> util/db runs at import; mock the pool.
vi.mock('../src/util/db', () => ({ default: { query: vi.fn() } }));

import helpRouter from '../src/api/help';

describe('GET /api/ask', () => {
  it('deep-links an error code to its docs entry', async () => {
    const res = await request(helpRouter).get('/api/ask?question=E017');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ answer: '/error-codes#e017' });
  });

  it('matches an error code case-insensitively and inside a sentence', async () => {
    const res = await request(helpRouter).get(
      '/api/ask?question=' + encodeURIComponent('what does e017 mean?')
    );
    expect(res.body).toEqual({ answer: '/error-codes#e017' });
  });

  it('still classifies a natural-language question (not an error code)', async () => {
    const res = await request(helpRouter).get(
      '/api/ask?question=' +
        encodeURIComponent('how do I move the bot around the arena')
    );
    expect(typeof res.body.answer).toBe('string');
    expect(res.body.answer).not.toContain('/error-codes');
  });

  const ask = async (q: string) =>
    (
      await request(helpRouter).get(
        '/api/ask?question=' + encodeURIComponent(q)
      )
    ).body.answer;

  it('routes a bare "error" search to the error-code reference', async () => {
    expect(await ask('error')).toBe('/error-codes');
  });

  it('routes crash/debug phrasings to the error-code reference', async () => {
    expect(await ask('why did my bot crash?')).toBe('/error-codes');
    expect(await ask('how do I debug my bot?')).toBe('/error-codes');
  });

  it('classifies event questions to the events section', async () => {
    expect(await ask('what events are there?')).toBe(
      '/learn/docs#events-overview'
    );
  });

  it('classifies broadened synonyms to the right section', async () => {
    expect(await ask('shoot')).toBe('/learn/docs#turret');
    expect(await ask('radar')).toBe('/learn/docs#radar');
    expect(await ask('timer')).toBe('/learn/docs#clock');
    expect(await ask('drive')).toBe('/learn/docs#bot');
  });

  it('routes common natural-language searches sensibly', async () => {
    expect(await ask('how do I fire the turret?')).toBe('/learn/docs#turret');
    expect(await ask('how do I scan for enemies?')).toBe('/learn/docs#radar');
    expect(await ask('how do I set an interval?')).toBe('/learn/docs#clock');
    expect(await ask('how do I get the distance to an enemy?')).toBe(
      '/learn/docs#arena'
    );
    expect(await ask('my bot stopped working')).toBe('/error-codes');
  });

  it('routes a console/logs search (docs when signed out)', async () => {
    expect(await ask('where does console.log go?')).toBe(
      '/learn/docs#consolelogging'
    );
  });

  it('routes AI / MCP searches to the MCP guide', async () => {
    expect(await ask('mcp')).toBe('/mcp');
    expect(await ask('how do I connect claude?')).toBe('/mcp');
  });

  it('routes getting-started searches to the learn course', async () => {
    expect(await ask('getting started')).toBe('/learn');
    expect(await ask('tutorial')).toBe('/learn');
  });

  it('routes about / contact / email searches to the about page', async () => {
    expect(await ask('about')).toBe('/about');
    expect(await ask('who made this?')).toBe('/about');
    expect(await ask('email')).toBe('/about');
  });

  it('routes lesson-only topics to their specific lessons', async () => {
    expect(await ask('how do I lead a moving target?')).toBe('/learn/leading');
    expect(await ask('how do I flee when low on health?')).toBe(
      '/learn/survival'
    );
    expect(await ask('how do I talk to my teammates?')).toBe('/learn/teamwork');
  });

  it('routes damage/health questions to the combat rules', async () => {
    expect(await ask('how much damage does a shot do?')).toBe(
      '/rules#combat--health'
    );
    expect(await ask('why is my bot losing health?')).toBe(
      '/rules#combat--health'
    );
  });

  it('still prefers the survival lesson for "low health" strategy questions', async () => {
    expect(await ask('what do I do at low health?')).toBe('/learn/survival');
  });

  it('routes match-end and general rules questions to the rules page', async () => {
    expect(await ask('sudden death')).toBe('/rules#match-length');
    expect(await ask('who wins a match?')).toBe('/rules#match-length');
    expect(await ask('game rules')).toBe('/rules');
    expect(await ask('physics')).toBe('/rules');
  });

  it('routes state and reboot questions to the state section', async () => {
    expect(await ask('reboot')).toBe('/learn/docs#state-and-the-start-event');
    expect(await ask('how do I store state?')).toBe(
      '/learn/docs#state-and-the-start-event'
    );
    expect(await ask('why does my bot forget?')).toBe(
      '/learn/docs#state-and-the-start-event'
    );
  });

  it('routes promise/async questions to the waiting lesson', async () => {
    expect(await ask('how do promises work?')).toBe('/learn/waiting');
    expect(await ask('await')).toBe('/learn/waiting');
  });

  it('routes example searches to the example bots', async () => {
    expect(await ask('example')).toBe('/examples');
    expect(await ask('are there sample bots?')).toBe('/examples');
  });

  it('routes classic-Robocode searches to the porting guide', async () => {
    expect(await ask('coming from java robocode')).toBe('/classic');
    expect(await ask('classic')).toBe('/classic');
  });

  it('routes ladder searches to the leaderboard and rankings explainer', async () => {
    expect(await ask('leaderboard')).toBe('/leaderboard');
    expect(await ask('how does elo work?')).toBe('/rankings');
    expect(await ask('rating')).toBe('/rankings');
  });

  it('routes faq and privacy searches to their pages', async () => {
    expect(await ask('faq')).toBe('/faq');
    expect(await ask('privacy')).toBe('/privacy');
  });

  it('classifies keyword-free phrasings for the new destinations', async () => {
    expect(await ask('how do I chain actions one after another?')).toBe(
      '/learn/waiting'
    );
    expect(await ask('how are collisions penalized?')).toBe('/rules');
  });

  it('answers null when nothing matches, rather than a dead /help route', async () => {
    // No keyword and no vocabulary the classifier recognizes -> a real miss.
    const res = await request(helpRouter).get(
      '/api/ask?question=xyzzy%20plugh'
    );
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ answer: null });

    const empty = await request(helpRouter).get('/api/ask?question=');
    expect(empty.body).toEqual({ answer: null });
  });

  it('still prefers a specific topic over the generic learn route', async () => {
    // "learn to fire" names a topic (fire) — that should win over /learn.
    expect(await ask('I want to learn to fire')).toBe('/learn/docs#turret');
  });
});
