# Security Overview — OWASP Top 10 Audit

> **Status:** All medium-and-above findings remediated on branch `feat/security-hardening`. **Addressed:** A01-1 (IDOR), A01-2 (log stream), A02-1 (RDS CA verification), A04-1 (timer cap), A04-2/A04-3 (resource caps), A05-1 (security headers + CSP), A06-1 (CI + dependency scanning), A07-1 (rate limiting). Also fixed the cheap 🟡 wins: A03 (mcp `sub` allowlist), A07-2 (`email_verified`), A07-4 (token-rotation CSRF). **Remaining (all 🟡 low, accepted/deferred):** A02-2 (token entropy — `randomUUID` is adequate), A05-2 (DDL startup robustness), A07-3 (session revocation — accepted for the ~1 h TTL), A06-2 (eslint 9 migration chore). A08 (markdown XSS) is mitigated by the A05-1 CSP + React inertness — decision recorded to rely on CSP rather than add a sanitizer. Fixed findings are marked ✅ inline. Line numbers reflect the tree at audit time (branch `feat/error-surfacing`) and may drift.

## Threat model

RobocodeJs runs **untrusted user JavaScript** ("bots") server-side in `isolated-vm` sandboxes, backed by an Express/Postgres API and a React SPA. Arbitrary code from any authenticated user, shared arenas, and cross-user data make **access control, sandbox integrity, and resource exhaustion** the primary concerns.

**Overall posture is solid on the hard parts** — SQL is fully parameterized, the isolated-vm boundary is disciplined (no `ivm` leaked to bots), cookies are HttpOnly/Secure/SameSite, logging avoids secrets. The real gaps are **broken object-level authorization**, **absent rate limiting / resource caps (DoS)**, and **missing hardening** (security headers, CI dependency scanning, DB TLS verification).

---

## A01 — Broken Access Control _(highest severity)_

### ✅ 🔴 A01-1 — IDOR: unscoped `loadApp` exposes any user's bot (read / overwrite / delete)

> **Fixed** (`feat/security-hardening`). Rather than globally scoping `loadApp` (which would block the planned "add another user's app to your arena by id" feature), a new `requireAppOwner` middleware guards the confidential/destructive routes — `GET`/`PUT .../app/:appId/source`, `DELETE`, `compile`, `reboot`. `loadApp` still resolves any id, and the metadata `GET /app/:appId` (id + name only, never source) and `addApp` stay open for reference flows. See `middleware/resource.ts` + `api/app.ts`; regression tests in `test/api.test.ts`.

`loadApp` (`server/src/middleware/resource.ts:71-84`) loads by `:appId` alone and **never checks the app belongs to the path user**. `requireOwner` (`resource.ts:45-68`) only asserts `authUser === :userId`. Because `:userId` and `:appId` are independent params, an attacker passes their **own** `:userId` (satisfying `requireOwner`) with a **victim's** `:appId`. Verified against `server/src/api/app.ts`:

- `GET .../app/:appId/source` (`app.ts:118-128`) → **read any user's bot source** (confidentiality).
- `PUT .../app/:appId/source` (`app.ts:48-62`) → **overwrite any user's source**; `propagateSource` hot-reloads it into the victim's live arenas (`util/botActions.ts`).
- `DELETE .../app/:appId` (`app.ts:131-143`) → **delete any user's bot** (integrity/availability).
- `POST .../compile` and `.../reboot` (`app.ts:80-115`) operate on a victim-owned app object (smaller blast radius — arenas are the attacker's).
- `PUT .../arena/app/:appId` addApp (`api/arena.ts:136-143`) → add a victim's app into the attacker's arena and run it.

**Fix:** scope `loadApp` to the target user (mirror `resolveArena`'s `arena.getUserId() !== targetUser.getId()` check at `resource.ts:99`) using the existing `TankApp.getUserId()` (`types/app.ts:21`). The MCP side already does this correctly via `ownedApp` (`api/mcp.ts:114-117`) — port that check to REST.

### ✅ 🟠 A01-2 — Missing `requireOwner` on read/telemetry routes (cross-user disclosure)

> **Partially addressed by design decision** (`feat/security-hardening`). The product intends users to _spectate_ others' arenas, so arena **status** and **events** are intentionally left open to any signed-in user. The bot **console log** stream (`GET /arena/logs`) — private developer output, not part of watching a match — is now owner-gated with `requireOwner`. Cross-user profile/app/arena _metadata_ (names + ids, never source) is likewise left readable as reference/discovery groundwork.

These authenticate but don't verify the caller owns the `:userId` resource, so any logged-in user can browse another user's data by changing `:userId`:

- `GET .../arena/logs` (`api/arena.ts:244-264`) — **another user's bot console log stream** (`env.getRecentLogs()` + live `log` events). Sharpest one: bot `console.log` can contain author-private data.
- `GET .../arena/events` SSE (`arena.ts:241`) and `GET` arena status (`arena.ts:86`) — live bot positions / arena membership.
- `GET /api/user/:userId` (`api/user.ts:26-37`), `GET .../apps` (`app.ts:23-28`, note the in-code `// TODO filter this response`), `GET .../arenas` (`arena.ts:35`), `GET .../app/:appId` (`app.ts:39-45`) — cross-user profile / app / arena enumeration.

**Fix:** add `requireOwner` after `loadUser` on these routes — **unless** spectating other arenas is an intended product feature, in which case decide explicitly and at minimum close the `/logs` stream.

> Mutating **arena** routes (create/delete/add/remove/restart/pause/resume/speed/seed) are correctly protected — `resolveArena` scopes the arena object. The gap is specifically the unscoped `:appId` (A01-1) and the read routes above.

---

## A02 — Cryptographic Failures

### ✅ 🟠 A02-1 — RDS TLS does not verify the CA

`server/src/util/db.ts` previously set `ssl: { rejectUnauthorized: false }` — the DB link is encrypted but MITM-susceptible.

> **Fixed** (`feat/security-hardening`). AWS's public RDS global CA bundle is vendored at `server/certs/rds-global-bundle.pem` (and shipped via `buildspec.yaml` artifacts). `sslConfig()` in `db.ts` now defaults to `{ ca: <bundle>, rejectUnauthorized: true }`, authenticating the RDS server certificate. Two escape hatches: `RDS_SSL_NO_VERIFY=true` (encrypted but unverified — the old behavior, for a non-RDS cert) and `RDS_SSL=false` (no TLS). **Operational note:** this verifies by default, so a cert/CA mismatch will block the DB connection on deploy — set `RDS_SSL_NO_VERIFY=true` if that happens. Tests in `test/db.test.ts`.

### 🟡 A02-2 — API tokens use `randomUUID()`

`api/token.ts:31` — UUIDv4 is ~122 bits crypto-random (acceptable), but `crypto.randomBytes(32)` is the purpose-built choice. Tokens are correctly stored only as sha256 hashes (`middleware/auth.ts:16-17`). Low priority.

> **Update (MCP OAuth):** the static bearer token and `api/token.ts` were **removed** when MCP auth moved to the OAuth 2.1 flow. Access/refresh tokens and auth codes are still `randomUUID()` and still stored only as sha256 hashes (now in `services/OAuthService.ts` via `util/hash.ts`), so this finding and its low-priority note carry over unchanged; the same `randomBytes(32)` upgrade would apply there.

---

## A03 — Injection

**No SQL injection.** Every query across the data layer uses parameterized `{ text, values }` with `$1..$N`; table/column names are hardcoded literals (verified in `AppService.ts:24-51`, `ArenaService.ts`, `ArenaMemberService.ts`, `IdentityService.ts`, `UserService.ts`, `types/app.ts:34-59`).

**No host-side RCE.** Bot source runs only inside `isolated-vm` (`compiler.ts:474-481`); no host `eval`/`new Function`. Sandbox-definition template strings interpolate only internal constants, never user input.

**✅ Path traversal mitigated.** The only request-driven file reads are in `api/mcp.ts`; `readPublic` reduces filenames via `path.basename`. The `sub` arg was previously unsanitized (though only ever passed hardcoded literals). **Fixed** (`feat/security-hardening`): `listPublic`/`readPublic` now allowlist `sub` to `docs`/`samples`/`ts` via `isAllowedSub`, so it can't regress into a traversal vector even if a future caller sources it from request input.

**No mass assignment** — records are built field-by-field from typed getters / verified token payload, never spread from `req.body`.

---

## A04 — Insecure Design _(resource exhaustion / DoS)_

### ✅ 🔴 A04-1 — Host-side timer maps (memory + CPU amplification)

Each `setInterval`/`setTimeout` creates **two** records: the bot's callback in the in-isolate `__timers` table (counted against the 8 MB `memoryLimit`) **and** a host-side bookkeeping record in `tank.timers.intervalMap` / `timerMap` (`util/scheduleFactory.ts`), which lives on the Node heap and is **not** counted against the isolate limit.

_Correction to the original wording ("unbounded host memory"):_ because every timer also costs isolate memory, the 8 MB cap acts as an accidental throttle on how many can accumulate at once — so a single bot can't grow host memory without limit. The genuine problems are: (a) the host record is larger than the isolate entry and uncounted, so a bot's true host footprint exceeds the nominal 8 MB; and (b) **CPU amplification that recurs every tick** — `timerTick` scans the whole map and fires each due timer via a host→isolate `apply()`, a cost proportional to timer count paid for the whole life of the arena (worst case `setInterval(fn, 0)`, which fires every tick).

> **Fixed** (`feat/security-hardening`). `MAX_TIMERS_PER_TANK` (default 64, combined intervals + timeouts) is enforced in `scheduleFactory.ts`; registrations past the cap are refused (the isolate-side wrapper drops its callback) and the author is warned once with **error code E021** (bot console, non-fatal). Bounds both host memory and per-tick CPU deterministically instead of relying on OOM as a proxy. A minimum-interval floor was intentionally **not** added — it would change legitimate every-tick timer behavior, and the count cap already bounds per-tick work. Tests in `test/scheduleFactory.test.ts`.

### ✅ 🟠 A04-2 — No global cap on isolates across users

Per-user limits exist (10 arenas `arena.ts:22`; 4 apps/arena `mcp.ts:33`; 5 tanks/app) → up to ~250 isolates × 8 MB ≈ **2 GB per user**, with **no cross-user ceiling** (`types/environment.ts:542,582`). Many users → host RAM exhaustion.

> **Fixed** (`feat/security-hardening`). A global `MAX_TOTAL_ARENAS` ceiling (default 1000, env-tunable) is enforced at explicit arena creation via `arenaService.count()`, returning **503** when the server is at capacity. Bounds the persistent worst-case isolate count across all users; live isolates are further reclaimed by the existing 30-minute idle GC. (Lazy one-per-user default-arena creation is intentionally exempt so new users never fail to bootstrap.)

### ✅ 🟠 A04-3 — Unbounded app creation

`POST .../app/` had **no per-user cap**, unlike arenas (`MAX_ARENAS_PER_USER`, `arena.ts:22,49-54`).

> **Fixed** (`feat/security-hardening`). `MAX_APPS_PER_USER` (20) enforced in `api/app.ts`.

_(Positive: per-tick drain bounded by `MAX_DRAIN_ROUNDS=10000`; logs bounded by `MAX_LOGS_PER_TICK=50` / `MAX_LOG_LENGTH=2000` / `recentLogs=200`.)_

---

## A05 — Security Misconfiguration

### ✅ 🟠 A05-1 — No security headers / no CSP (no `helmet`)

`server/src/index.ts` installed pino-http, body parsers, cookie-parser, static serving, routes — but **no `helmet`, no CSP, no `X-Frame-Options`, no `X-Content-Type-Options: nosniff`, no HSTS** (only cookie flags in `session.ts:39-43` existed). For a SPA that runs untrusted JS this is a notable gap (clickjacking + no XSS defense-in-depth).

> **Fixed** (`feat/security-hardening`). `middleware/securityHeaders.ts` applies `helmet` (installed first in `index.ts`, so static assets + API + SPA fallback are all covered): CSP, `frame-ancestors 'self'` + `X-Frame-Options`, `nosniff`, HSTS, `object-src 'none'`, `base-uri 'self'`, and `X-Powered-By` stripped. The CSP was built from the actual built bundle (`server/dist/public/index.html`) and allows exactly the SPA's real dependencies — our own `'self'` bundle, Google Identity Services (sign-in), Google Fonts, and `*.googleusercontent.com` avatars. Two documented relaxations: `script-src 'unsafe-eval'` (ace-builds + prettier need it; does **not** permit injected inline/other-origin scripts, so the latent markdown-XSS stays blocked) and `style-src 'unsafe-inline'` (ace theme injection). `crossOriginOpenerPolicy` is set to `same-origin-allow-popups` so Google sign-in's popup flow survives. Verified the header is emitted and assets serve 200 against a running local-dev server; tests in `test/securityHeaders.test.ts`. Note: this is defense-in-depth that also covers the A08 latent markdown-XSS.

### 🟡 A05-2 — Startup robustness in lazy DDL

`CREATE TABLE IF NOT EXISTS` promises fire at import time without `await`/`.catch` (e.g. `AppService.ts:6-17`) — a startup race and unhandled rejection on failure. Not a vuln; robustness.

---

## A06 — Vulnerable & Outdated Components

### ✅ 🟠 A06-1 — No dependency/security scanning in CI

`buildspec.yaml` ran only `npm i` + `npm run build` — **no `npm audit`, no CodeQL/Snyk/Dependabot**, and there was **no `.github/` at all**. `buildspec.yaml` used `npm i` (not `npm ci`), so lockfiles weren't strictly enforced.

> **Fixed** (`feat/security-hardening`). Added `.github/workflows/ci.yml` — on every PR/push it runs, per package, `npm ci` + eslint + build + tests + **`npm audit --audit-level=high`** (fails the build on high/critical advisories; the accepted moderate showdown ReDoS stays below the gate). Added `.github/dependabot.yml` for weekly npm + github-actions update PRs. Switched `buildspec.yaml` to **`npm ci`** for reproducible, lockfile-enforced deploy installs. This also stands up the project's first CI (previously none).

### 🟡 A06-2 — Known advisories (accepted / dev-only)

- `showdown@2.1.0` has an unfixed ReDoS advisory (GHSA-rmmh-p597-ppvv) — not exploitable while input is trusted static docs (see A08), but `npm audit` will flag it.
- `eslint@8.57.1` is EOL — dev-only, low risk.
- `isolated-vm@^6.1.2` — the `^` range is fine because `npm-shrinkwrap.json` pins the production tree; **keep isolated-vm and Node majors moving together** (per CLAUDE.md: 6.x needs Node ≥22; 7.x needs ≥26).

---

## A07 — Identification & Authentication Failures

Google id-token verification is correct: signature + expiry + **audience** checked (`middleware/auth.ts:53-58`), re-verified every request (`auth.ts:138`), dev bypass double-gated on `NODE_ENV !== 'production'` **and** absent `RDS_HOSTNAME` (`auth.ts:64`, `util/devMode.ts`).

### ✅ 🟠 A07-1 — No rate limiting anywhere

No `express-rate-limit` present. Unthrottled: `POST /api/session` (unauthenticated sign-in, `session.ts:13`), `GET/POST /api/token[/new]` (`token.ts:46,55`), `POST /api/mcp` (`mcp.ts:961`), and `POST .../check` / `.../compile` which each spin a fresh 8 MB isolate for ≤5 s (`app.ts:67-95`, `compiler.ts:928-967`).

> **Fixed** (`feat/security-hardening`). `middleware/rateLimit.ts` adds `express-rate-limit` limiters: **auth** (IP-keyed, 20/10min — sign-in + token), **compute** (user-keyed, 60/min — check/compile/reboot isolate spawns), **write** (user-keyed, 30/min — app/arena creation), and a broad **api** backstop (600/min). Refusals return **429** with a JSON body carrying **error code E022**; `trust proxy` is set so IP keying works behind the proxy/ELB. Limits are env-tunable and skipped under `NODE_ENV=test`. Documented in `rules.md` + `error-codes.md`; tests in `test/rateLimit.test.ts`. (`POST /api/mcp` shares the `/api` backstop; a dedicated MCP limit remains a possible follow-up.)

### 🟡 A07-2 — No `email_verified` / hosted-domain check on account creation

### ✅ 🟡 A07-2 — No `email_verified` check on account creation

`userService.create(...)` trusted the token's `email` without checking `payload.email_verified`. Identity key is `payload.sub` (correct), so low severity — but the stored email was untrusted.

> **Fixed** (`feat/security-hardening`). First-login account creation in `auth.ts` now rejects (401 + `clearCookie`) when `payload.email_verified !== true`, so an unverified address is never persisted. Test in `test/auth.test.ts`.

### 🟡 A07-3 — No server-side session revocation

Logout just clears the cookie (`session.ts:66-70`); a stolen still-valid id token works until its ~1 h expiry. **Accepted:** a revocation denylist is disproportionate work for the short (~1 h) token TTL. No action.

### ✅ 🟡 A07-4 — Token-rotation CSRF via GET

`GET /api/token/new` rotates a token; SameSite=lax cookies ride top-level GET navigations, so a tricked navigation could force-rotate a victim's token (DoS on their MCP connection; cannot exfiltrate).

> **Fixed** (`feat/security-hardening`). A `rejectCrossSite` guard on `GET /api/token/new` returns 403 when `Sec-Fetch-Site: cross-site` — blocking the cross-site navigation vector while still allowing `same-origin` links and address-bar (`none`) use. Tests in `test/token.test.ts`.
>
> **Update (MCP OAuth):** now **moot** — the state-changing token-rotation GET (`GET /api/token/new`) and all of `api/token.ts` were **removed** when MCP auth moved to the OAuth 2.1 flow. There is no longer a browser-navigable endpoint that mutates a credential: OAuth codes/tokens are minted via `POST /token` (form POST, PKCE-bound) and the session-gated `POST /api/oauth/authorize`, neither reachable by a top-level GET navigation.

---

## A08 — Software & Data Integrity Failures

- **✅ XSS — none live, latent markdown gap mitigated.** No `dangerouslySetInnerHTML`/`innerHTML` in `ui/src/`. Bot logs (`page/arena/logs.tsx:340-342`), bot names (`arenaTank.tsx:134`), and bot source (Ace editor) are all React-escaped. The markdown pipeline `showdown.makeHtml` → `html-react-parser` (`markdownPage.tsx`) is unsanitized, but the latent risk is now **mitigated three ways** (decision: rely on CSP rather than add a sanitizer dependency): (1) input is only ever the app's own static `/docs/*.md`, never user data; (2) `html-react-parser` builds React elements, so injected inline `<script>` / string `on*=` handlers are inert; (3) the **A05-1 CSP** blocks `javascript:` URLs and inline/foreign scripts as a backstop. The tradeoff and the one-line DOMPurify escalation path are documented at the render site in `markdownPage.tsx`.
  **Residual:** if this ever renders untrusted markdown, add `DOMPurify.sanitize` before `parse()`.
- **Supply-chain integrity:** production installs pinned via `npm-shrinkwrap.json`; deploy + CI now use `npm ci` (A06-1).

---

## A09 — Security Logging & Monitoring Failures

Logging hygiene is **good**: structured pino logger, no tokens/cookies logged (`session.ts`, `token.ts`), API tokens stored as sha256 hashes, generic 500s to clients with details logged server-side only (`index.ts`, `auth.ts`).

> **✅ Addressed** (`security/a09-logging-monitoring`). Every security-relevant condition is emitted with a **stable `event` field** and context, via the `LogEvent` catalogue in `util/logger.ts`, so a log pipeline can match and alarm on them: `bot.fault` (+`timedOut`), `sandbox.catastrophic`, `auth.failed`, `auth.forbidden`, `auth.signin`, `auth.token.created`, **`auth.token.revoked`** (was defined but never emitted — now logged in `oauthProvider.revokeToken`), `rate.limited` (the A07-1 limiter refusals, `middleware/rateLimit.ts`), **`mcp.tool`** (new — an audit trail of MCP tool invocations by `userId`/`tool`, since a bearer token grants full control of a user's bots/arenas), `db.error`, `http.error`, and `process.fatal`. The full catalogue, per-event monitoring guidance, and a suggested **Alerting** table (thresholds + where CloudWatch metric-filter/alarm config would live) are documented in the server README "Logging & monitoring". Tests assert the audit events fire.

**Alarm wiring (this deployment).** CloudWatch metric-filter alarms are now provided as `.ebextensions` config: `cloudwatch-logs.config` streams stdout to CloudWatch Logs, and the opt-in `cloudwatch-alarms.config.example` (rename to activate) defines alarms for the key events → the `Alerts` SNS topic. The substring filter patterns are validated against real pino output with `aws logs test-metric-filter`. See the server README "Logging & monitoring → Alerting". **Residual:** the alarm CloudFormation itself is validated only on deploy (the CI IAM identity is EB-scoped), so first activation is a staging validation; thresholds and the notification target remain environment-tunable.

---

## A10 — Server-Side Request Forgery (SSRF)

**No SSRF surface found.** The server makes no outbound requests driven by user input; the only external call is Google token verification (fixed endpoint via `google-auth-library`). Bots cannot make network calls (no `fetch`/`http` in the isolate; `Date` and host globals removed). No finding.

---

## Prioritized remediation backlog

| #   | Finding                                                                        | Category                   | Severity    | Status          |
| --- | ------------------------------------------------------------------------------ | -------------------------- | ----------- | --------------- |
| 1   | `requireAppOwner` on source/delete/compile/reboot (IDOR)                       | A01-1                      | 🔴 Critical | ✅ Done         |
| 2   | Owner-gate `/arena/logs` (status/events open by design for spectating)         | A01-2                      | 🟠 High     | ✅ Done         |
| 3   | Cap per-tank timers (host DoS) → E021                                          | A04-1                      | 🔴 High     | ✅ Done         |
| 4   | Add rate limiting (sign-in, token, isolate-spawning routes) → E022             | A07-1                      | 🟠 High     | ✅ Done         |
| 5   | Global arena cap + `MAX_APPS_PER_USER`                                         | A04-2/3                    | 🟠 Med      | ✅ Done         |
| 6   | Add `helmet` + CSP + `X-Frame-Options`                                         | A05-1                      | 🟠 Med      | ✅ Done         |
| 7   | Add CI dependency scanning; `npm ci`                                           | A06-1                      | 🟠 Med      | ✅ Done         |
| 8   | Pin RDS CA, `rejectUnauthorized: true`                                         | A02-1                      | 🟠 Med      | ✅ Done         |
| 9   | Sanitize markdown pipeline / rely on CSP                                       | A08                        | 🟡 Low      | ✅ CSP          |
| 10  | `email_verified` check · allowlist mcp `sub` · token-rotation CSRF             | A07-2, A03, A07-4          | 🟡 Low      | ✅ Done         |
| 11  | Token entropy (`randomBytes`) · DDL robustness · session revocation · eslint 9 | A02-2, A05-2, A07-3, A06-2 | 🟡 Low      | ⬜ Accept/defer |

## Verification approach (when fixes are implemented)

- **Access control (A01):** add tests to `server/test/api.test.ts` / `auth.test.ts` asserting that user A calling `/api/user/A/app/{B's appId}/source` (GET/PUT/DELETE) returns 404/401 — mirror the existing ownership tests. Reproduce the current IDOR first, then confirm the fix closes it.
- **DoS caps (A04):** unit-test the timer cap in `scheduleFactory.test.ts` (register > cap → excess rejected); assert `MAX_APPS_PER_USER` in `api.test.ts`.
- **Rate limiting (A07):** integration test that the Nth rapid `POST /api/session` returns 429.
- **Headers (A05):** assert `helmet` headers present on a sample response.
- **Full regression:** `(cd server && npm test)` and `(cd ui && npm test)` — the sandbox-integration and reducer suites must stay green.
