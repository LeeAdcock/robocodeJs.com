// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

vi.mock('axios', () => ({ default: { get: vi.fn() } }));
import axios from 'axios';
import LessonPage from '../src/page/lessonPage';

// The /learn/:slug route maps to the markdown file learn-<slug>.md.
describe('LessonPage', () => {
  beforeEach(() => {
    vi.mocked(axios.get).mockResolvedValue({ data: '# Lesson' } as never);
  });
  afterEach(cleanup);

  it('loads the markdown file for the lesson slug', async () => {
    render(
      <MemoryRouter initialEntries={['/learn/hello']}>
        <Routes>
          <Route path="/learn/:slug" element={<LessonPage />} />
        </Routes>
      </MemoryRouter>
    );

    await screen.findByText('Lesson');
    expect(axios.get).toHaveBeenCalledWith('/docs/learn-hello.md');
  });
});
