// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('axios', () => ({ default: { get: vi.fn() } }));
import axios from 'axios';
import MarkdownPage from '../src/page/markdownPage';

const md = [
  '[sample](/samples/lighthouse.js)',
  '[external](https://example.com/x)',
  '[internal](/dev)',
].join('\n\n');

describe('MarkdownPage', () => {
  beforeEach(() => {
    vi.mocked(axios.get).mockResolvedValue({ data: md } as never);
  });
  afterEach(cleanup);

  it('fetches and renders the requested doc', async () => {
    render(
      <MemoryRouter>
        <MarkdownPage path="examples" />
      </MemoryRouter>
    );
    await screen.findByText('sample');
    expect(axios.get).toHaveBeenCalledWith('/docs/examples.md');
  });

  it('opens sample-source and external links in a new tab, but not in-app links', async () => {
    render(
      <MemoryRouter>
        <MarkdownPage path="examples" />
      </MemoryRouter>
    );

    const sample = await screen.findByText('sample');
    const external = screen.getByText('external');
    const internal = screen.getByText('internal');

    expect(sample.getAttribute('target')).toBe('_blank');
    expect(sample.getAttribute('rel')).toContain('noopener');
    expect(external.getAttribute('target')).toBe('_blank');
    expect(internal.getAttribute('target')).toBeNull();
  });
});
