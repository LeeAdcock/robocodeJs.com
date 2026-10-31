import * as vscode from 'vscode';
import * as path from 'node:path';
import { promises as fs } from 'node:fs';

import { appFileName } from './source';

// Per-app bookkeeping kept next to the cached source.
interface AppMeta {
  appId: string;
  // The server source version this local copy was last fetched or saved as.
  // A save compares the server's current version against it to catch an edit
  // made elsewhere (the browser editor) in the meantime.
  baseVersion: string;
}

const META_FILE = '.robocode.json';
const DTS_FILE = 'robocode.d.ts';

// Each app's tsconfig scope: the bot-API globals and nothing else (no DOM or
// Node typings — bot code runs in a bare isolate). One per app directory so two
// apps' top-level declarations never collide in a shared project.
const JSCONFIG = {
  compilerOptions: {
    target: 'es2022',
    lib: ['es2022'],
    types: [],
    checkJs: false,
  },
  include: ['*.js', `../${DTS_FILE}`],
};

// The local mirror of the user's apps. VS Code's TypeScript service only offers
// full IntelliSense for real files (custom URI schemes get syntax-only support),
// so apps are edited as files in extension storage — one directory per app
// holding the source, a jsconfig.json, and its metadata, with robocode.d.ts at
// the root — and every save is pushed to the server.
export class AppWorkspace {
  readonly root: vscode.Uri;

  constructor(
    storage: vscode.Uri,
    serverUrl: string,
    private readonly dtsSource: vscode.Uri
  ) {
    // Separate trees per server, so a local dev server's apps never mix with
    // production's.
    this.root = vscode.Uri.joinPath(
      storage,
      new URL(serverUrl).host || 'server'
    );
  }

  async prepare(): Promise<void> {
    await fs.mkdir(this.root.fsPath, { recursive: true });
    await fs.copyFile(
      this.dtsSource.fsPath,
      path.join(this.root.fsPath, DTS_FILE)
    );
  }

  // The app a local file belongs to, or undefined if it isn't one of ours.
  appIdFor(uri: vscode.Uri): string | undefined {
    if (uri.scheme !== 'file') return undefined;
    const rel = path.relative(this.root.fsPath, uri.fsPath);
    const parts = rel.split(path.sep);
    if (parts.length !== 2 || parts[0] === '..' || !parts[1].endsWith('.js'))
      return undefined;
    return parts[0];
  }

  fileFor(appId: string, name: string): vscode.Uri {
    return vscode.Uri.joinPath(this.root, appId, appFileName(name));
  }

  // Write the server's copy of an app and record which version it is. An app
  // renamed since the last fetch has its old file moved, so a stale tab never
  // lingers under the previous name.
  async write(
    appId: string,
    name: string,
    source: string,
    version: string
  ): Promise<vscode.Uri> {
    const dir = path.join(this.root.fsPath, appId);
    await fs.mkdir(dir, { recursive: true });
    const file = this.fileFor(appId, name);
    for (const entry of await fs.readdir(dir)) {
      if (entry.endsWith('.js') && entry !== path.basename(file.fsPath))
        await fs.rm(path.join(dir, entry), { force: true });
    }
    await fs.writeFile(file.fsPath, source, 'utf8');
    await fs.writeFile(
      path.join(dir, 'jsconfig.json'),
      JSON.stringify(JSCONFIG, null, 2) + '\n'
    );
    await this.setBaseVersion(appId, version);
    return file;
  }

  async baseVersion(appId: string): Promise<string | undefined> {
    try {
      const raw = await fs.readFile(this.metaPath(appId), 'utf8');
      return (JSON.parse(raw) as AppMeta).baseVersion;
    } catch {
      return undefined;
    }
  }

  async setBaseVersion(appId: string, baseVersion: string): Promise<void> {
    const meta: AppMeta = { appId, baseVersion };
    await fs.writeFile(this.metaPath(appId), JSON.stringify(meta) + '\n');
  }

  private metaPath(appId: string): string {
    return path.join(this.root.fsPath, appId, META_FILE);
  }
}
