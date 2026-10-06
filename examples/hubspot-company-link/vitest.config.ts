import { defineConfig } from 'vitest/config';

export default defineConfig({
  cacheDir: process.env.TEST_CACHE_DIR || 'node_modules/.vite',
  test: { include: ['*.test.ts', '*.test.tsx'] },
});
