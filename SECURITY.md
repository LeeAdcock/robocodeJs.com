# Security Overview — OWASP Top 10 Audit

> **Status:** Findings backlog for later resolution. This is an audit deliverable — nothing here has been fixed yet. Findings were verified by reading the source; the flagship access-control bug (`loadApp` IDOR) was hand-traced end-to-end. Line numbers reflect the tree at audit time (branch `feat/error-surfacing`) and may drift.

## Threat model

RobocodeJs runs **untrusted user JavaScript** ("bots") server-side in `isolated-vm` sandboxes, backed by an Express/Postgres API and a React SPA. Arbitrary code from any authenticated user, shared arenas, and cross-user data make **access control, sandbox integrity, and resource exhaustion** the primary concerns.

**Overall posture is solid on the hard parts** — SQL is fully parameterized, the isolated-vm boundary is disciplined (no `ivm` leaked to bots), cookies are HttpOnly/Secure/SameSite, logging avoids secrets. The real gaps are **broken object-level authorization**, **absent rate limiting / resource caps (DoS)**, and **missing hardening** (security headers, CI dependency scanning, DB TLS verification).

---

## A01 — Broken Access Control _(highest severity)_

### 🔴 A01-1 — IDOR: unscoped `loadApp` exposes any user's bot (read / overwrite / delete)

`loadApp` (`server/src/middleware/resource.ts:71-84`) loads by `:appId` alone and **never checks the app belongs to the path user**. `requireOwner` (`resource.ts:45-68`) only asserts `authUser === :userId`. Because `:userId` and `:appId` are independent params, an attacker passes their **own** `:userId` (satisfying `requireOwner`) with a **victim's** `:appId`. Verified against `server/src/api/app.ts`:

- `GET .../app/:appId/source` (`app.ts:118-128`) → **read any user's bot source** (confidentiality).
- `PUT .../app/:appId/source` (`app.ts:48-62`) → **overwrite any user's source**; `propagateSource` hot-reloads it into the victim's live arenas (`util/botActions.ts`).
- `DELETE .../app/:appId` (`app.ts:131-143`) → **delete any user's bot** (integrity/availability).
- `POST .../compile` and `.../reboot` (`app.ts:80-115`) operate on a victim-owned app object (smaller blast radius — arenas are the attacker's).
- `PUT .../arena/app/:appId` addApp (`api/arena.ts:136-143`) → add a victim's app into the attacker's arena and run it.

**Fix:** scope `loadApp` to the target user (mirror `resolveArena`'s `arena.getUserId() !== targetUser.getId()` check at `resource.ts:99`) using the existing `TankApp.getUserId()` (`types/app.ts:21`). The MCP side already does this correctly via `ownedApp` (`api/mcp.ts:114-117`) — port that check to REST.

### 🟠 A01-2 — Missing `requireOwner` on read/telemetry routes (cross-user disclosure)

These authenticate but don't verify the caller owns the `:userId` resource, so any logged-in user can browse another user's data by changing `:userId`:

- `GET .../arena/logs` (`api/arena.ts:244-264`) — **another user's bot console log stream** (`env.getRecentLogs()` + live `log` events). Sharpest one: bot `console.log` can contain author-private data.
- `GET .../arena/events` SSE (`arena.ts:241`) and `GET` arena status (`arena.ts:86`) — live bot positions / arena membership.
- `GET /api/user/:userId` (`api/user.ts:26-37`), `GET .../apps` (`app.ts:23-28`, note the in-code `// TODO filter this response`), `GET .../arenas` (`arena.ts:35`), `GET .../app/:appId` (`app.ts:39-45`) — cross-user profile / app / arena enumeration.

**Fix:** add `requireOwner` after `loadUser` on these routes — **unless** spectating other arenas is an intended product feature, in which case decide explicitly and at minimum close the `/logs` stream.

> Mutating **arena** routes (create/delete/add/remove/restart/pause/resume/speed/seed) are correctly protected — `resolveArena` scopes the arena object. The gap is specifically the unscoped `:appId` (A01-1) and the read routes above.

---

## A02 — Cryptographic Failures

### 🟠 A02-1 — RDS TLS does not verify the CA

`server/src/util/db.ts:29-32` sets `ssl: { rejectUnauthorized: false }` — the DB link is encrypted but MITM-susceptible. The code comment already documents the hardening.
**Fix:** pin the RDS CA bundle and set `rejectUnauthorized: true`.

### 🟡 A02-2 — API tokens use `randomUUID()`

`api/token.ts:31` — UUIDv4 is ~122 bits crypto-random (acceptable), but `crypto.randomBytes(32)` is the purpose-built choice. Tokens are correctly stored only as sha256 hashes (`middleware/auth.ts:16-17`). Low priority.

---

## A03 — Injection

**No SQL injection.** Every query across the data layer uses parameterized `{ text, values }` with `$1..$N`; table/column names are hardcoded literals (verified in `AppService.ts:24-51`, `ArenaService.ts`, `ArenaMemberService.ts`, `IdentityService.ts`, `UserService.ts`, `types/app.ts:34-59`).

**No host-side RCE.** Bot source runs only inside `isolated-vm` (`compiler.ts:474-481`); no host `eval`/`new Function`. Sandbox-definition template strings interpolate only internal constants, never user input.

**Path traversal mitigated.** The only request-driven file reads are in `api/mcp.ts`; `readPublic` reduces filenames via `path.basename` (`mcp.ts:58-67`). ⚠️ Latent: the `sub` arg is **not** sanitized (`mcp.ts:48,61`) but is only ever passed hardcoded literals today.
**Fix (defense-in-depth):** allowlist `sub` so it can't regress into a traversal vector.

**No mass assignment** — records are built field-by-field from typed getters / verified token payload, never spread from `req.body`.

---

## A04 — Insecure Design _(resource exhaustion / DoS)_

### 🔴 A04-1 — Host-side unbounded timer maps (memory + CPU amplification)

`setInterval`/`setTimeout` add entries to host-side `tank.timers.intervalMap` / `timerMap` (`util/scheduleFactory.ts:23-24,68-83`; `compiler.ts:566-576`) that are **plain host JS, not counted against the 8 MB isolate `memoryLimit`**. A bot can register a huge number of timers within its 5 s budget, growing **host process memory** unbounded; then each tick `timerTick` (`scheduleFactory.ts:32-61`) fires **every** registered interval → one `runInIsolate` apply per timer per tick — CPU amplification. `setInterval(fn, 0)` fires every tick with no throttle (`scheduleFactory.ts:42`).
**Fix:** cap the number of timers per tank and enforce a minimum interval.

### 🟠 A04-2 — No global cap on isolates across users

Per-user limits exist (10 arenas `arena.ts:22`; 4 apps/arena `mcp.ts:33`; 5 tanks/app) → up to ~250 isolates × 8 MB ≈ **2 GB per user**, with **no cross-user ceiling** (`types/environment.ts:542,582`). Many users → host RAM exhaustion.
**Fix:** add a global isolate/memory budget and shed load past it.

### 🟠 A04-3 — Unbounded app creation

`POST .../app/` (`app.ts:31-36`) has **no per-user cap**, unlike arenas (`MAX_ARENAS_PER_USER`, `arena.ts:22,49-54`).
**Fix:** add `MAX_APPS_PER_USER`.

_(Positive: per-tick drain bounded by `MAX_DRAIN_ROUNDS=10000`; logs bounded by `MAX_LOGS_PER_TICK=50` / `MAX_LOG_LENGTH=2000` / `recentLogs=200`.)_

---

## A05 — Security Misconfiguration

### 🟠 A05-1 — No security headers / no CSP (no `helmet`)

`server/src/index.ts` installs pino-http, body parsers, cookie-parser, static serving, routes — but **no `helmet`, no CSP, no `X-Frame-Options`, no `X-Content-Type-Options: nosniff`, no HSTS** (only cookie flags in `session.ts:39-43` exist). For a SPA that runs untrusted JS this is a notable gap (clickjacking + no XSS defense-in-depth).
**Fix:** add `helmet` with a restrictive CSP and `frame-ancestors`.

### 🟡 A05-2 — Startup robustness in lazy DDL

`CREATE TABLE IF NOT EXISTS` promises fire at import time without `await`/`.catch` (e.g. `AppService.ts:6-17`) — a startup race and unhandled rejection on failure. Not a vuln; robustness.

---

## A06 — Vulnerable & Outdated Components

### 🟠 A06-1 — No dependency/security scanning in CI

`buildspec.yaml` runs only `npm i` + `npm run build` — **no `npm audit`, no CodeQL/Snyk/Dependabot**, and there is **no `.github/` at all**. `buildspec.yaml:8` uses `npm i` (not `npm ci`), so lockfiles aren't strictly enforced.
**Fix:** add `npm audit --production` (or Dependabot/CodeQL) as a CI gate; switch to `npm ci`.

### 🟡 A06-2 — Known advisories (accepted / dev-only)

- `showdown@2.1.0` has an unfixed ReDoS advisory (GHSA-rmmh-p597-ppvv) — not exploitable while input is trusted static docs (see A08), but `npm audit` will flag it.
- `eslint@8.57.1` is EOL — dev-only, low risk.
- `isolated-vm@^6.1.2` — the `^` range is fine because `npm-shrinkwrap.json` pins the production tree; **keep isolated-vm and Node majors moving together** (per CLAUDE.md: 6.x needs Node ≥22; 7.x needs ≥26).

---

## A07 — Identification & Authentication Failures

Google id-token verification is correct: signature + expiry + **audience** checked (`middleware/auth.ts:53-58`), re-verified every request (`auth.ts:138`), dev bypass double-gated on `NODE_ENV !== 'production'` **and** absent `RDS_HOSTNAME` (`auth.ts:64`, `util/devMode.ts`).

### 🟠 A07-1 — No rate limiting anywhere

No `express-rate-limit` present. Unthrottled: `POST /api/session` (unauthenticated sign-in, `session.ts:13`), `GET/POST /api/token[/new]` (`token.ts:46,55`), `POST /api/mcp` (`mcp.ts:961`), and `POST .../check` / `.../compile` which each spin a fresh 8 MB isolate for ≤5 s (`app.ts:67-95`, `compiler.ts:928-967`).
**Fix:** add per-IP / per-user throttling, tightest on sign-in, token mint, and isolate-spawning routes.

### 🟡 A07-2 — No `email_verified` / hosted-domain check on account creation

`userService.create(payload.name, payload.picture, payload.email)` (`auth.ts:185-190`) trusts the token's `email` without checking `payload.email_verified`. Identity key is `payload.sub` (correct), so low severity today — but the **stored email is untrusted**; flag before any logic keys on email.

### 🟡 A07-3 — No server-side session revocation

Logout just clears the cookie (`session.ts:66-70`); a stolen still-valid id token works until its ~1 h expiry. Acceptable for this app; note it.

### 🟡 A07-4 — Token-rotation CSRF via GET

`GET /api/token/new` (`token.ts:55`) rotates a token; SameSite=lax cookies ride top-level GET navigations, so a tricked navigation can force-rotate a victim's token (DoS on their MCP connection; cannot exfiltrate). SameSite=lax is otherwise the sole (adequate) CSRF defense for state-changing POST/PUT/DELETE.
**Fix:** require POST + CSRF token or an Origin check for token rotation.

---

## A08 — Software & Data Integrity Failures

- **XSS — none live, one latent.** No `dangerouslySetInnerHTML`/`innerHTML` in `ui/src/`. Bot logs (`page/arena/logs.tsx:340-342`), bot names (`arenaTank.tsx:134`), and bot source (Ace editor) are all React-escaped. ⚠️ **Latent:** the markdown pipeline `showdown.makeHtml` → `html-react-parser` (`markdownPage.tsx:94,110`) is **unsanitized** — safe _only_ because input is the app's own static `/docs/*.md`. If untrusted markdown is ever routed through it, it becomes an XSS sink (no DOMPurify in the tree).
  **Fix (defense-in-depth):** add sanitization (DOMPurify) before rendering, and/or the CSP from A05-1.
- **Supply-chain integrity:** production installs pinned via `npm-shrinkwrap.json` (good); CI uses `npm i` not `npm ci` (A06-1).

---

## A09 — Security Logging & Monitoring Failures

Logging hygiene is **good**: structured pino logger, no tokens/cookies logged (`session.ts:37-38`, `token.ts:34-37`), API tokens stored as sha256 hashes, stable `event` fields for fault/security conditions (`bot.fault`, `auth.forbidden`, `sandbox.catastrophic`; `logger.ts`), generic 500s to clients with details logged server-side only (`index.ts:69-75`, `auth.ts`).
**Gaps:** no rate-limit/abuse alerting (ties to A07-1), no CI-based monitoring/alerting pipeline. Consider alerting on repeated `AUTH_FORBIDDEN` (already logged at `resource.ts:54-62`) and `bot.fault` spikes.

---

## A10 — Server-Side Request Forgery (SSRF)

**No SSRF surface found.** The server makes no outbound requests driven by user input; the only external call is Google token verification (fixed endpoint via `google-auth-library`). Bots cannot make network calls (no `fetch`/`http` in the isolate; `Date` and host globals removed). No finding.

---

## Prioritized remediation backlog

| #   | Finding                                                                                       | Category            | Severity    |
| --- | --------------------------------------------------------------------------------------------- | ------------------- | ----------- |
| 1   | Scope `loadApp` to the target user (IDOR)                                                     | A01-1               | 🔴 Critical |
| 2   | Add `requireOwner` to read/telemetry routes (esp. `/logs`)                                    | A01-2               | 🟠 High     |
| 3   | Cap per-tank timers + min interval (host DoS)                                                 | A04-1               | 🔴 High     |
| 4   | Add rate limiting (sign-in, token, isolate-spawning routes)                                   | A07-1               | 🟠 High     |
| 5   | Add `helmet` + CSP + `X-Frame-Options`                                                        | A05-1               | 🟠 Med      |
| 6   | Global isolate cap + `MAX_APPS_PER_USER`                                                      | A04-2/3             | 🟠 Med      |
| 7   | Add CI dependency scanning; `npm ci`                                                          | A06-1               | 🟠 Med      |
| 8   | Pin RDS CA, `rejectUnauthorized: true`                                                        | A02-1               | 🟠 Med      |
| 9   | Sanitize markdown pipeline / rely on CSP                                                      | A08                 | 🟡 Low      |
| 10  | `email_verified` check; allowlist mcp `sub`; token-rotation CSRF; `crypto.randomBytes` tokens | A07-2/4, A03, A02-2 | 🟡 Low      |

## Verification approach (when fixes are implemented)

- **Access control (A01):** add tests to `server/test/api.test.ts` / `auth.test.ts` asserting that user A calling `/api/user/A/app/{B's appId}/source` (GET/PUT/DELETE) returns 404/401 — mirror the existing ownership tests. Reproduce the current IDOR first, then confirm the fix closes it.
- **DoS caps (A04):** unit-test the timer cap in `scheduleFactory.test.ts` (register > cap → excess rejected); assert `MAX_APPS_PER_USER` in `api.test.ts`.
- **Rate limiting (A07):** integration test that the Nth rapid `POST /api/session` returns 429.
- **Headers (A05):** assert `helmet` headers present on a sample response.
- **Full regression:** `(cd server && npm test)` and `(cd ui && npm test)` — the sandbox-integration and reducer suites must stay green.
