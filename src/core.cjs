const STATES = Object.freeze({
  idle: { label: 'Idle', color: '#8cce6b', symbol: '✓' },
  waiting: { label: 'Needs you', color: '#ffd45e', symbol: '?' },
  working: { label: 'Working', color: '#f5f5ef', symbol: '·' },
  error: { label: 'Failed', color: '#ff807c', symbol: '!' },
  unknown: { label: 'Unknown', color: '#8a9099', symbol: '–' }
});

// Each adapter supplies { id, name, read(): Promise<{ sessions, health }> }.
// A session has a provider-local id, title, state, detail, and updatedAt.
class SessionMonitor {
  constructor(adapters) { this.adapters = adapters; }
  async read() {
    const sources = await Promise.all(this.adapters.map(async adapter => {
      try { return { id: adapter.id, name: adapter.name, ...await adapter.read() }; }
      catch { return { id: adapter.id, name: adapter.name, sessions: [], health: 'Cannot read session data.' }; }
    }));
    return {
      sources: sources.map(({ sessions, ...source }) => source),
      sessions: sources.flatMap(source => source.sessions.map(session => ({
        ...session, provider: source.name, key: `${source.id}:${session.id}`,
        state: STATES[session.state] ? session.state : 'unknown'
      })))
    };
  }
}

const DAY = 86_400_000;
function visibleSessions(sessions, preferences, now = Date.now()) {
  const pinned = new Set(preferences.pinned || []);
  const order = { waiting: 0, error: 1, working: 2, idle: 3, unknown: 4 };
  return sessions.filter(s => preferences.showAll || pinned.has(s.key) || s.updatedAt >= now - DAY)
    .sort((a, b) => Number(pinned.has(b.key)) - Number(pinned.has(a.key)) ||
      order[a.state] - order[b.state] || b.updatedAt - a.updatedAt || a.key.localeCompare(b.key));
}

function resolveState({ status, updatedAt, waiting, lastUserAt = 0, lastProgressAt = 0 }, now) {
  if (status === 'failed') return { state: 'error', detail: 'The last turn failed.' };
  if (status === 'completed') return { state: 'idle', detail: 'The last turn finished.' };
  if (status === 'interrupted') return { state: 'idle', detail: 'The last turn stopped.' };
  if (waiting && waiting.at > lastUserAt && waiting.at > lastProgressAt && now - waiting.at < DAY) {
    return { state: 'waiting', detail: waiting.kind === 'approval' ? 'Codex requested approval.' : 'Codex has a question.' };
  }
  if (status === 'inProgress' && now - updatedAt < 15 * 60_000) {
    return { state: 'working', detail: 'The last recorded turn is in progress.' };
  }
  if (status === 'inProgress') return { state: 'unknown', detail: 'No recent activity. The turn may still be running.' };
  return { state: 'unknown', detail: 'No supported turn state was found.' };
}

module.exports = { STATES, SessionMonitor, visibleSessions, resolveState };
