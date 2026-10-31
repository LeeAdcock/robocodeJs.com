import * as vscode from 'vscode';

import { AppSummary, MatchStanding, MatchStatus } from './client';

// Drag payload types between the two sidebar lists. Each carries the dragged
// app ids; VS Code passes the value through untouched within one window.
export const APPS_MIME = 'application/vnd.code.tree.robocodejs.apps';
export const ARENA_MIME = 'application/vnd.code.tree.robocodejs.arena';

const ids = async (
  transfer: vscode.DataTransfer,
  mime: string
): Promise<string[]> => {
  const value = transfer.get(mime)?.value;
  return Array.isArray(value) ? (value as string[]) : [];
};

// The default arena's apps, the one arena the extension manages (multi-arena
// management stays out of scope, as in the browser UI). Drop apps here from the
// Apps list to add them; drag them back onto Apps to remove them. Fed by the
// match_status poll the status bar already makes, so it costs no extra calls.
// Disabled members aren't in match_status, so they don't appear here.
export class ArenaTree
  implements
    vscode.TreeDataProvider<MatchStanding>,
    vscode.TreeDragAndDropController<MatchStanding>
{
  readonly dragMimeTypes = [ARENA_MIME];
  readonly dropMimeTypes = [APPS_MIME];
  private standings: MatchStanding[] = [];
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changed.event;

  constructor(
    private readonly ownApp: (appId: string) => AppSummary | undefined,
    private readonly onAdd: (appIds: string[]) => Promise<void>
  ) {}

  setStatus(status: MatchStatus | undefined): void {
    this.standings = status?.standings ?? [];
    this.changed.fire();
  }

  has(appId: string): boolean {
    return this.standings.some((s) => s.id === appId);
  }

  getTreeItem(s: MatchStanding): vscode.TreeItem {
    const own = this.ownApp(s.id);
    const item = new vscode.TreeItem(s.name ?? s.id.slice(0, 8));
    item.id = s.id;
    item.contextValue = 'arenaApp';
    item.iconPath = new vscode.ThemeIcon(s.alive ? 'pulse' : 'circle-slash');
    item.description = s.alive
      ? `${s.botsAlive} bot${s.botsAlive === 1 ? '' : 's'} alive`
      : 'eliminated';
    item.tooltip = own
      ? `${item.label}: your app`
      : `${item.label}: another player's app, added by share link`;
    if (own) {
      item.command = {
        command: 'robocodejs.openApp',
        title: 'Open App',
        arguments: [own],
      };
    }
    return item;
  }

  getChildren(element?: MatchStanding): MatchStanding[] {
    return element ? [] : this.standings;
  }

  handleDrag(
    source: readonly MatchStanding[],
    transfer: vscode.DataTransfer
  ): void {
    transfer.set(
      ARENA_MIME,
      new vscode.DataTransferItem(source.map((s) => s.id))
    );
  }

  async handleDrop(
    _target: MatchStanding | undefined,
    transfer: vscode.DataTransfer
  ): Promise<void> {
    const appIds = (await ids(transfer, APPS_MIME)).filter(
      (id) => !this.has(id)
    );
    if (appIds.length) await this.onAdd(appIds);
  }
}

export { ids as droppedIds };
