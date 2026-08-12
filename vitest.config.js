import { defineConfig, configDefaults } from 'vitest/config';

export default defineConfig({
  test: {
    // a11y-audits/tools uses node:test; design-system has its own Playwright suite.
    exclude: [...configDefaults.exclude, '**/a11y-audits/**', '**/design-system/**'],
  },
});
