import { defineConfig, configDefaults } from 'vitest/config';

export default defineConfig({
  test: {
    // a11y-audits/tools has its own package and uses node:test, not vitest.
    exclude: [...configDefaults.exclude, '**/a11y-audits/**'],
  },
});
