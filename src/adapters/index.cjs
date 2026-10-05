const path = require('node:path');
const { CodexDesktopAdapter } = require('./codex-desktop.cjs');
const { DemoAdapter } = require('./demo.cjs');

// Register new providers here. Main and UI code use only the shared adapter contract.
function createAdapters({ demo, testDir } = {}) {
  if (demo) return [new DemoAdapter()];
  const adapters = [new CodexDesktopAdapter(testDir ? {
    root: path.join(testDir, 'codex'), logs: path.join(testDir, 'logs'), usageOptions: {
      command: process.execPath, args: [path.join(__dirname, '..', '..', 'test', 'usage-server.cjs')],
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', SESSION_LIGHTS_USAGE_FIXTURE: path.join(testDir, 'usage.json') }
    }
  } : {})];
  if (testDir) adapters.push(new (require('../../test/file-adapter.cjs').FileAdapter)(path.join(testDir, 'provider.json')));
  return adapters;
}
module.exports = { createAdapters };
