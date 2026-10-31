import { describe, expect, it, vi } from 'vitest';

// The drag-and-drop contract between the Apps and Default Arena lists, with
// just enough of the vscode API stubbed to run the handlers outside VS Code.
vi.mock('vscode', () => {
  class EventEmitter {
    event = () => undefined;
    fire() {}
  }
  class DataTransferItem {
    constructor(readonly value: unknown) {}
  }
  class TreeItem {
    constructor(readonly label: string) {}
  }
  class ThemeIcon {
    constructor(readonly id: string) {}
  }
  return { EventEmitter, DataTransferItem, TreeItem, ThemeIcon };
});

import { APPS_MIME, ArenaTree } from '../src/arenaTree';
import { AppsTree } from '../src/appsTree';

// A minimal DataTransfer: a map from mime type to item.
const transfer = () => {
  const items = new Map<string, { value: unknown }>();
  return {
    get: (mime: string) => items.get(mime),
    set: (mime: string, item: { value: unknown }) => void items.set(mime, item),
  } as never;
};

const valueOf = (t: never, mime: string) =>
  (t as { get: (m: string) => { value: unknown } }).get(mime).value;

const standing = (id: string) => ({
  rank: 1,
  id,
  name: id,
  alive: true,
  botsAlive: 5,
  totalHealth: 500,
});

const app = (appId: string) => ({
  appId,
  name: appId,
  version: 'v',
  rating: 0,
  ratingGames: 0,
});

describe('Apps to Default Arena drag and drop', () => {
  it('drags app ids out of the Apps list', () => {
    const t = transfer();
    new AppsTree().handleDrag([app('a'), app('b')], t);
    expect(valueOf(t, APPS_MIME)).toEqual(['a', 'b']);
  });

  it('adds only apps not already in the arena', async () => {
    const onAdd = vi.fn(async () => undefined);
    const arena = new ArenaTree(() => undefined, onAdd);
    arena.setStatus({
      running: true,
      clock: { time: 0 },
      match: { decided: false, suddenDeath: false, winner: null },
      standings: [standing('a')],
    });
    const t = transfer();
    new AppsTree().handleDrag([app('a'), app('b')], t);
    await arena.handleDrop(undefined, t);
    expect(onAdd).toHaveBeenCalledWith(['b']);
  });

  it('does nothing when every dropped app is already in', async () => {
    const onAdd = vi.fn(async () => undefined);
    const arena = new ArenaTree(() => undefined, onAdd);
    arena.setStatus({
      running: true,
      clock: { time: 0 },
      match: { decided: false, suddenDeath: false, winner: null },
      standings: [standing('a')],
    });
    const t = transfer();
    new AppsTree().handleDrag([app('a')], t);
    await arena.handleDrop(undefined, t);
    expect(onAdd).not.toHaveBeenCalled();
  });

  it('removes arena apps dropped back on the Apps list', async () => {
    const apps = new AppsTree();
    apps.onRemoveFromArena = vi.fn(async () => undefined);
    const t = transfer();
    new ArenaTree(
      () => undefined,
      async () => undefined
    ).handleDrag([standing('a'), standing('c')], t);
    await apps.handleDrop(undefined, t);
    expect(apps.onRemoveFromArena).toHaveBeenCalledWith(['a', 'c']);
  });

  it('ignores a drop of the wrong kind', async () => {
    const onAdd = vi.fn(async () => undefined);
    const arena = new ArenaTree(() => undefined, onAdd);
    const fromArena = transfer();
    arena.handleDrag([standing('a')], fromArena);
    // An arena item dropped on the arena itself carries no Apps payload.
    await arena.handleDrop(undefined, fromArena);
    expect(onAdd).not.toHaveBeenCalled();

    const apps = new AppsTree();
    apps.onRemoveFromArena = vi.fn(async () => undefined);
    const fromApps = transfer();
    apps.handleDrag([app('b')], fromApps);
    await apps.handleDrop(undefined, fromApps);
    expect(apps.onRemoveFromArena).not.toHaveBeenCalled();
  });
});
