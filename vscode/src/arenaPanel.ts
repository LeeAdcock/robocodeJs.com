import * as vscode from 'vscode';

// The live arena in an editor panel: a webview that frames the site's public
// spectator page (/watch/:arenaId), so the extension reuses the site's arena
// renderer and client physics instead of carrying its own copy. The server
// allows exactly this framing (frame-ancestors on /watch/* lists VS Code's
// webview and workbench origins; see server/src/middleware/securityHeaders.ts).
export class ArenaPanel implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined;
  private arenaId: string | undefined;

  constructor(
    private readonly serverUrl: string,
    private readonly extensionUri: vscode.Uri
  ) {}

  async show(arenaId: string): Promise<void> {
    if (this.panel && this.arenaId === arenaId) {
      this.panel.reveal(undefined, true);
      return;
    }
    this.arenaId = arenaId;
    const url = await this.watchUrl(arenaId);
    if (!this.panel) {
      this.panel = vscode.window.createWebviewPanel(
        'robocodejs.arena',
        'Arena',
        { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
        {
          // The frame runs its own scripts; the webview document needs none.
          enableScripts: false,
          // Keep the match streaming while the tab is in the background, rather
          // than reloading (and replaying the arena) every time it's shown.
          retainContextWhenHidden: true,
        }
      );
      this.panel.iconPath = vscode.Uri.joinPath(
        this.extensionUri,
        'media',
        'tank.svg'
      );
      this.panel.onDidDispose(() => {
        this.panel = undefined;
        this.arenaId = undefined;
      });
    }
    this.panel.webview.html = this.html(url);
    this.panel.reveal(undefined, true);
  }

  // The page as the user's browser can reach it. For a production server
  // that's the URL itself; for a local dev server in a remote window (dev
  // container, Codespaces) asExternalUri maps localhost to the forwarded port,
  // since the webview renders on the user's machine, not in the container.
  async watchUrl(arenaId: string): Promise<string> {
    const base = await vscode.env.asExternalUri(
      vscode.Uri.parse(this.serverUrl)
    );
    return new URL(`watch/${arenaId}`, base.toString(true).replace(/\/?$/, '/'))
      .href;
  }

  dispose(): void {
    this.panel?.dispose();
  }

  private html(url: string): string {
    const origin = new URL(url).origin;
    const attr = (s: string) =>
      s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
    // The webview's own policy: nothing but the one framed origin and inline
    // styles for the full-bleed layout. The frame is sandboxed without
    // allow-top-navigation, so it can't navigate VS Code's webview away.
    return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; frame-src ${attr(origin)}; style-src 'unsafe-inline';">
<style>
  html, body, iframe { margin: 0; padding: 0; border: 0; width: 100%; height: 100%; overflow: hidden; }
</style>
</head>
<body>
<iframe src="${attr(url)}" title="RobocodeJs arena" sandbox="allow-scripts allow-same-origin"></iframe>
</body>
</html>`;
  }
}
