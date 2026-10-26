import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      // `server-only` throws outside a React Server Components bundle; tests run plain Node.
      'server-only': fileURLToPath(new URL('./tests/stubs/server-only.ts', import.meta.url)),
    },
  },
  test: {
    include: ['tests/unit/**/*.test.ts', 'tests/contract/**/*.test.ts', 'tests/integration/**/*.test.ts'],
    environment: 'node',
    env: { QLOO_MODE: 'mock', LLM_MODE: 'mock', REDIS_DRIVER: 'memory' },
  },
});
