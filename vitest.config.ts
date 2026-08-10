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
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
  },
});
