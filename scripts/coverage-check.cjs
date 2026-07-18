#!/usr/bin/env node
/*
 * Combined coverage gate for the monorepo.
 *
 * The two packages are tested independently (each `npm run test:coverage`
 * emits a `coverage/coverage-summary.json` via the `json-summary` reporter).
 * This script sums their raw covered/total counts into ONE combined number and
 * fails if statements or lines fall below THRESHOLD. It gates the *whole repo's*
 * coverage rather than each package separately, so the strong server suite and
 * the lighter UI suite are judged together (see the CLAUDE.md decision: the
 * gameplay logic is ~100% covered; the UI's React page shells are what pull its
 * standalone number down, and gating them individually would punish untested
 * JSX without improving the game).
 *
 * Only `statements` and `lines` are enforced. `branches`/`functions` are printed
 * for visibility but not gated — they sit below 80 across the repo (untested
 * React components dominate the function count) and would block unrelated work.
 *
 * Run from the repo root, after both package summaries exist:
 *   node scripts/coverage-check.cjs        # gate
 * The root `coverage` script runs both suites first; in CI the summaries are
 * restored from per-package job artifacts before this runs.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const THRESHOLD = 80;
const GATED = ['statements', 'lines'];
const METRICS = ['statements', 'branches', 'functions', 'lines'];

const packages = [
  {
    name: 'server',
    file: path.join('server', 'coverage', 'coverage-summary.json'),
  },
  { name: 'ui', file: path.join('ui', 'coverage', 'coverage-summary.json') },
];

/** @returns {Record<string, {covered:number,total:number}>} */
function readTotals(file) {
  if (!fs.existsSync(file)) {
    console.error(
      `\n  Missing coverage summary: ${file}\n` +
        `  Run the package's \`npm run test:coverage\` first ` +
        `(the root \`npm run coverage\` does both).\n`
    );
    process.exit(2);
  }
  const total = JSON.parse(fs.readFileSync(file, 'utf8')).total;
  const out = {};
  for (const m of METRICS)
    out[m] = { covered: total[m].covered, total: total[m].total };
  return out;
}

const pct = (covered, total) => (total === 0 ? 100 : (100 * covered) / total);
const fmt = (n) => `${n.toFixed(2)}%`.padStart(8);
const cell = (t) =>
  `${fmt(pct(t.covered, t.total))} (${t.covered}/${t.total})`.padEnd(22);

const perPackage = packages.map((p) => ({
  name: p.name,
  totals: readTotals(p.file),
}));

// Combined = sum of raw counts, not an average of percentages (weights each
// package by its size, which is the honest way to combine coverage).
const combined = {};
for (const m of METRICS) {
  combined[m] = perPackage.reduce(
    (acc, p) => ({
      covered: acc.covered + p.totals[m].covered,
      total: acc.total + p.totals[m].total,
    }),
    { covered: 0, total: 0 }
  );
}

console.log(
  '\nCombined coverage (threshold: ' +
    THRESHOLD +
    '% on ' +
    GATED.join(' + ') +
    ')\n'
);
const header =
  'metric'.padEnd(12) +
  packages.map((p) => p.name.padEnd(22)).join('') +
  'combined';
console.log(header);
console.log('-'.repeat(header.length));
for (const m of METRICS) {
  const gated = GATED.includes(m) ? '*' : ' ';
  const row =
    `${gated}${m}`.padEnd(12) +
    perPackage.map((p) => cell(p.totals[m])).join('') +
    cell(combined[m]);
  console.log(row);
}
console.log('\n  * = gated\n');

const failures = GATED.filter(
  (m) => pct(combined[m].covered, combined[m].total) < THRESHOLD
);
if (failures.length > 0) {
  for (const m of failures) {
    console.error(
      `  ✗ combined ${m} ${pct(combined[m].covered, combined[m].total).toFixed(2)}% ` +
        `is below the ${THRESHOLD}% threshold`
    );
  }
  console.error('');
  process.exit(1);
}

console.log(
  `  ✓ combined ${GATED.join(' & ')} coverage meets the ${THRESHOLD}% threshold\n`
);
