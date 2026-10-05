const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { fixture, setStatus, logLine, rolloutLine } = require('./fixtures.cjs');
const { CodexDesktopAdapter } = require('../src/adapters/codex-desktop.cjs');
const { SessionMonitor, visibleSessions } = require('../src/core.cjs');
const { Preferences } = require('../src/preferences.cjs');

async function setup() {
  const base = path.join(__dirname, '..', '.test-data'); await fs.mkdir(base, { recursive: true });
  const dir = await fs.mkdtemp(path.join(base, 'monitor-'));
  const data = await fixture(dir);
  let clock = data.now;
  const monitor = new SessionMonitor([new CodexDesktopAdapter({ ...data, now: () => clock })]);
  return { data, dir, monitor, later: ms => { clock = data.now + ms; } };
}

test('live desktop turn changes from working to failed to idle; other session types stay out', async () => {
  const { data, monitor } = await setup();
  let result = await monitor.read();
  assert.equal(result.sessions.length, 2);
  assert.equal(result.sessions.find(s => s.id === data.ids[0]).state, 'working');
  assert.equal(result.sessions.find(s => s.id === data.ids[1]).state, 'idle');
  setStatus(data, data.ids[0], 'failed');
  assert.equal((await monitor.read()).sessions.find(s => s.id === data.ids[0]).state, 'error');
  setStatus(data, data.ids[0], 'completed');
  assert.equal((await monitor.read()).sessions.find(s => s.id === data.ids[0]).state, 'idle');
});

test('an approval turns yellow and tool output clears it; partial live records do not break the monitor', async () => {
  const { data, monitor } = await setup();
  await logLine(data, data.now - 1, `Reasoning summary item completed summary="[desktop-notifications] show notification conversationId=${data.ids[0]} kind=approval"`);
  assert.equal((await monitor.read()).sessions.find(s => s.id === data.ids[0]).state, 'working');
  await logLine(data, data.now, `[desktop-notifications] show notification conversationId=${data.ids[0]} kind=approval`);
  assert.equal((await monitor.read()).sessions.find(s => s.id === data.ids[0]).state, 'waiting');
  await rolloutLine(data, data.ids[0], data.now + 1000, 'response_item', { type: 'function_call_output', call_id: 'call-1' });
  await fs.appendFile(path.join(data.root, `${data.ids[0]}.jsonl`), '{"timestamp":');
  assert.equal((await monitor.read()).sessions.find(s => s.id === data.ids[0]).state, 'working');
  await fs.appendFile(path.join(data.root, `${data.ids[1]}.jsonl`), 'null\n42\n[]\n');
  assert.equal((await monitor.read()).sessions.find(s => s.id === data.ids[1]).state, 'idle');
});

test('async question stays yellow during background work, then clears when the user replies', async () => {
  const { data, monitor } = await setup();
  await logLine(data, data.now, `[desktop-notifications] show notification conversationId=${data.ids[0]} kind=question`);
  await rolloutLine(data, data.ids[0], data.now + 1000, 'response_item', { type: 'function_call_output', call_id: 'background' });
  assert.equal((await monitor.read()).sessions.find(s => s.id === data.ids[0]).state, 'waiting');
  await logLine(data, data.now + 2000, `[AppServerConnection] response_routed conversationId=${data.ids[0]} errorCode=null method=turn/steer`);
  assert.equal((await monitor.read()).sessions.find(s => s.id === data.ids[0]).state, 'working');
});

test('old running turns and missing rollouts become unknown; a missing provider reports a useful message', async () => {
  const { data, monitor, later, dir } = await setup();
  later(16 * 60_000);
  assert.equal((await monitor.read()).sessions.find(s => s.id === data.ids[0]).state, 'unknown');
  const missing = new SessionMonitor([new CodexDesktopAdapter({ root: path.join(dir, 'missing') })]);
  assert.equal((await missing.read()).sessions.length, 0);
  assert.match((await missing.read()).sources[0].health, /No Codex session database/);
  const combined = new SessionMonitor([new CodexDesktopAdapter({ ...data, now: () => data.now }), new CodexDesktopAdapter({ root: path.join(dir, 'missing') })]);
  assert.equal((await combined.read()).sessions.length, 2);
  // Change only the fixture database to refer to a missing file.
  const { DatabaseSync } = require('node:sqlite'); const db = new DatabaseSync(path.join(data.root, 'state_5.sqlite'));
  db.prepare('UPDATE threads SET rollout_path = ? WHERE id = ?').run(path.join(dir, 'missing.jsonl'), data.ids[1]); db.close();
  assert.equal((await monitor.read()).sessions.find(s => s.id === data.ids[1]).state, 'unknown');
});

test('a legacy Codex rollout still reports completion without a history database', async () => {
  const { data, monitor } = await setup();
  // Rename this task-owned fixture, without deleting user data.
  await fs.rename(path.join(data.root, 'thread_history_1.sqlite'), path.join(data.root, 'history-backup.sqlite'));
  await rolloutLine(data, data.ids[0], data.now, 'event_msg', { type: 'task_complete' });
  assert.equal((await monitor.read()).sessions.find(s => s.id === data.ids[0]).state, 'idle');
});

test('an unsupported history database does not hide readable desktop chats', async () => {
  const { data, monitor } = await setup();
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(path.join(data.root, 'thread_history_1.sqlite'));
  db.exec('ALTER TABLE thread_turns RENAME TO prior_thread_turns'); db.close();
  await rolloutLine(data, data.ids[1], data.now, 'event_msg', { type: 'task_complete' });
  const result = await monitor.read();
  assert.equal(result.sessions.length, 2);
  assert.equal(result.sessions.find(session => session.id === data.ids[1]).state, 'idle');
  assert.match(result.sources[0].health, /history.*unavailable/i);
});

test('Codex uses saved project names from thread IDs or the closest saved workspace root', async () => {
  const { data, monitor } = await setup();
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(path.join(data.root, 'state_5.sqlite'));
  db.exec('ALTER TABLE threads ADD COLUMN project_id TEXT; CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT); CREATE TABLE project_roots (project_id TEXT, position INTEGER, path TEXT);');
  db.prepare('INSERT INTO projects VALUES (?, ?)').run('parent', 'Workspaces');
  db.prepare('INSERT INTO projects VALUES (?, ?)').run('child', 'Vault');
  db.prepare('INSERT INTO project_roots VALUES (?, ?, ?)').run('parent', 0, String.raw`\\?\C:\work`);
  db.prepare('INSERT INTO project_roots VALUES (?, ?, ?)').run('child', 0, String.raw`\\?\C:\work\project`);
  db.prepare('UPDATE threads SET project_id = ? WHERE id = ?').run('parent', data.ids[1]);
  db.close();
  monitor.adapters.push({ id: 'atlas', name: 'Atlas', async read() { return { sessions: [
    { id: 'atlas-chat', title: 'Atlas folder chat', project: 'Atlas project', workspace: 'C:/work/project', state: 'idle' }
  ] }; } });

  const sessions = (await monitor.read()).sessions;
  const workspaceChat = sessions.find(session => session.id === data.ids[0]);
  assert.equal(workspaceChat.project, 'Vault');
  assert.equal(workspaceChat.projectGroup, sessions.find(session => session.provider === 'Atlas').projectGroup);
  assert.equal(sessions.find(session => session.id === data.ids[1]).project, 'Workspaces');
});

test('shared project IDs join providers while provider-local IDs stay separate', async () => {
  const makeAdapter = (id, name, projectId) => ({
    id, name,
    async read() { return { sessions: [{ id: 'chat', title: `${name} chat`, project: `${name} project`, projectId, state: 'idle' }] }; }
  });
  const shared = (await new SessionMonitor([
    makeAdapter('codex', 'Codex', 'shared-project'), makeAdapter('atlas', 'Atlas', 'shared-project')
  ]).read()).sessions;
  assert.equal(shared.find(session => session.provider === 'Codex').projectGroup, 'Atlas project');
  assert.equal(shared.find(session => session.provider === 'Atlas').projectGroup, 'Atlas project');
  const separate = (await new SessionMonitor([
    makeAdapter('codex', 'Codex', 'codex:local-project'), makeAdapter('atlas', 'Atlas', 'atlas:local-project')
  ]).read()).sessions;
  assert.notEqual(separate.find(session => session.provider === 'Codex').projectGroup,
    separate.find(session => session.provider === 'Atlas').projectGroup);
});

test('pinned old sessions stay visible after preferences are saved and the app restarts', async () => {
  const { dir, monitor, data } = await setup();
  const sessions = (await monitor.read()).sessions;
  const key = sessions.find(s => s.id === data.ids[1]).key;
  const file = path.join(dir, 'preferences.json');
  const prefs = new Preferences(file); await prefs.load();
  await prefs.save({ ...prefs.value, pinned: [key], expanded: true, showAll: false });
  const reopened = new Preferences(file); await reopened.load();
  const visible = visibleSessions(sessions, reopened.value, data.now + 2 * 86_400_000);
  assert.equal(visible.length, 1); assert.equal(visible[0].id, data.ids[1]);
  assert.equal(visibleSessions(sessions, { ...reopened.value, showAll: true }, data.now + 2 * 86_400_000).length, 2);
  // A damaged settings file must not prevent the panel from starting.
  await fs.writeFile(file, 'null');
  const recovered = new Preferences(file); await recovered.load();
  assert.equal(visibleSessions(sessions, recovered.value, data.now + 2 * 86_400_000).length, 2);
});
