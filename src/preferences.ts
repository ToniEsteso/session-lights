import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { PanelPreferences } from './shared/contracts.js';
import { SORT_ORDERS } from './shared/contracts.js';
import { isRecord, hasErrorCode } from './shared/validation.js';
const DEFAULTS: PanelPreferences = { theme: 'system', showAll: true, pinned: [], hidden: [], hiddenAdapters: [], displayId: null, y: null, sortOrder: 'activity' };
export function clean(input: unknown = {}): PanelPreferences {
  const value = isRecord(input) ? input : {};
  return { theme: value.theme === 'light' || value.theme === 'dark' ? value.theme : 'system',
    showAll: value.showAll !== false,
    pinned: Array.isArray(value.pinned) ? [...new Set(value.pinned.filter((v: unknown): v is string => typeof v === 'string').slice(0, 500))] : [],
    hidden: Array.isArray(value.hidden) ? [...new Set(value.hidden.filter((v: unknown): v is string => typeof v === 'string'))] : [],
    hiddenAdapters: Array.isArray(value.hiddenAdapters) ? [...new Set(value.hiddenAdapters.filter((v: unknown): v is string => typeof v === 'string'))] : [],
    displayId: typeof value.displayId === 'number' && Number.isInteger(value.displayId) ? value.displayId : null,
    y: typeof value.y === 'number' && Number.isFinite(value.y) ? value.y : null,
    sortOrder: value.sortOrder === 'activity' || value.sortOrder === 'project' ? value.sortOrder : 'activity' };
}
class Preferences {
  value: PanelPreferences = { ...DEFAULTS, pinned: [], hidden: [], hiddenAdapters: [] };
  constructor(public readonly file: string) {}
  async load() {
    try {
      const stored: unknown = JSON.parse(await fs.readFile(this.file, 'utf8'));
      const next = clean(stored);
      // Unversioned files used separate desktop and CLI switches. Keep the merged
      // provider visible if either old source was visible. Do not repeat this rule
      // for saved unified settings or reinterpret an unknown layout marker.
      if (isRecord(stored) && stored.adapterLayout === undefined) {
        const hidden = new Set(next.hiddenAdapters);
        next.hiddenAdapters = next.hiddenAdapters.filter(id => id !== 'codex' && id !== 'codex-cli');
        if (hidden.has('codex') && hidden.has('codex-cli')) next.hiddenAdapters.push('codex');
        const sessionKey = (key: string) => key.startsWith('codex-cli:') ? `codex:${key.slice('codex-cli:'.length)}` : key;
        next.pinned = [...new Set(next.pinned.map(sessionKey))];
        next.hidden = [...new Set(next.hidden.map(sessionKey))];
      }
      this.value = next;
    }
    catch (error) { if (!hasErrorCode(error, 'ENOENT') && !(error instanceof SyntaxError)) throw error; }
    return this.value;
  }
  async save(value: PanelPreferences) {
    const next = clean(value);
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    await fs.writeFile(`${this.file}.tmp`, JSON.stringify({ ...next, adapterLayout: 'providers' }, null, 2));
    await fs.rename(`${this.file}.tmp`, this.file);
    this.value = next;
    return this.value;
  }
}
export { Preferences, SORT_ORDERS };
