import * as path from 'node:path';
import { STATES } from './shared/contracts.js';
import type { AdapterSession, SessionAdapter, SessionReading, Session, PanelPreferences, MonitorSnapshot, ProviderUsage, OpenExternal, SessionState } from './shared/contracts.js';
import { parseUsageWindows } from './shared/readings.js';

export interface TurnSignal { waiting?: { at: number; kind: 'approval' | 'question' }; lastUserAt: number; lastProgressAt: number }
export interface RecordedTurn { status: string | undefined; updatedAt: number; lastUserAt: number; lastProgressAt: number }
// Each adapter supplies id, name, and read(). Usage and opening are optional.
// A session has a provider-local id, title, state, detail, and updatedAt.
function projectInfo(session: AdapterSession, providerId: string) {
  const workspace = typeof session.workspace === 'string' ? session.workspace.trim() : '';
  const root = typeof session.projectRoot === 'string' ? session.projectRoot.trim() : '';
  const label = typeof session.project === 'string' ? session.project.trim() : '';
  const id = typeof session.projectId === 'string' ? session.projectId.trim() : '';
  const project = label || path.posix.basename((root || workspace).replaceAll('\\', '/').replace(/\/+$/, '')) || root || workspace || id || 'No workspace';
  let projectKey;
  if (id) projectKey = JSON.stringify(['id', id]);
  else if (root || workspace) {
    const grouped = root || workspace;
    const windowsPath = /^[a-z]:[\\/]|^[\\/]{2}/i.test(grouped);
    const normalized = (windowsPath ? path.win32.normalize(grouped).replaceAll('\\', '/').toLowerCase() : path.posix.normalize(grouped)).replace(/\/+$/, '') || '/';
    projectKey = JSON.stringify(['workspace', normalized]);
  } else projectKey = label ? JSON.stringify(['label', providerId, label]) : 'none';
  return { project, workspace, projectKey };
}
class SessionMonitor {
  private readonly failures = new Map<string, number>();
  constructor(public readonly adapters: SessionAdapter[]) {}
  async read(): Promise<MonitorSnapshot> {
    const sources = await Promise.all(this.adapters.map(async adapter => {
      let reading: SessionReading;
      try { reading = await adapter.read(); }
      catch { reading = { sessions: [], health: 'Cannot read session data.', problem: 'Cannot read its session data.' }; }
      // A provider can lock its records for one read. Tell the user only when the failure repeats.
      const failures = reading.problem ? (this.failures.get(adapter.id) ?? 0) + 1 : 0;
      this.failures.set(adapter.id, failures);
      const { problem, ...rest } = reading;
      return { id: adapter.id, name: adapter.name, ...rest, ...(problem && failures >= 2 ? { problem } : {}) };
    }));
    const sessions = sources.flatMap(source => source.sessions.map(session => ({
      ...session, ...projectInfo(session, source.id), provider: source.name, providerId: source.id, key: `${source.id}:${session.id}`,
      state: STATES[session.state] ? session.state : 'unknown'
    })));
    // Providers can use different labels for the same project. Sort each group by one shared label.
    const groups = new Map<string, string>();
    for (const session of sessions) {
      const previous = groups.get(session.projectKey);
      if (!previous || session.project.localeCompare(previous) < 0) groups.set(session.projectKey, session.project);
    }
    return {
      sources: sources.map(({ sessions, ...source }) => source),
      sessions: sessions.map(session => ({ ...session, projectGroup: groups.get(session.projectKey) ?? session.project }))
    };
  }
  usageSnapshot(): ProviderUsage[] {
    return this.adapters.filter(adapter => typeof adapter.readUsage === 'function').map(adapter => ({
      providerId: adapter.id, provider: adapter.name, windows: [], message: 'Reading usage limits.', updatedAt: null,
      ...adapter.usage
    }));
  }
  async readUsage(): Promise<ProviderUsage[]> {
    return Promise.all(this.adapters.filter(adapter => typeof adapter.readUsage === 'function').map(async adapter => {
      let value;
      try {
        value = await adapter.readUsage?.();
        if (!value) throw Error('Unsupported usage reading.');
        value = { ...value, windows: parseUsageWindows(value.windows) };
      }
      catch { value = { windows: [], message: 'Cannot read usage limits.', updatedAt: null }; }
      const readings = new Map((value.windows || []).map(window => [window.id, window]));
      const windows = (adapter.usage?.windows || []).map(window => {
        const reading = readings.get(window.id); readings.delete(window.id);
        return { ...window, ...reading };
      });
      return { ...adapter.usage, ...value, providerId: adapter.id, provider: adapter.name,
        windows: [...windows, ...readings.values()] };
    }));
  }
  async open(session: Session, openExternal: OpenExternal) {
    const adapter = this.adapters.find(adapter => adapter.id === session.providerId);
    if (typeof adapter?.open === 'function') await adapter.open(session.id, openExternal);
    else throw Error(`Opening chats is unavailable for ${session.provider}.`);
  }
  close() { for (const adapter of this.adapters) adapter.close?.(); }
}

const DAY = 86_400_000;
// Show pinned sessions and sessions with activity in the last day. Pins come first.
// In each group, sessions that need the user come before the others.
function visibleSessions(sessions: Session[], preferences: PanelPreferences, now = Date.now()) {
  const pinned = new Set(preferences.pinned || []);
  const hidden = new Set(preferences.hidden);
  const activity = (a: Session, b: Session) => (Number.isFinite(b.updatedAt) ? b.updatedAt : 0) - (Number.isFinite(a.updatedAt) ? a.updatedAt : 0);
  const attention = (session: Session) => Number(session.state === 'waiting' || session.state === 'error');
  return sessions.filter(s => !hidden.has(s.key) && !preferences.hiddenAdapters.includes(s.providerId) && (pinned.has(s.key) || s.updatedAt >= now - DAY)).sort((a, b) => {
    const pins = Number(pinned.has(b.key)) - Number(pinned.has(a.key));
    if (pins) return pins;
    if (!pinned.has(a.key) && preferences.sortOrder === 'project' && a.projectKey !== b.projectKey) {
      return Number(a.projectKey === 'none') - Number(b.projectKey === 'none') ||
        a.projectGroup.localeCompare(b.projectGroup, undefined, { sensitivity: 'base' }) || a.projectKey.localeCompare(b.projectKey);
    }
    return attention(b) - attention(a) || activity(a, b) || a.key.localeCompare(b.key);
  });
}

function resolveState({ status, updatedAt, waiting, lastUserAt = 0, lastProgressAt = 0 }: Omit<RecordedTurn, 'lastUserAt' | 'lastProgressAt'> & Partial<TurnSignal>, now: number): { state: SessionState; detail: string } {
  if (status === 'failed') return { state: 'error', detail: '' };
  if (status === 'completed') return { state: 'idle', detail: '' };
  if (status === 'interrupted') return { state: 'idle', detail: 'The last turn stopped.' };
  if (waiting && waiting.at > lastUserAt && waiting.at > lastProgressAt && now - waiting.at < DAY) {
    return { state: 'waiting', detail: waiting.kind === 'approval' ? 'Approval needed' : 'Answer needed' };
  }
  if (status === 'inProgress' && now - updatedAt < 15 * 60_000) {
    return { state: 'working', detail: '' };
  }
  if (status === 'inProgress') return { state: 'unknown', detail: 'No recent activity' };
  return { state: 'unknown', detail: 'No supported turn state was found.' };
}

export { STATES, SessionMonitor, visibleSessions, resolveState };
