// Pre-commit tasks (run by husky -> lint-staged).
//
// Every staged file is Prettier-formatted. In addition, when a package's source
// changes, that package's ESLint runs with --fix. ESLint is intentionally
// per-package (each has its own .eslintrc + plugins resolved from its own
// node_modules), so we invoke each package's own `lint:eslint` script rather
// than a single root run. The functions return a fixed command (no staged-file
// list appended), so each run lints the whole package — which keeps config and
// plugin resolution correct. A genuine lint *error* fails the commit; warnings
// (e.g. react-hooks/exhaustive-deps) do not.
module.exports = {
  '*.{js,jsx,ts,tsx,css,md,json,yaml,yml,html}': 'prettier --write',
  'server/**/*.ts': () => 'npm --prefix server run lint:eslint',
  'ui/**/*.{ts,tsx}': () => 'npm --prefix ui run lint:eslint',
};
