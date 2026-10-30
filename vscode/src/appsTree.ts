import * as vscode from 'vscode';

import { AppSummary } from './client';

// The sidebar list of the user's apps. Data is pushed in by extension.ts (which
// owns the client and error handling) rather than fetched here.
export class AppsTree implements vscode.TreeDataProvider<AppSummary> {
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
    item.description =
      app.ratingGames > 0 ? `${Math.round(app.rating)} Elo` : undefined;
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
}
