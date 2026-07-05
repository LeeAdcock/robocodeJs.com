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
});
