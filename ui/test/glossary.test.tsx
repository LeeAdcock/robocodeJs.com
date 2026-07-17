// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('axios', () => ({ default: { get: vi.fn() } }));
import axios from 'axios';
import MarkdownPage from '../src/page/markdownPage';
import { splitGlossary } from '../src/util/glossary';

const renderDoc = (md: string, path = 'learn-radar') => {
  vi.mocked(axios.get).mockResolvedValue({ data: md } as never);
  return render(
    <MemoryRouter>
      <MarkdownPage path={path} />
    </MemoryRouter>
  );
};

const terms = (container: HTMLElement) =>
  [...container.querySelectorAll('.glossary-term')].map((el) =>
    el.textContent?.trim()
  );

describe('glossary tooltips in MarkdownPage', () => {
  afterEach(cleanup);

  it('wraps only the first prose occurrence of a term', async () => {
    const { container } = renderDoc(
      'The radar looks around.\n\nPoint the radar again.'
    );
    await screen.findByText(/looks around/);
    expect(terms(container)).toEqual(['radar']);
  });

  it('ignores terms inside code, pre, links, and headings', async () => {
    const { container } = renderDoc(
      [
        '## About the radar',
        'Call `radar.scan()` to look.',
        '```\nbot.radar.scan();\n```',
        '[radar rules](/rules)',
      ].join('\n\n')
    );
    await screen.findByText(/to look/);
    expect(terms(container)).toEqual([]);
  });

  it('does not let a heading occurrence consume the first-occurrence allowance', async () => {
    const { container } = renderDoc(
      '## Using the radar\n\nThe radar finds enemies.'
    );
    await screen.findByText(/finds enemies/);
    // The heading mention is skipped; the later prose mention still wraps.
    expect(terms(container)).toEqual(['radar']);
  });

  it('prefers the longest matching form', async () => {
    const { container } = renderDoc('A state machine keeps your bot focused.');
    await screen.findByText(/keeps your bot/);
    expect(terms(container)).toEqual(['state machine']);
  });

  it('matches case-insensitively and through aliases', async () => {
    const { container } = renderDoc('Variables remember things for you.');
    await screen.findByText(/remember things/);
    const span = container.querySelector('.glossary-term');
    expect(span?.textContent).toBe('Variables');
    // The alias resolves to the canonical entry's tooltip id.
    fireEvent.focus(span!);
    const tooltip = await screen.findByRole('tooltip');
    expect(tooltip.textContent).toContain('named box that stores a value');
  });

  it('shows the definition tooltip on keyboard focus', async () => {
    const { container } = renderDoc('The radar looks around.');
    await screen.findByText(/looks around/);
    const span = container.querySelector('.glossary-term')!;
    expect(span.getAttribute('tabindex')).toBe('0');
    fireEvent.focus(span);
    const tooltip = await screen.findByRole('tooltip');
    expect(tooltip.textContent).toContain('scans for other robots');
  });

  it('leaves blog posts untouched', async () => {
    const { container } = renderDoc(
      'The radar and the arena and a variable.',
      'blog/some-post'
    );
    await screen.findByText(/a variable/);
    expect(terms(container)).toEqual([]);
  });
});

describe('splitGlossary', () => {
  it('returns null when nothing new matches', () => {
    expect(splitGlossary('nothing to see here', new Set())).toBeNull();
    expect(splitGlossary('the radar', new Set(['radar']))).toBeNull();
  });

  it('splits around matches and records seen terms', () => {
    const seen = new Set<string>();
    const segments = splitGlossary('Point the radar at the arena.', seen);
    expect(segments).toEqual([
      'Point the ',
      { entry: expect.objectContaining({ term: 'radar' }), text: 'radar' },
      ' at the ',
      { entry: expect.objectContaining({ term: 'arena' }), text: 'arena' },
      '.',
    ]);
    expect(seen).toEqual(new Set(['radar', 'arena']));
  });

  it('keys the seen set by canonical term across aliases', () => {
    const seen = new Set<string>();
    splitGlossary('Many variables here.', seen);
    expect(seen.has('variable')).toBe(true);
    expect(splitGlossary('A variable again.', seen)).toBeNull();
  });
});
