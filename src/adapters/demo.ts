import { epochMilliseconds, unixSeconds } from '../shared/time.js';
import type { SessionAdapter, SessionReading, UsageDefinition, UsageReading } from '../shared/contracts.js';
class DemoAdapter implements SessionAdapter {
  private readonly startedAt = Date.now();
  readonly id = 'demo';
  readonly name = 'Codex';
  readonly usage: UsageDefinition;
  constructor() {
    this.usage = { scope: 'Sample usage', windows: [
      { id: 'short', label: '5h', title: '5-hour limit' }, { id: 'long', label: 'Weekly', title: 'Weekly limit' }
    ] };
  }
  async read(): Promise<SessionReading> {
    return { health: 'Sample data.', sessions: ([
      { id: '1', title: 'Fix the sign-in form', project: 'website', source: 'Desktop', model: 'gpt-6.1-sol', state: 'waiting', detail: 'Approval needed' },
      { id: '2', title: 'Build the API', project: 'service', source: 'CLI', model: 'gpt-6.1-sol', state: 'working', detail: '' },
      { id: '3', title: 'Review the tests', project: 'tools', source: 'Desktop', model: 'gpt-6-astra', state: 'idle', detail: '' },
      { id: '4', title: 'Update the app', project: 'desktop', source: 'CLI', model: 'gpt-6.1-sol', state: 'error', detail: '' },
      { id: '5', title: 'Check a long task', project: 'research', source: 'Desktop', state: 'unknown', detail: 'No recent activity' }
    ] satisfies Omit<SessionReading['sessions'][number], 'updatedAt'>[]).map((session, index) => ({
      ...session, updatedAt: epochMilliseconds(this.startedAt - index * 180_000),
      ...(session.state === 'working' ? { startedAt: epochMilliseconds(this.startedAt - 1_380_000) } : {})
    })) };
  }
  async readUsage(): Promise<UsageReading> {
    return { windows: [
      { id: 'short', remainingPercent: 65, resetsAt: unixSeconds(Math.floor(Date.now() / 1000) + 7200) },
      { id: 'long', remainingPercent: 83, resetsAt: unixSeconds(Math.floor(Date.now() / 1000) + 345600) }
    ], message: 'Sample data.', updatedAt: epochMilliseconds(Date.now()) };
  }
}
export { DemoAdapter };
