import * as vscode from 'vscode';

import { RobocodeAuth } from './auth';
import {
  AppSummary,
  RobocodeClient,
  SignInCancelledError,
  SignInRequiredError,
} from './client';
import { AppsTree } from './appsTree';
import { AppWorkspace } from './workspace';
import { BotLogs } from './botLogs';
import { ArenaStatus } from './arenaStatus';
import { ArenaPanel } from './arenaPanel';
import { Fault, faultToProblem, toProblems } from './problems';
import { sourceFromText, sourceVersion } from './source';

export async function activate(context: vscode.ExtensionContext) {
  const serverUrl = vscode.workspace
    .getConfiguration('robocodejs')
    .get<string>('serverUrl', 'https://robocodejs.com')
    .replace(/\/+$/, '');
  const output = vscode.window.createOutputChannel('RobocodeJs');
  const auth = new RobocodeAuth(context.secrets, serverUrl, (line) =>
    output.appendLine(line)
  );
  const client = new RobocodeClient(serverUrl, auth);
  const workspace = new AppWorkspace(
    context.globalStorageUri,
    serverUrl,
    vscode.Uri.joinPath(context.extensionUri, 'dist', 'robocode.d.ts')
  );
  await workspace.prepare();

  const tree = new AppsTree();
  const diagnostics = vscode.languages.createDiagnosticCollection('robocodejs');
  // Live crashes, kept apart from check results: a save re-checks the source
  // but says nothing about whether the new code still crashes at runtime.
  const runtime =
    vscode.languages.createDiagnosticCollection('robocodejs-runtime');
  const log = (line: string) => output.appendLine(line);
  const arenaStatus = new ArenaStatus(client, log);
  const arenaPanel = new ArenaPanel(serverUrl, context.extensionUri);
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('robocodejs.apps', tree),
    diagnostics,
    runtime,
    output,
    arenaStatus,
    arenaPanel
  );

  // Everything live (bot logs, the arena status) runs only while signed in.
  const setSignedIn = async (signedIn: boolean) => {
    if (signedIn) {
      arenaStatus.start();
    } else {
      arenaStatus.stop();
      botLogs.stop();
    }
    await vscode.commands.executeCommand(
      'setContext',
      'robocodejs.signedIn',
      signedIn
    );
  };

  // Every command funnels its failures through here, so an expired sign-in
  // anywhere turns into one consistent prompt.
  const report = async (err: unknown) => {
    if (err instanceof SignInCancelledError) return;
    if (err instanceof SignInRequiredError) {
      await setSignedIn(false);
      tree.setApps([]);
      const choice = await vscode.window.showWarningMessage(
        err.message,
        'Sign In'
      );
      if (choice) await vscode.commands.executeCommand('robocodejs.signIn');
      return;
    }
    const message = err instanceof Error ? err.message : String(err);
    output.appendLine(`[error] ${message}`);
    vscode.window.showErrorMessage(`RobocodeJs: ${message}`);
  };
  const guarded =
    <A extends unknown[]>(fn: (...args: A) => Promise<unknown>) =>
    (...args: A) =>
      fn(...args).catch(report);

  const refresh = async () => {
    tree.setApps(await client.listApps());
  };

  // A crash lands on the failing line of the app's local file, and one
  // notification per batch (an app's five bots often crash together) offers to
  // jump there. Crashes in apps that aren't the user's (added by reference) are
  // logged but have no file to point at.
  const showFaults = async (faults: Fault[]) => {
    const byApp = new Map<string, Fault[]>();
    for (const f of faults)
      byApp.set(f.appId, [...(byApp.get(f.appId) ?? []), f]);
    for (const [appId, appFaults] of byApp) {
      const app = tree.find(appId);
      if (!app) continue;
      const uri = workspace.fileFor(app.appId, app.name);
      const added = appFaults.map((f) => {
        const p = faultToProblem(f);
        const d = new vscode.Diagnostic(
          new vscode.Range(p.line, p.column, p.line, Number.MAX_SAFE_INTEGER),
          p.message,
          vscode.DiagnosticSeverity.Error
        );
        d.source = 'RobocodeJs (runtime)';
        return d;
      });
      runtime.set(uri, [...(runtime.get(uri) ?? []), ...added]);
      const first = faultToProblem(appFaults[0]);
      const choice = await vscode.window.showErrorMessage(
        `${app.name}: ${appFaults.length} bot crash${appFaults.length > 1 ? 'es' : ''} — ${first.message}`,
        'Show',
        'Bot Logs'
      );
      if (choice === 'Show') {
        await openApp(app);
        const editor = vscode.window.activeTextEditor;
        if (editor) {
          const pos = new vscode.Position(first.line, first.column);
          editor.selection = new vscode.Selection(pos, pos);
          editor.revealRange(new vscode.Range(pos, pos));
        }
      } else if (choice === 'Bot Logs') {
        botLogs.show();
      }
    }
  };
  const clearFaults = (appId: string) => {
    runtime.forEach((uri) => {
      if (workspace.appIdFor(uri) === appId) runtime.delete(uri);
    });
  };

  const botLogs = new BotLogs(
    client,
    auth,
    (appId) => tree.find(appId)?.name,
    (faults) => void showFaults(faults),
    log
  );
  context.subscriptions.push(botLogs);
  const startLogs = () =>
    botLogs.start().catch((err) => {
      if (!(err instanceof SignInRequiredError))
        log(`bot logs: ${err instanceof Error ? err.message : String(err)}`);
    });

  // The app the active editor is showing, if it's one of ours.
  const activeApp = ():
    { appId: string; doc: vscode.TextDocument } | undefined => {
    const doc = vscode.window.activeTextEditor?.document;
    const appId = doc && workspace.appIdFor(doc.uri);
    return appId && doc ? { appId, doc } : undefined;
  };
  const appIdArg = (arg?: AppSummary): string | undefined =>
    arg?.appId ?? activeApp()?.appId;

  const checkDocument = async (doc: vscode.TextDocument) => {
    const problems = toProblems(await client.check(doc.getText()));
    diagnostics.set(
      doc.uri,
      problems.map((p) => {
        const line = Math.min(p.line, Math.max(0, doc.lineCount - 1));
        const range =
          doc.getWordRangeAtPosition(new vscode.Position(line, p.column)) ??
          doc.lineAt(line).range;
        const diagnostic = new vscode.Diagnostic(
          range,
          p.message,
          vscode.DiagnosticSeverity.Error
        );
        diagnostic.source = 'RobocodeJs';
        return diagnostic;
      })
    );
    return problems.length;
  };

  const openApp = async (app: AppSummary) => {
    const file = workspace.fileFor(app.appId, app.name);
    const open = vscode.workspace.textDocuments.find(
      (d) => d.uri.toString() === file.toString()
    );
    // Never clobber unsaved edits with the server's copy.
    if (!open?.isDirty) {
      const text = await client.getSourceText(app.appId);
      await workspace.write(
        app.appId,
        app.name,
        sourceFromText(text, app.version),
        app.version
      );
    }
    const doc = await vscode.workspace.openTextDocument(file);
    await vscode.window.showTextDocument(doc, { preview: false });
    await checkDocument(doc);
    // Working on an app is when its runtime crashes matter.
    void startLogs();
  };

  // Push a saved app file to the server, guarding against overwriting an edit
  // made elsewhere (typically the browser editor) since this copy was fetched.
  const pushDocument = async (doc: vscode.TextDocument, appId: string) => {
    const source = doc.getText();
    const local = sourceVersion(source);
    const base = await workspace.baseVersion(appId);
    const server = (await client.listApps()).find((a) => a.appId === appId);
    if (!server) throw new Error('This app no longer exists on the server.');
    if (server.version === local) return; // Nothing to push.
    if (base && server.version !== base) {
      const choice = await vscode.window.showWarningMessage(
        `"${server.name}" was changed on RobocodeJs since you opened it, ` +
          'probably in the browser editor.',
        { modal: true },
        'Overwrite Server Copy',
        'Discard Mine and Reload'
      );
      if (choice === 'Discard Mine and Reload') {
        await openApp(server);
        return;
      }
      if (choice !== 'Overwrite Server Copy') return;
    }
    const saved = await client.setSource(appId, source);
    await workspace.setBaseVersion(appId, saved.version);
    // The crashes on record were from the code just replaced.
    clearFaults(appId);
    vscode.window.setStatusBarMessage(
      `$(cloud-upload) Saved ${server.name}`,
      3000
    );
    await refresh();
  };

  const formatEdits = async (
    doc: vscode.TextDocument
  ): Promise<vscode.TextEdit[]> => {
    const result = await client.format(doc.getText());
    if (!result.ok || !result.changed || result.formatted === undefined)
      return [];
    const all = new vscode.Range(
      doc.positionAt(0),
      doc.positionAt(doc.getText().length)
    );
    return [vscode.TextEdit.replace(all, result.formatted)];
  };

  // Compile and reboot act on the saved server copy, so save first.
  const saveFirst = async (appId: string) => {
    const doc = vscode.workspace.textDocuments.find(
      (d) => workspace.appIdFor(d.uri) === appId
    );
    if (doc?.isDirty) await doc.save();
  };

  context.subscriptions.push(
    vscode.commands.registerCommand(
      'robocodejs.signIn',
      guarded(async () => {
        if (client.isSigningIn) {
          await auth.reopenAuthorization();
          return;
        }
        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: 'Signing in to RobocodeJs in your browser…',
            cancellable: true,
          },
          (_, token) => client.signIn(token)
        );
        await setSignedIn(true);
        await refresh();
      })
    ),
    vscode.commands.registerCommand(
      'robocodejs.signOut',
      guarded(async () => {
        await client.signOut();
        await setSignedIn(false);
        tree.setApps([]);
      })
    ),
    vscode.commands.registerCommand('robocodejs.refresh', guarded(refresh)),
    vscode.commands.registerCommand('robocodejs.openApp', guarded(openApp)),
    vscode.commands.registerCommand(
      'robocodejs.newApp',
      guarded(async () => {
        const name = await vscode.window.showInputBox({
          prompt: 'Name your new app',
          placeHolder: 'e.g. Sweeper',
        });
        if (!name) return;
        const created = await client.createApp(name);
        await refresh();
        await openApp(
          tree.find(created.appId) ?? {
            ...created,
            rating: 0,
            ratingGames: 0,
          }
        );
      })
    ),
    vscode.commands.registerCommand(
      'robocodejs.check',
      guarded(async (arg?: AppSummary) => {
        const appId = appIdArg(arg);
        const doc = vscode.workspace.textDocuments.find(
          (d) => workspace.appIdFor(d.uri) === appId
        );
        if (!doc) throw new Error('Open an app to check it.');
        const count = await checkDocument(doc);
        vscode.window.setStatusBarMessage(
          count ? `$(error) ${count} problem(s)` : '$(check) No problems',
          3000
        );
      })
    ),
    vscode.commands.registerCommand(
      'robocodejs.format',
      // Applies the server's formatting directly rather than via Format
      // Document, which may resolve to another installed JS formatter.
      guarded(async () => {
        const app = activeApp();
        if (!app) throw new Error('Open an app to format it.');
        const edit = new vscode.WorkspaceEdit();
        edit.set(app.doc.uri, await formatEdits(app.doc));
        await vscode.workspace.applyEdit(edit);
      })
    ),
    vscode.commands.registerCommand(
      'robocodejs.compile',
      guarded(async (arg?: AppSummary) => {
        const appId = appIdArg(arg);
        if (!appId) throw new Error('Open an app to compile it.');
        await saveFirst(appId);
        await client.compile(appId);
        clearFaults(appId);
        void arenaStatus.refresh();
        vscode.window.setStatusBarMessage(
          '$(play) Compiled in your arenas',
          3000
        );
      })
    ),
    vscode.commands.registerCommand(
      'robocodejs.reboot',
      guarded(async (arg?: AppSummary) => {
        const appId = appIdArg(arg);
        if (!appId) throw new Error('Open an app to reboot it.');
        await saveFirst(appId);
        await client.reboot(appId);
        clearFaults(appId);
        void arenaStatus.refresh();
        vscode.window.setStatusBarMessage(
          '$(debug-restart) Rebooted in your arenas',
          3000
        );
      })
    ),
    vscode.commands.registerCommand(
      'robocodejs.watchArena',
      guarded(async () => {
        const arena = await client.defaultArena();
        await arenaPanel.show(arena.arenaId);
      })
    ),
    vscode.commands.registerCommand(
      'robocodejs.watchArenaInBrowser',
      guarded(async () => {
        const arena = await client.defaultArena();
        await vscode.env.openExternal(
          vscode.Uri.parse(await arenaPanel.watchUrl(arena.arenaId))
        );
      })
    ),
    vscode.commands.registerCommand(
      'robocodejs.showLogs',
      guarded(async () => botLogs.show())
    ),
    vscode.commands.registerCommand(
      'robocodejs.runMatch',
      guarded(async () => {
        const arena = await client.defaultArena();
        // A match restarts the arena with every app's saved code; push any
        // unsaved app edits first so the match runs what's on screen.
        for (const doc of vscode.workspace.textDocuments)
          if (workspace.appIdFor(doc.uri) && doc.isDirty) await doc.save();
        const result = await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: 'Running a match in your arena…',
          },
          () => client.runMatch(arena.arenaId)
        );
        void arenaStatus.refresh();
        const outcome = result.timedOut
          ? 'The match was not decided in time.'
          : result.match.winner
            ? `${result.match.winner.name ?? 'An app'} won the match.`
            : 'The match ended without a winner.';
        const choice = await vscode.window.showInformationMessage(
          outcome,
          'Watch Arena',
          'Bot Logs'
        );
        if (choice === 'Watch Arena') await arenaPanel.show(arena.arenaId);
        else if (choice === 'Bot Logs') botLogs.show();
      })
    ),

    // Offer RobocodeJs to VS Code's own MCP support (Copilot agent mode and
    // other chat participants), which signs in with the same OAuth server.
    vscode.lm.registerMcpServerDefinitionProvider('robocodejs', {
      provideMcpServerDefinitions: () => [
        new vscode.McpHttpServerDefinition(
          'RobocodeJs',
          vscode.Uri.parse(`${serverUrl}/api/mcp`)
        ),
      ],
    }),

    // Format with the server's house style (the same Prettier settings as the
    // browser editor), so Format Document in an app file matches the site.
    vscode.languages.registerDocumentFormattingEditProvider(
      { pattern: new vscode.RelativePattern(workspace.root, '*/*.js') },
      {
        provideDocumentFormattingEdits: (doc) =>
          formatEdits(doc).catch(async (err) => {
            await report(err);
            return [];
          }),
      }
    ),

    vscode.workspace.onDidSaveTextDocument((doc) => {
      const appId = workspace.appIdFor(doc.uri);
      if (!appId) return;
      void pushDocument(doc, appId)
        .then(() => checkDocument(doc))
        .catch(report);
    }),
    vscode.workspace.onDidCloseTextDocument((doc) => {
      diagnostics.delete(doc.uri);
      runtime.delete(doc.uri);
    }),
    vscode.window.onDidChangeActiveTextEditor(() =>
      vscode.commands.executeCommand(
        'setContext',
        'robocodejs.appEditor',
        activeApp() !== undefined
      )
    ),
    vscode.workspace.onDidChangeConfiguration(async (e) => {
      if (!e.affectsConfiguration('robocodejs.serverUrl')) return;
      const choice = await vscode.window.showInformationMessage(
        'Reload the window to connect to the new RobocodeJs server.',
        'Reload'
      );
      if (choice)
        await vscode.commands.executeCommand('workbench.action.reloadWindow');
    })
  );

  await vscode.commands.executeCommand(
    'setContext',
    'robocodejs.appEditor',
    activeApp() !== undefined
  );

  // Restore the previous session without prompting: signed in is simply
  // whether a connection works, which also covers a local dev server that
  // needs no sign-in at all.
  client
    .listApps()
    .then(async (apps) => {
      await setSignedIn(true);
      tree.setApps(apps);
    })
    .catch(async (err) => {
      await setSignedIn(false);
      if (!(err instanceof SignInRequiredError)) await report(err);
    });
}

export function deactivate() {}
