import { defineConfig } from 'vitest/config';

/**
 * Test config, separate from vite.config.ts (that one is tuned for the
 * library build). Integration tests run against a REAL grapesjs editor
 * inside jsdom (see test/helpers/editor.ts); IndexedDB comes from
 * fake-indexeddb (see test/setup.ts).
 */
export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['test/**/*.test.ts'],
    setupFiles: ['test/setup.ts'],
    globals: false,
    restoreMocks: true,
    css: false,
  },
});
