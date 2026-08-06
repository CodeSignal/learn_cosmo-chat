import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // a11y-audits/tools has its own package and uses node:test, not vitest.
    exclude: ['**/node_modules/**', '**/a11y-audits/**'],
  },
});
