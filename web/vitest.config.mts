import { defineConfig } from 'vitest/config';
import path from 'node:path';

// specs/008-socrata-live-fetch-cron.md's first-ever route-level test
// (app/api/cron/sync/route.test.ts) surfaced that vitest had never resolved
// this project's tsconfig `@/*` path alias before now — every prior test
// file used relative imports only. Next's own build (dev/build) resolves
// `@/*` automatically via tsconfig, but vitest needs it configured
// explicitly. No new dependency: `vite` ships as vitest's own transitive
// dependency (see package-lock.json), so `vitest/config` is already
// available with zero additions to package.json.
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, '.'),
    },
  },
});
