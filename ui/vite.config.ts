import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // The root reverse proxy (../index.js) forwards non-/api traffic here.
    port: 3000,
    strictPort: true,
    // Forward API/health calls straight to the server too, so the Vite dev URL
    // (:3000) works on its own — not just behind the root proxy (:5000). Without
    // this, Vite's SPA fallback answers /api/* with index.html (a 200 of HTML),
    // which makes the on-load auth check silently fail and the app appear signed
    // out. SSE endpoints (/events) stream fine through the proxy.
    proxy: {
      '/api': 'http://localhost:8080',
      '/health': 'http://localhost:8080',
    },
  },
  build: {
    // The server serves the built UI as static files from this directory
    // (see server/src/index.ts: express.static("./dist/public")).
    outDir: '../server/dist/public',
    emptyOutDir: true,
  },
});
