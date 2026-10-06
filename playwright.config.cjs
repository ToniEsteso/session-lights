const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.spec.cjs',
  // Native windows share focus. Never run these checks in parallel.
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  outputDir: '.evidence/e2e/results',
  reporter: [['list'], ['html', { outputFolder: '.evidence/e2e/report', open: 'never' }]],
});
