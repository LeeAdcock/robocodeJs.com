import prettier, { type Options } from 'prettier';

// Prettier options mirrored from the repo-root .prettierrc.json so a bot
// formatted through the MCP tool comes out identical to what the in-app editor
// and the pre-commit hook would produce. Kept in sync by hand: the root config
// file isn't shipped in the deploy bundle, so we can't resolve it at runtime.
// `parser: 'babel'` handles the plain-JavaScript bot sources.
const PRETTIER_OPTIONS: Options = {
  parser: 'babel',
  tabWidth: 2,
  singleQuote: true,
  semi: true,
  trailingComma: 'es5',
};

// The outcome of formatting bot source. On success, `formatted` is the pretty-
// printed text and `changed` says whether it differed from the input. On failure
// (unparseable source — i.e. a syntax error) `ok` is false and `message` carries
// the parser's explanation.
export interface FormatResult {
  ok: boolean;
  formatted?: string;
  changed?: boolean;
  message?: string;
}

// Pretty-print bot JavaScript with the project's Prettier settings. Formatting is
// purely cosmetic — it never changes behaviour. A source that can't be parsed
// resolves to { ok: false } with the parser's message rather than throwing, so
// the caller can surface it as a clean tool error and point the author at
// check_app_source for a full compile check. Prettier 3's format() is async.
const format = async (source: string): Promise<FormatResult> => {
  try {
    const formatted = await prettier.format(source, PRETTIER_OPTIONS);
    return { ok: true, formatted, changed: formatted !== source };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
};

export default { format };
