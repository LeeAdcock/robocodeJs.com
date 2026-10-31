import * as vscode from 'vscode';

import { AppSummary } from './client';
import { APPS_MIME, ARENA_MIME, droppedIds } from './arenaTree';

// The sidebar list of the user's apps. Data is pushed in by extension.ts (which
// owns the client and error handling) rather than fetched here. Apps drag from
// here into the Default Arena list; an arena app dropped back here is removed
// from the arena.
export class AppsTree
  implements
    vscode.TreeDataProvider<AppSummary>,
    vscode.TreeDragAndDropController<AppSummary>
{
  readonly dragMimeTypes = [APPS_MIME];
  readonly dropMimeTypes = [ARENA_MIME];
  // Set by extension.ts once the arena actions exist.
  onRemoveFromArena: (appIds: string[]) => Promise<void> = async () =>
    undefined;
  private apps: AppSummary[] = [];
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changed.event;

  setApps(apps: AppSummary[]): void {
    this.apps = [...apps].sort((a, b) => a.name.localeCompare(b.name));
    this.changed.fire();
  }

  find(appId: string): AppSummary | undefined {
    return this.apps.find((a) => a.appId === appId);
  }

  getTreeItem(app: AppSummary): vscode.TreeItem {
    const item = new vscode.TreeItem(app.name);
    item.id = app.appId;
    item.contextValue = 'app';
    item.iconPath = new vscode.ThemeIcon('file-code');
    item.tooltip = `${app.name}\n${app.ratingGames} ranked games · version ${app.version}`;
    item.command = {
      command: 'robocodejs.openApp',
      title: 'Open App',
      arguments: [app],
    };
    return item;
  }

  getChildren(element?: AppSummary): AppSummary[] {
    return element ? [] : this.apps;
  }

  handleDrag(source: readonly AppSummary[], transfer: vscode.DataTransfer) {
    transfer.set(
      APPS_MIME,
      new vscode.DataTransferItem(source.map((a) => a.appId))
    );
  }

  async handleDrop(
    _target: AppSummary | undefined,
    transfer: vscode.DataTransfer
  ): Promise<void> {
    const appIds = await droppedIds(transfer, ARENA_MIME);
    if (appIds.length) await this.onRemoveFromArena(appIds);
  }
}
