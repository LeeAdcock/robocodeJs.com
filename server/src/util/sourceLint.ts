import { Linter } from 'eslint';
import globals from 'globals';

// Static no-undef lint over bot source, run by compiler.check between the
// compile and load stages. Bot code executes in strict mode (see wrapSource),
// so referencing — or assigning to — a variable that was never declared throws
// a ReferenceError at runtime; this catches it at check time instead, with a
// line number, including inside event handlers that a dry-run load never
// executes. Surfaced as E027.
//
// The globals list is a hand-kept mirror of the isolate surface compiler.init
// builds: the ES builtins (which V8 provides in every isolate) minus the two
// compiler.init removes for determinism — Date and Intl — plus the bot API.
// The `_bot_*`/`__*` bridge internals are deliberately NOT listed: they exist
// at runtime but are not contract, and the lint steering authors off them is a
// feature. Keep this in sync when compiler.init gains or removes a global.
const BOT_API_GLOBALS: Record<string, 'readonly'> = {
  bot: 'readonly',
  arena: 'readonly',
  clock: 'readonly',
  Event: 'readonly',
  console: 'readonly',
  logger: 'readonly',
  setInterval: 'readonly',
  clearInterval: 'readonly',
  setTimeout: 'readonly',
  clearTimeout: 'readonly',
};

const LINT_GLOBALS: Record<string, 'readonly' | 'off'> = {
  ...Object.fromEntries(
    Object.keys(globals.builtin).map((k) => [k, 'readonly'])
  ),
  Date: 'off',
  Intl: 'off',
  ...BOT_API_GLOBALS,
};

const linter = new Linter();

export interface LintFinding {
  message: string; // e.g. "'speeed' is not defined."
  line: number;
  column: number;
}

// Returns the undeclared-variable findings for a piece of bot source, in
// source order. Empty when clean. The source is linted RAW (not wrapSource'd)
// so line AND column numbers match the author's editor exactly; globalReturn
// mirrors the fact that the runtime wraps the source in a function body, where
// a top-level `return` is legal.
export const lintUndeclared = (source: string): LintFinding[] => {
  const messages = linter.verify(source, {
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'script',
      parserOptions: { ecmaFeatures: { globalReturn: true } },
      globals: LINT_GLOBALS,
    },
    rules: { 'no-undef': 'error' },
  });
  // A parse error espree hits that V8 accepted (the compile stage has already
  // passed by the time we lint) is a parser disagreement, not an author error —
  // don't fail the check on it.
  if (messages.some((m) => m.fatal)) return [];
  return messages.map((m) => ({
    message: m.message,
    line: m.line,
    column: m.column,
  }));
};
