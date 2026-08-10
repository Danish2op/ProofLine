import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '@proofline/canonical': fileURLToPath(
        new URL('./packages/canonical/src/index.ts', import.meta.url),
      ),
      '@proofline/domain': fileURLToPath(
        new URL('./packages/domain/src/index.ts', import.meta.url),
      ),
      '@proofline/authz': fileURLToPath(
        new URL('./packages/authz/src/index.ts', import.meta.url),
      ),
      '@proofline/buzz-adapter': fileURLToPath(
        new URL('./packages/buzz-adapter/src/index.ts', import.meta.url),
      ),
      'next/server': fileURLToPath(
        new URL('./apps/web/node_modules/next/server.js', import.meta.url),
      ),
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
  },
});
