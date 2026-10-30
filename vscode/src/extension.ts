import * as vscode from 'vscode';

import { RobocodeAuth } from './auth';
import { AppSummary, RobocodeClient, SignInRequiredError } from './client';
import { AppsTree } from './appsTree';
import { AppWorkspace } from './workspace';
import { toProblems } from './problems';
import { sourceFromText, sourceVersion } from './source';

export async function activate(context: vscode.ExtensionContext) {
  const serverUrl = vscode.workspace
    .getConfiguration('robocodejs')
    .get<string>('serverUrl', 'https://robocodejs.com')
    .replace(/\/+$/, '');
  const callbackUri = await vscode.env.asExternalUri(
    vscode.Uri.parse(`${vscode.env.uriScheme}://${context.extension.id}/auth`)
  );
  const auth = new RobocodeAuth(
    context.secrets,
    serverUrl,
    callbackUri.toString(true)
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
  const output = vscode.window.createOutputChannel('RobocodeJs');
  context.subscriptions.push(
    vscode.window.registerUriHandler(auth),
    vscode.window.registerTreeDataProvider('robocodejs.apps', tree),
    diagnostics,
    output
  );

  const setSignedIn = (signedIn: boolean) =>
    vscode.commands.executeCommand(
      'setContext',
      'robocodejs.signedIn',
      signedIn
    );

  // Every command funnels its failures through here, so an expired sign-in
  // anywhere turns into one consistent prompt.
  const report = async (err: unknown) => {
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
        vscode.window.setStatusBarMessage(
          '$(debug-restart) Rebooted in your arenas',
          3000
        );
      })
    ),
    vscode.commands.registerCommand(
      'robocodejs.watchArena',
      guarded(async () => {
        const arenas = await client.listArenas();
        const arena = arenas.find((a) => a.isDefault) ?? arenas[0];
        if (!arena) throw new Error('You have no arenas yet.');
        await vscode.env.openExternal(vscode.Uri.parse(arena.watchUrl));
      })
    ),

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
    vscode.workspace.onDidCloseTextDocument((doc) =>
      diagnostics.delete(doc.uri)
    ),
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
