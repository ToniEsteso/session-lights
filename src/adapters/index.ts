import type { SessionAdapter } from '../shared/contracts.js';
import { CodexAdapter } from './codex.js';
import { DemoAdapter } from './demo.js';
import { ClaudeCodeAdapter } from './claude-code.js';

// Register new providers here. Main and UI code use only the shared adapter contract.
async function createAdapters({ demo = false }: { demo?: boolean } = {}): Promise<SessionAdapter[]> {
  if (demo) return [new DemoAdapter()];
  return [new CodexAdapter(), new ClaudeCodeAdapter()];
}
export { createAdapters };
