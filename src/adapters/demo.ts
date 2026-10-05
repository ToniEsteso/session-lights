import { epochMilliseconds, unixSeconds } from '../shared/time.js';
import type { SessionAdapter, SessionReading, UsageDefinition, UsageReading } from '../shared/contracts.js';
class DemoAdapter implements SessionAdapter {
  private readonly startedAt = Date.now();
  readonly id = 'demo';
  readonly name = 'Preview';
  readonly usage: UsageDefinition;
  constructor() {
    this.usage = { scope: 'Sample usage', windows: [
      { id: 'short', label: '5h', title: '5-hour limit' }, { id: 'long', label: 'Weekly', title: 'Weekly limit' }
    ] };
  }
  async read(): Promise<SessionReading> {
    return { health: 'Preview data.', sessions: ([
      { id: '1', title: 'Fix the sign-in form', project: 'website', state: 'waiting', detail: 'Approval requested.' },
      { id: '2', title: 'Build the API', project: 'service', state: 'working', detail: 'The turn is in progress.' },
      { id: '3', title: 'Review the tests', project: 'tools', state: 'idle', detail: 'The last turn finished.' },
      { id: '4', title: 'Update the app', project: 'desktop', state: 'error', detail: 'The last turn failed.' },
      { id: '5', title: 'Check a long task', project: 'research', state: 'unknown', detail: 'No recent activity.' }
    ] satisfies Omit<SessionReading['sessions'][number], 'updatedAt'>[]).map((session, index) => ({
      ...session, updatedAt: epochMilliseconds(this.startedAt - index * 180_000)
    })) };
  }
  async readUsage(): Promise<UsageReading> {
    return { windows: [
      { id: 'short', remainingPercent: 65, resetsAt: unixSeconds(Math.floor(Date.now() / 1000) + 7200) },
      { id: 'long', remainingPercent: 83, resetsAt: unixSeconds(Math.floor(Date.now() / 1000) + 345600) }
    ], message: 'Preview data.', updatedAt: epochMilliseconds(Date.now()) };
  }
}
export { DemoAdapter };
