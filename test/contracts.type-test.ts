import { epochMilliseconds } from '../src/shared/time.js';
import type { PanelAction, SessionAdapter, SessionLightsBridge, SessionReading, UsageReading } from '../src/shared/contracts.js';

// The compiler checks these negative cases. This function is never executed.
export function checkContracts(bridge: SessionLightsBridge): void {
  bridge.action({ type: 'sort', order: 'project' });
  // @ts-expect-error Sorting supports only the declared domain values.
  bridge.action({ type: 'sort', order: 'title' });
  // @ts-expect-error Opening a chat requires a session key.
  const missingKey: PanelAction = { type: 'open' };
  // @ts-expect-error Session activity is a numeric time, not formatted text.
  const invalidSession: SessionReading = { health: 'Ready', sessions: [{ id: 'chat', title: 'Chat', state: 'idle', detail: '', updatedAt: 'today' }] };
  // @ts-expect-error Providers must implement session reading.
  const invalidAdapter: SessionAdapter = { id: 'atlas', name: 'Atlas' };
  // @ts-expect-error A usage reading must include its reading time or null.
  const missingTime: UsageReading = { windows: [] };
  // @ts-expect-error A millisecond timestamp cannot be used as a reset time in seconds.
  const invalidUnits: UsageReading = { windows: [{ id: 'daily', resetsAt: epochMilliseconds(Date.now()) }], updatedAt: null };
  void [invalidUnits, missingKey, invalidSession, invalidAdapter, missingTime];
}
