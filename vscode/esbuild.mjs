// Bundles the extension into one CommonJS file (VS Code loads extensions with
// require) and copies in robocode.d.ts, the bot-API typings the extension drops
// next to each app so the editor's TypeScript service gives full IntelliSense.
import { build, context } from 'esbuild';
import { copyFileSync, mkdirSync, rmSync } from 'node:fs';

// Start clean, so a production package never ships a dev build's stale map.
rmSync('dist', { recursive: true, force: true });
mkdirSync('dist', { recursive: true });
copyFileSync('../ui/public/docs/ts/robocode.d.ts', 'dist/robocode.d.ts');

// `--production` (npm run package) ships a minified bundle without a source
// map; dev builds keep the map for F5 debugging.
const production = process.argv.includes('--production');

const options = {
  entryPoints: ['src/extension.ts'],
  bundle: true,
  outfile: 'dist/extension.js',
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  external: ['vscode'],
  sourcemap: !production,
  minify: production,
  logLevel: 'info',
};

if (process.argv.includes('--watch')) {
  await (await context(options)).watch();
} else {
  await build(options);
}
