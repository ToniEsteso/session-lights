import { epochMilliseconds, unixSeconds } from './time.js';
import type { AdapterSession, UsageWindow } from './contracts.js';
import { STATES } from './contracts.js';
import { isRecord } from './validation.js';

export function parseUsageWindows(value: unknown): UsageWindow[] {
  if (!Array.isArray(value)) throw Error('Unsupported usage reading.');
  return value.map((entry: unknown) => {
    if (!isRecord(entry) || typeof entry.id !== 'string' || !entry.id) throw Error('Unsupported usage window.');
    const window: UsageWindow = { id: entry.id };
    if (typeof entry.label === 'string') window.label = entry.label;
    if (typeof entry.title === 'string') window.title = entry.title;
    if (typeof entry.remainingPercent === 'number' && Number.isFinite(entry.remainingPercent) &&
        entry.remainingPercent >= 0 && entry.remainingPercent <= 100) window.remainingPercent = entry.remainingPercent;
    if (entry.resetsAt !== undefined && entry.resetsAt !== null) {
      if (typeof entry.resetsAt !== 'number' || !Number.isFinite(entry.resetsAt) || entry.resetsAt <= 0) {
        throw Error('Unsupported usage reset time.');
      }
      window.resetsAt = unixSeconds(entry.resetsAt);
    }
    return window;
  });
}
export function parseSessions(value: unknown): AdapterSession[] {
  if (!Array.isArray(value)) throw Error('Unsupported session reading.');
  return value.map((entry: unknown) => {
    if (!isRecord(entry) || typeof entry.id !== 'string' || typeof entry.title !== 'string') {
      throw Error('Unsupported session record.');
    }
    const state = entry.state;
    const session: AdapterSession = {
      id: entry.id, title: entry.title,
      state: state === 'idle' || state === 'working' || state === 'waiting' || state === 'error' || state === 'unknown' ? state : 'unknown',
      detail: typeof entry.detail === 'string' ? entry.detail : STATES.unknown.label,
      updatedAt: typeof entry.updatedAt === 'number' && Number.isFinite(entry.updatedAt) && entry.updatedAt >= 0 ? epochMilliseconds(entry.updatedAt) : epochMilliseconds(0)
    };
    if (typeof entry.project === 'string') session.project = entry.project;
    if (typeof entry.workspace === 'string') session.workspace = entry.workspace;
    if (typeof entry.projectId === 'string') session.projectId = entry.projectId;
    return session;
  });
}
