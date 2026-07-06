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
        encodeURIComponent('how do I move the tank around the arena')
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
    expect(await ask('what events are there?')).toBe('/dev#events-overview');
  });

  it('classifies broadened synonyms to the right section', async () => {
    expect(await ask('shoot')).toBe('/dev#turret');
    expect(await ask('radar')).toBe('/dev#radar');
    expect(await ask('timer')).toBe('/dev#clock');
    expect(await ask('drive')).toBe('/dev#bot');
  });

  it('routes common natural-language searches sensibly', async () => {
    expect(await ask('how do I fire the turret?')).toBe('/dev#turret');
    expect(await ask('how do I scan for enemies?')).toBe('/dev#radar');
    expect(await ask('how do I set an interval?')).toBe('/dev#clock');
    expect(await ask('how do I get the distance to an enemy?')).toBe(
      '/dev#arena'
    );
    expect(await ask('my bot stopped working')).toBe('/error-codes');
  });

  it('routes a console/logs search (docs when signed out)', async () => {
    expect(await ask('where does console.log go?')).toBe('/dev#consolelogging');
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

  it('still prefers a specific topic over the generic learn route', async () => {
    // "learn to fire" names a topic (fire) — that should win over /learn.
    expect(await ask('I want to learn to fire')).toBe('/dev#turret');
  });
});
