import * as vscode from 'vscode';

import { MatchStatus, RobocodeClient } from './client';

// How often to refresh while the window has focus. match_status counts against
// the per-user MCP rate limit (60/min, shared with any other MCP client the
// user runs), so this stays at a few calls a minute.
const POLL_MS = 15_000;

// A status bar summary of the default arena's match: the tick and how many apps
// are still alive, or the winner once it's decided. Clicking opens the arena.
export class ArenaStatus implements vscode.Disposable {
  private readonly item = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    50
  );
  private timer: NodeJS.Timeout | undefined;
  private arenaId: string | undefined;

  constructor(
    private readonly client: RobocodeClient,
    private readonly log: (line: string) => void
  ) {
    this.item.command = 'robocodejs.watchArena';
    this.item.name = 'RobocodeJs Arena';
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      if (vscode.window.state.focused) void this.refresh();
    }, POLL_MS);
    void this.refresh();
  }

  stop(): void {
    clearInterval(this.timer);
    this.timer = undefined;
    this.arenaId = undefined;
    this.item.hide();
  }

  dispose(): void {
    this.stop();
    this.item.dispose();
  }

  async refresh(): Promise<void> {
    try {
      this.arenaId ??= (await this.client.defaultArena()).arenaId;
      this.render(await this.client.matchStatus(this.arenaId));
    } catch (err) {
      // A status line isn't worth an error popup; leave the last reading.
      this.log(
        `arena status: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  private render(status: MatchStatus): void {
    const { match, standings } = status;
    const alive = standings.filter((s) => s.alive).length;
    if (match.decided && match.winner) {
      this.item.text = `$(star-full) ${match.winner.name ?? 'Winner'} won`;
    } else if (!status.running) {
      this.item.text = `$(debug-pause) Arena paused`;
    } else {
      this.item.text =
        `$(pulse) t=${status.clock.time} · ${alive}/${standings.length} alive` +
        (match.suddenDeath ? ' · sudden death' : '');
    }
    const tooltip = new vscode.MarkdownString(
      standings.length
        ? standings
            .map(
              (s) =>
                `${s.rank}. **${s.name ?? s.id.slice(0, 8)}** — ` +
                (s.alive
                  ? `${s.botsAlive} bot(s), ${Math.round(s.totalHealth)} health`
                  : 'eliminated')
            )
            .join('  \n')
        : 'No apps in the arena.'
    );
    tooltip.appendMarkdown('\n\nClick to watch the arena.');
    this.item.tooltip = tooltip;
    this.item.show();
  }
}
