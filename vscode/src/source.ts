// Pure helpers for mapping server app source onto local files (no vscode import,
// so they're unit-testable).
import { createHash } from 'node:crypto';

// Mirrors server/src/util/sourceVersion.ts: the first 16 hex chars of the
// SHA-256 of the source. The server documents it as recomputable by any client,
// which is what lets the extension detect a save racing a browser edit.
export const sourceVersion = (source: string): string =>
  createHash('sha256').update(source, 'utf8').digest('hex').slice(0, 16);

const EMPTY_VERSION = sourceVersion('');

// get_app_source returns an explanatory sentence, not '', for an app with no
// source. The listed `version` disambiguates: if it is the empty source's
// fingerprint and the text doesn't hash to it, the app is empty.
export const sourceFromText = (text: string, version: string): string =>
  version === EMPTY_VERSION && sourceVersion(text) !== version ? '' : text;

// True when pushing `local` would replace real code on the server (fingerprint
// `serverVersion`) with an empty file. The server keeps no source history, so
// that push is unrecoverable and must be confirmed rather than silent.
export const erasesServerCode = (
  local: string,
  serverVersion: string
): boolean => local.trim() === '' && serverVersion !== EMPTY_VERSION;

// A filesystem-safe file name for an app, so the editor tab reads as the app's
// name. Bot names are already sanitized server-side; this only guards path
// separators and characters some filesystems reject.
export const appFileName = (name: string): string => {
  const safe = name
    // eslint-disable-next-line no-control-regex -- control chars are invalid in file names
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
    .replace(/^\.+/, '')
    .trim()
    .slice(0, 80);
  return `${safe || 'app'}.js`;
};
