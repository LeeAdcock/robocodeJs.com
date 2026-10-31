// Turns a check_app_source result into editor problems. Pure (no vscode import)
// so it can be unit-tested; extension.ts maps these onto vscode.Diagnostics.

// The result shape of the check_app_source MCP tool (CheckResult in
// server/src/util/compiler.ts).
export interface CheckResult {
  valid: boolean;
  stage?: 'compile' | 'lint' | 'load';
  errorCode?: string;
  message?: string;
  timedOut?: boolean;
}

export interface Problem {
  // 0-based, as vscode.Position expects.
  line: number;
  column: number;
  message: string;
}

// The server wraps bot source as `(() => {'use strict';<source>\n})()` before
// compiling it (wrapSource in compiler.ts), so a compile or load error on line 1
// reports a column shifted by the prefix. Later lines are unaffected, and the
// lint stage runs on the raw source.
const WRAP_PREFIX_LENGTH = "(() => {'use strict';".length;

// Every location in a message is rendered as "(line L, char C)", by
// cleanErrorMessage for isolate errors and by the lint stage per finding.
const LOCATION = /\s*\(line (\d+), char (\d+)\)/;

export const toProblems = (result: CheckResult): Problem[] => {
  if (result.valid) return [];
  const code = result.errorCode ? `${result.errorCode}: ` : '';
  const message = (result.message ?? 'The app failed to load.').replace(
    /\.$/,
    ''
  );
  // A lint failure joins up to five findings with "; ", each carrying its own
  // location, then may end with "and N more".
  const parts = result.stage === 'lint' ? message.split('; ') : [message];
  const problems: Problem[] = [];
  for (const part of parts) {
    const match = LOCATION.exec(part);
    if (!match) {
      // No location (e.g. "and 3 more", or a load error thrown outside the
      // bot's code): attach to the first line so it is still visible.
      problems.push({ line: 0, column: 0, message: code + part });
      continue;
    }
    const line = Number(match[1]);
    let column = Number(match[2]);
    if (line === 1 && result.stage !== 'lint') {
      column = Math.max(1, column - WRAP_PREFIX_LENGTH);
    }
    problems.push({
      line: Math.max(0, line - 1),
      column: Math.max(0, column - 1),
      message: code + part.replace(LOCATION, ''),
    });
  }
  return problems;
};

// A runtime crash, as the recent_faults MCP tool reports it.
export interface Fault {
  appId: string;
  botId: string;
  botIndex: number;
  code: string;
  kind: string;
  message: string;
  line?: number;
  column?: number;
  timedOut: boolean;
  time: number;
}

// A stable identity for a fault (they carry no id of their own), so the same
// crash isn't reported twice across refreshes.
export const faultKey = (f: Fault): string =>
  [f.appId, f.botId, f.time, f.code, f.kind, f.line, f.column, f.message].join(
    '|'
  );

// Where a crash lands in the editor. Runtime errors come from the wrapped
// source, so line 1 carries the same column shift as a load error.
export const faultToProblem = (f: Fault): Problem => {
  const line = f.line ?? 1;
  let column = f.column ?? 1;
  if (line === 1) column = Math.max(1, column - WRAP_PREFIX_LENGTH);
  return {
    line: Math.max(0, line - 1),
    column: Math.max(0, column - 1),
    message:
      `${f.code}: ${f.message.replace(LOCATION, '')} ` +
      `(bot #${f.botIndex} crashed at tick ${f.time}${f.timedOut ? ', timed out' : ''})`,
  };
};
