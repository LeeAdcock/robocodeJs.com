import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
    plugins: [react()],
    server: {
        // The root reverse proxy (../index.js) forwards non-/api traffic here.
        port: 3000,
        strictPort: true,
    },
    build: {
        // The server serves the built UI as static files from this directory
        // (see server/src/index.ts: express.static("./dist/public")).
        outDir: '../server/dist/public',
        emptyOutDir: true,
    },
})
