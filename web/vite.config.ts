import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Dev flow: run `TURNLOG_TOKEN=dev turnlog --port 4483 --no-open` in one
// terminal, `TURNLOG_TOKEN=dev npm run dev -w web` in another. The proxy
// injects the token so the browser app needs none in dev.
const apiPort = process.env.TURNLOG_PORT ?? '4483';
const apiToken = process.env.TURNLOG_TOKEN ?? '';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: `http://127.0.0.1:${apiPort}`,
        // Rewrite Host to the target — the server's DNS-rebinding defense
        // (rightly) rejects the dev origin's Host with its foreign port.
        changeOrigin: true,
        headers: {
          // Browsers attach Origin (the Vite port) to every POST; the
          // server's cross-origin check (rightly) rejects the foreign port,
          // so writes only pass when the proxy presents the target's own.
          Origin: `http://127.0.0.1:${apiPort}`,
          ...(apiToken ? { Authorization: `Bearer ${apiToken}` } : {}),
        },
      },
    },
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1500, // shiki langs are lazy-split; the worker chunk is the big one
  },
  worker: {
    // Module worker so shiki language grammars stay lazily code-split.
    format: 'es',
  },
});
