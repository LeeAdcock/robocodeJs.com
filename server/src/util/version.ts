import fs from 'node:fs';
import path from 'node:path';

// The deployed server version, read once from package.json at startup so it can
// be surfaced (e.g. in /health) to confirm which build is actually live — the
// fastest way to validate a deploy. Resolved from a few candidate locations so
// it works from the compiled bundle (dist/src/util -> <root>/package.json), from
// the process cwd (Elastic Beanstalk runs the app from the bundle root), or under
// the test runner. Falls back to the npm-provided env var, then 'unknown', rather
// than throwing.
function resolveVersion(): string {
  const candidates = [
    path.join(__dirname, '..', '..', '..', 'package.json'),
    path.join(process.cwd(), 'package.json'),
  ];
  for (const p of candidates) {
    try {
      const pkg = JSON.parse(fs.readFileSync(p, 'utf8'));
      if (pkg && typeof pkg.version === 'string') return pkg.version;
    } catch {
      // try the next candidate
    }
  }
  return process.env.npm_package_version || 'unknown';
}

export const VERSION = resolveVersion();

export default VERSION;
