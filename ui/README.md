# RobocodeJs UI

The RobocodeJs front end: a **Vite + React + TypeScript** single-page app that renders the battle arena as SVG and hosts the in-browser bot code editor.

Part of the [RobocodeJs monorepo](../README.md). Runs on port `3000` in development, but you open the app through the root proxy at **<http://localhost:5000>** — relative `/api` calls only reach the server through that proxy (the Vite dev server itself doesn't proxy the API).

## Tech stack

- **Vite 6** + `@vitejs/plugin-react` (build tooling / dev server)
- **React 18** with `react-router-dom`
- **react-bootstrap** / Bootstrap for layout and chrome
- **react-ace** (+ `ace-builds`, `brace`) for the code editor
- **showdown** + `html-react-parser` for rendering the docs pages
- **axios** for REST calls; native `EventSource` for live updates

## Scripts

```bash
npm run dev      # Vite dev server on :3000 (alias: npm start)
npm run build    # tsc --noEmit type-check, then vite build
npm run preview  # serve the production build locally
npm test         # run the Vitest suite once (test/**/*.test.ts)
npm run test:watch  # Vitest in watch mode
npm run lint     # eslint --fix + prettier --write
```

Tests use [Vitest](https://vitest.dev) and live in `test/` (outside `src`). The current suite covers `src/util/simulate.ts` — the client-side movement/rotation/bullet interpolation — which is pure logic over plain objects, so it runs in a plain `node` environment with no DOM.

`vite.config.ts` sets `build.outDir` to `../server/dist/public` (with `emptyOutDir`), so a production build lands directly where the server serves static files from — no copy step. The `build` script runs `tsc --noEmit` first, so type errors fail the build.

## How it works

### State, events, and interpolation

`src/App.tsx` is the heart of the client:

- **Auth** — initializes Google Sign-In; on login it stores the id token in the `auth` cookie and loads the current user.
- **Bootstrapping** — fetches the arena snapshot over REST (`/api/user/:id/arena`, or the public `/api/demo/arena` when signed out).
- **Live updates** — opens an `EventSource` to the server's SSE stream and applies a large per-event-type reducer to the arena state (ticks, tank movement/turn/stop, turret/radar turns, fire/hit, place & remove app/tank, pause/resume, restart).
- **Smooth motion** — between server ticks it runs its own lightweight physics in `src/util/simulate.ts`, a partial mirror of the server's `simulation.ts`. **If the server's movement/collision math changes, update this file to match**, or client and server will drift.

### Arena rendering (`src/components/arena/`)

The arena is drawn with SVG. `arena.tsx` composes the scene from `arenaTank`, `arenaBullet`, `arenaCrater`, `arenaTankPath`, and `arenaTerrain`, with `arenaToolbar` for pause/resume/restart controls. Terrain tiles and sprites come from `public/sprites/` (referenced by absolute `/sprites/...` URLs); `src/util/terraformer.tsx` lays out the tile grid.

### Code editor (`src/page/app/`)

`appPage.tsx` hosts the Ace editor (`appEditor.tsx`) and toolbar. Saving a bot PUTs the source to `.../app/:appId/source`; the server recompiles it into the running isolates so the change takes effect immediately. Prettier formats the source in-editor. App-level notifications (rename, errors) are delivered from `App.tsx` through a small browser-safe pub/sub in `src/util/emitter.ts`.

### Docs & logs

- `src/page/markdownPage.tsx` fetches and renders the static bot documentation from `public/docs/*.md` (served in-app at routes like `/dev` and `/examples`).
- `src/page/arena/` renders the live bot `console` output streamed over the logs SSE channel.

## Project layout

```
public/            static assets served at the web root
  docs/            bot author documentation (markdown)
  samples/         example bots
  sprites/         tank, bullet, and terrain images
index.html         Vite entry (HTML template + module script)
src/
  App.tsx          auth, SSE reducer, routing, tick interpolation
  components/      navbar + SVG arena rendering
  page/            app editor, arena logs, markdown pages
  types/           wire DTOs mirroring the server's types
  util/            colors, ring buffer, client physics, emitter, terraformer
```

## Notes

- `src/types/*` mirror the server's wire DTOs; keep them in sync when the API payloads change.
- `showdown` carries an unfixed moderate ReDoS advisory; it's accepted because it only ever renders our own static `/docs/*.md`, never user input (see the note in `markdownPage.tsx`).
- The production JS bundle is large and not yet code-split — a known future optimization.
