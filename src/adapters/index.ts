import type { SessionAdapter } from '../shared/contracts.js';
import * as path from 'node:path';
import { CodexDesktopAdapter } from './codex-desktop.js';
import { CodexCliAdapter } from './codex-cli.js';
import { DemoAdapter } from './demo.js';

// Register new providers here. Main and UI code use only the shared adapter contract.
async function createAdapters({ demo = false, testDir }: { demo?: boolean; testDir?: string | undefined } = {}): Promise<SessionAdapter[]> {
  if (demo) return [new DemoAdapter()];
  const adapters: SessionAdapter[] = [new CodexDesktopAdapter(testDir ? {
    root: path.join(testDir, 'codex'), logs: path.join(testDir, 'logs'), usageOptions: {
      command: process.execPath, args: [path.join(__dirname, '..', '..', 'test', 'usage-server.js')],
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', SESSION_LIGHTS_USAGE_FIXTURE: path.join(testDir, 'usage.json') }
    }
  } : {}), new CodexCliAdapter(testDir ? { root: path.join(testDir, 'codex') } : {})];
  if (testDir) {
    const { FileAdapter } = await import('../../test/file-adapter.js');
    adapters.push(new FileAdapter(path.join(testDir, 'provider.json')));
  }
  return adapters;
}
export { createAdapters };
