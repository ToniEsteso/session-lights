const { defineConfig } = require('@playwright/test');
const path = require('node:path');

// Each run retains its own report. A second run must not erase failure evidence.
// Playwright reloads this file in workers. Inherit the runner's directory.
const run = process.env.SESSION_LIGHTS_E2E_RUN_ID ||= `${new Date().toISOString().replace(/[:.]/g, '-')}-${process.pid}`;
const evidence = path.join('.evidence', 'e2e', run);
console.log(`Feature evidence: ${evidence}`);

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
  outputDir: path.join(evidence, 'results'),
  reporter: [['list'], ['html', { outputFolder: path.join(evidence, 'report'), open: 'never' }]],
});
