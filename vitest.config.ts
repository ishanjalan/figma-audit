import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@rules': new URL('./packages/handover-rules/src', import.meta.url).pathname,
    },
  },
  test: {
    environment: 'node',
  },
});
