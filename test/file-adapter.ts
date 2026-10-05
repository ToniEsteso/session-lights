import { epochMilliseconds } from '../src/shared/time.js';
import type { SessionAdapter, SessionReading, UsageDefinition, UsageReading } from '../src/shared/contracts.js';
import { isRecord, hasErrorCode } from '../src/shared/validation.js';
import { parseSessions, parseUsageWindows } from '../src/shared/readings.js';
import * as fs from 'node:fs/promises';
// A second provider driven by task-owned files, without a service or account.
class FileAdapter implements SessionAdapter {
  readonly id = 'atlas';
  readonly name = 'Atlas';
  readonly usage: UsageDefinition;
  constructor(private readonly file: string) {
    this.usage = { scope: 'Workspace usage', windows: [] };
  }
  async data() {
    try { const value: unknown = JSON.parse(await fs.readFile(this.file, 'utf8')); return isRecord(value) ? value : {}; }
    catch (error) { if (hasErrorCode(error, 'ENOENT')) return {}; throw error; }
  }
  async read(): Promise<SessionReading> { const data = await this.data(); return { sessions: parseSessions(data.sessions ?? []), health: 'Reading test provider.' }; }
  async readUsage(): Promise<UsageReading> {
    const data = await this.data();
    if (data.failUsage) throw Error('Offline');
    return { windows: parseUsageWindows(data.windows ?? []), updatedAt: epochMilliseconds(Date.now()) };
  }
  async open(id: string) { await fs.writeFile(`${this.file}.opened`, id); }
}
export { FileAdapter };
