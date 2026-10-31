#!/usr/bin/env node
/*
 * Keeps the VS Code extension's version equal to the server's.
 *
 * The extension ships under the project's release version, so tag vX.Y.Z
 * describes the server AND the extension built from that commit, and an
 * extension's version says which server it needs (extension X.Y.Z expects
 * server >= X.Y.Z). Run by the root `npm run release` right after the server
 * bump, so the one `build: bump server to vX.Y.Z` commit carries both.
 * vscode/test/version.test.ts fails CI if the two ever drift.
 *
 * Uses `npm version` so vscode/package-lock.json is updated too.
 */
'use strict';

const { execFileSync } = require('node:child_process');
const path = require('node:path');

const root = path.join(__dirname, '..');
const version = require(path.join(root, 'server', 'package.json')).version;

execFileSync(
  'npm',
  ['version', version, '--no-git-tag-version', '--allow-same-version'],
  { cwd: path.join(root, 'vscode'), stdio: 'inherit' }
);
