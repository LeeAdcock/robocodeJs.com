#!/usr/bin/env node
/*
 * Dependency-vulnerability gate for a package.
 *
 * Replaces a bare `npm audit --audit-level=high` in CI. It keeps the exact same
 * severity gate — FAIL on any `high`/`critical` advisory, report-only for
 * `moderate`/`low` — but adds a small, documented ALLOWLIST so a specific
 * advisory that is non-applicable (or has no available fix) can be accepted
 * without silencing the whole gate. This is the CI counterpart of the
 * "Accepted / deferred security risks" section in CLAUDE.md: every entry is
 * justified in one place and any *other* high/critical still fails the build.
 *
 * Run from inside the package directory (CI's `working-directory`), same cwd a
 * bare `npm audit` would use:
 *   node ../scripts/audit-check.cjs
 *
 * Keep the allowlist SHORT and re-review it on every dependency bump: an
 * accepted advisory that later gains a fix should be REMOVED here and the
 * dependency upgraded instead.
 */
'use strict';

const { execSync } = require('node:child_process');

// GHSA ids (the tail of `advisory.url`) that are accepted and must NOT fail CI.
// Currently empty: every known high/critical advisory has an upgrade available
// and is taken. (The last entry, GHSA-qwww-vcr4-c8h2 / react-router RSC-mode
// CSRF, was dropped once react-router-dom 7.18.2 shipped the fix.)
const ALLOWLIST = new Map([]);

const FAIL_SEVERITIES = new Set(['high', 'critical']);

// `npm audit` exits non-zero whenever advisories exist, so capture stdout from
// both the success and the throw path.
let raw;
try {
  raw = execSync('npm audit --json', {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
} catch (err) {
  raw = err.stdout;
}
if (!raw) {
  console.error('audit-check: no output from `npm audit --json`');
  process.exit(2);
}

const audit = JSON.parse(raw);
const vulns = audit.vulnerabilities || {};

const blocking = [];
const accepted = [];

for (const [name, v] of Object.entries(vulns)) {
  // `via` holds either a string (another vulnerable dep in the chain) or an
  // object carrying the actual advisory; the GHSA id lives on the object form.
  for (const via of v.via || []) {
    if (typeof via !== 'object') continue;
    const severity = via.severity || v.severity;
    if (!FAIL_SEVERITIES.has(severity)) continue;
    const ghsa = (via.url || '').split('/').pop();
    const entry = { name, severity, ghsa, title: via.title, url: via.url };
    (ALLOWLIST.has(ghsa) ? accepted : blocking).push(entry);
  }
}

for (const a of accepted) {
  console.log(
    `accepted  ${a.severity.padEnd(8)} ${a.ghsa}  ${a.name}\n` +
      `          ${a.title}\n          reason: ${ALLOWLIST.get(a.ghsa)}`
  );
}
for (const b of blocking) {
  console.error(
    `BLOCKING  ${b.severity.padEnd(8)} ${b.ghsa}  ${b.name} — ${b.title}\n          ${b.url}`
  );
}

if (blocking.length > 0) {
  console.error(
    `\naudit-check: ${blocking.length} high/critical advisory(ies) are not in ` +
      `the allowlist. Upgrade the dependency, or (only if non-applicable / ` +
      `unfixable) add a justified entry to scripts/audit-check.cjs.\n`
  );
  process.exit(1);
}

console.log(
  `\naudit-check: OK — ${accepted.length} accepted, no blocking high/critical ` +
    `advisories.\n`
);
