# Contributing to RobocodeJs

Thanks for your interest! RobocodeJs is a passion project — a browser-based
programming game and a love letter to the classic [Robocode](https://robocode.sourceforge.io/) —
and contributions of all kinds are welcome, from typo fixes to new game features.

By contributing, you agree that your contributions are licensed under the
project's [MIT License](LICENSE). There's no CLA or sign-off to complete —
opening a pull request is enough.

## Ways to contribute

- **Report a bug** or **request a feature** — open a [GitHub issue](https://github.com/LeeAdcock/robocodeJs.com/issues).
  A minimal repro (steps, expected vs. actual) makes bugs much faster to fix.
- **Fix or build something** — pick up an issue, or check the backlogs:
  [`TASKS.md`](TASKS.md) (engineering/health) and [`ENHANCEMENTS.md`](ENHANCEMENTS.md)
  (product/feature ideas). For anything non-trivial, opening an issue first to
  align on the approach saves everyone time.
- **Improve the docs** — the bot-author docs and the homepage live in
  [`ui/public/docs/`](ui/public/docs); the developer docs are the various
  `README.md` files.
- **Share example bots** — see [`ui/public/samples/`](ui/public/samples).

## Getting set up

You need **Node.js ≥ 24** (required by the native `isolated-vm` build; a
`.devcontainer` with Node 24 is included). No database or Google account is
needed for local development.

```bash
npm run install:all   # installs root + server + ui dependencies
npm start             # runs the proxy, server, and UI together (Ctrl-C stops all)
```

Then open <http://localhost:5000>. With no configuration you land on a running
arena with starter bots — the server falls back to an in-memory database and an
auth bypass. See the [README](README.md#run-it-locally-zero-config) for the full
picture and [`server/README.md`](server/README.md) / [`ui/README.md`](ui/README.md)
for architecture details.

## Development workflow

1. **Branch off `main`** — use a short descriptive name (e.g.
   `fix/turret-reload-timing`, `docs/homepage-tweak`).
2. **Make your change.** Keep pull requests focused — one logical change per PR
   is much easier to review than a grab-bag.
3. **Add or update tests** where it makes sense. Both packages use
   [Vitest](https://vitest.dev/); tests live in each package's `test/` directory.
4. **Run the checks locally** before pushing:

   ```bash
   npm run lint    # prettier + eslint across both packages
   npm test        # runs the Vitest suites
   npm run build   # type-checks and builds the UI, then the server
   ```

   Formatting is applied automatically: a Husky pre-commit hook runs
   `lint-staged` (`prettier --write`) on staged files, so you don't need to
   hand-format. The hook installs itself when you run `npm run install:all`.

5. **CI must pass.** Every PR runs, per package, `npm ci` → lint → build → test →
   `npm audit --audit-level=high` (`.github/workflows/ci.yml`).

## Opening a pull request

- Target the `main` branch.
- Write a clear title and description — what changed and why. Link any related
  issue.
- Commit messages loosely follow [Conventional Commits](https://www.conventionalcommits.org/)
  (`feat:`, `fix:`, `docs:`, `chore:`, `build:`, optionally scoped like
  `fix(server): …`); it keeps the history skimmable, but don't sweat it.
- Make sure CI is green.

## Code style

Style is enforced by Prettier + ESLint (`--fix`) — one root
[`.prettierrc.json`](.prettierrc.json) governs the whole repo, ESLint is
per-package. Run the package `lint` script rather than hand-formatting. When in
doubt, match the surrounding code.

## Reporting a security issue

Please **don't** open a public issue for security vulnerabilities. Email
**[Lee@RobocodeJs.com](mailto:Lee@RobocodeJs.com)** with the details and we'll
coordinate a fix and disclosure. RobocodeJs runs untrusted user code in
sandboxes, so responsible disclosure of sandbox-escape or access-control issues
is especially appreciated.

## Questions

Not sure where to start, or want to talk through an idea? Open an issue or say hi
at [Lee@RobocodeJs.com](mailto:Lee@RobocodeJs.com). Thanks for helping make
RobocodeJs better!
