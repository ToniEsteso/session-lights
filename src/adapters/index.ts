import type { SessionAdapter } from '../shared/contracts.js';
import { CodexDesktopAdapter } from './codex-desktop.js';
import { CodexCliAdapter } from './codex-cli.js';
import { DemoAdapter } from './demo.js';

// Register new providers here. Main and UI code use only the shared adapter contract.
async function createAdapters({ demo = false }: { demo?: boolean } = {}): Promise<SessionAdapter[]> {
  if (demo) return [new DemoAdapter()];
  return [new CodexDesktopAdapter(), new CodexCliAdapter()];
}
export { createAdapters };
