import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '~': resolve(__dirname, 'src'),
      'wxt/browser': resolve(__dirname, 'tests/wxt-browser-shim.ts'),
    },
  },
  test: {
    environment: 'node',
    globals: true,
    setupFiles: ['./vitest.polyfill.ts', './vitest.setup.ts'],
    include: ['tests/**/*.test.ts'],
    environmentMatchGlobs: [
      ['tests/integration/**', 'jsdom'],
    ],
  },
});
