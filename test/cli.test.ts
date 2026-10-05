import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fixture, rolloutLine } from './fixtures.js';
import { required } from './assertions.js';
import { CodexCliAdapter } from '../src/adapters/codex-cli.js';
import { CodexDesktopAdapter } from '../src/adapters/codex-desktop.js';
import { SessionMonitor, visibleSessions } from '../src/core.js';
import { Preferences } from '../src/preferences.js';
import { createAdapters } from '../src/adapters/index.js';

const cliId = '33333333-3333-4333-8333-333333333333';
async function setup() {
  const base = path.join(__dirname, '..', '.test-data'); await fs.mkdir(base, { recursive: true });
  const dir = await fs.mkdtemp(path.join(base, 'cli-'));
  const data = await fixture(dir);
  const workspace = path.join(dir, "project's folder & safe"); await fs.mkdir(workspace);
  const db = new DatabaseSync(path.join(data.root, 'state_5.sqlite'));
  db.prepare('INSERT INTO threads VALUES (?, ?, NULL, ?, ?, NULL, ?, ?, 0)').run(cliId, 'CLI task', workspace, 'cli', path.join(data.root, `${cliId}.jsonl`), Math.floor(data.now / 1000));
  db.close();
  await rolloutLine(data, cliId, data.now - 1000, 'event_msg', { type: 'task_started', turn_id: 'cli-turn' });
  const cli = new CodexCliAdapter({ root: data.root, now: () => data.now });
  const monitor = new SessionMonitor([new CodexDesktopAdapter({ ...data, now: () => data.now }), cli]);
  return { data, dir, workspace, cli, monitor };
}

// Catch CLI sessions missing from the panel or appearing in both adapters.
test('CLI and desktop sessions have separate keys and saved adapter switches', async () => {
  const { data, dir, monitor } = await setup();
  let snapshot = await monitor.read();
  const session = required(snapshot.sessions.find(s => s.id === cliId));
  assert.equal(session.providerId, 'codex-cli'); assert.equal(session.state, 'working');
  assert.equal(snapshot.sessions.filter(s => s.id === cliId).length, 1);
  assert.equal(required(snapshot.sessions.find(s => s.id === data.ids[0])).key, `codex:${data.ids[0]}`);
  const prefs = new Preferences(path.join(dir, 'preferences.json')); await prefs.load();
  await prefs.save({ ...prefs.value, pinned: [session.key], hiddenAdapters: ['codex-cli'] });
  const restarted = new Preferences(prefs.file); await restarted.load();
  assert.ok(visibleSessions(snapshot.sessions, restarted.value).every(s => s.providerId !== 'codex-cli'));
  await rolloutLine(data, cliId, data.now + 1000, 'event_msg', { type: 'task_complete', turn_id: 'cli-turn' });
  snapshot = await monitor.read();
  assert.equal(required(snapshot.sessions.find(s => s.id === cliId)).state, 'idle');
  await restarted.save({ ...restarted.value, hiddenAdapters: [] });
  assert.ok(visibleSessions(snapshot.sessions, restarted.value).some(s => s.key === session.key));
  assert.ok(restarted.value.pinned.includes(session.key));
  assert.ok(snapshot.sessions.every(s => !['helper', 'archived'].includes(s.id)));
});

// Catch a waiting light cleared by unrelated tools, or stuck after the reply.
test('CLI questions and permissions clear only when their own requests resolve', async () => {
  const { data, monitor } = await setup();
  const state = async () => required((await monitor.read()).sessions.find(s => s.id === cliId)).state;
  await rolloutLine(data, cliId, data.now, 'response_item', { type: 'function_call', name: 'request_user_input', call_id: 'question' });
  assert.equal(await state(), 'waiting');
  await rolloutLine(data, cliId, data.now + 1, 'response_item', { type: 'function_call_output', call_id: 'background' });
  assert.equal(await state(), 'waiting');
  await fs.appendFile(path.join(data.root, `${cliId}.jsonl`), '{"timestamp":');
  assert.equal(await state(), 'waiting');
  await fs.appendFile(path.join(data.root, `${cliId}.jsonl`), '\n');
  await rolloutLine(data, cliId, data.now + 2, 'response_item', { type: 'function_call_output', call_id: 'question' });
  assert.equal(await state(), 'working');
  await rolloutLine(data, cliId, data.now + 3, 'response_item', { type: 'function_call', name: 'request_permissions', call_id: 'permission' });
  assert.equal(await state(), 'waiting');
  await rolloutLine(data, cliId, data.now + 4, 'response_item', { type: 'custom_tool_call_output', call_id: 'permission' });
  assert.equal(await state(), 'working');
  await rolloutLine(data, cliId, data.now + 5, 'response_item', { type: 'function_call', name: 'request_user_input', call_id: 'second-question' });
  await rolloutLine(data, cliId, data.now + 6, 'event_msg', { type: 'turn_aborted', turn_id: 'cli-turn' });
  assert.equal(await state(), 'idle');
});

// Catch real CLI task_complete errors shown as idle or unknown, and lost sessions on missing history.
test('CLI failures, stale turns, and missing rollouts produce honest states', async () => {
  const { data, monitor, cli } = await setup();
  await rolloutLine(data, cliId, data.now, 'event_msg', { type: 'task_complete', turn_id: 'cli-turn', error: { message: 'Unsupported model' } });
  assert.equal(required((await monitor.read()).sessions.find(s => s.id === cliId)).state, 'error');
  const history = new DatabaseSync(path.join(data.root, 'thread_history_1.sqlite'));
  history.exec('ALTER TABLE thread_turns RENAME TO unavailable_turns'); history.close();
  assert.equal(required((await cli.read()).sessions.find(s => s.id === cliId)).state, 'error');
  await rolloutLine(data, cliId, data.now + 1, 'event_msg', { type: 'task_started', turn_id: 'new-turn' });
  const stale = new CodexCliAdapter({ root: data.root, now: () => data.now + 16 * 60_000 });
  assert.equal(required((await stale.read()).sessions.find(s => s.id === cliId)).state, 'unknown');
  await fs.rename(path.join(data.root, `${cliId}.jsonl`), path.join(data.root, 'saved-rollout.jsonl'));
  assert.equal(required((await cli.read()).sessions.find(s => s.id === cliId)).state, 'unknown');
  await assert.rejects(cli.open('bad; command'), /Invalid Codex CLI session ID/);
  await assert.rejects(cli.open(data.ids[0]), /no longer available/);
});

// Catch duplicate account limits and opening a CLI record through a desktop link.
test('registered CLI sessions use no second usage process and reject missing workspaces', async () => {
  const { data, dir, workspace, cli } = await setup();
  const monitor = new SessionMonitor(await createAdapters({ testDir: dir }));
  const snapshot = await monitor.read();
  assert.ok(snapshot.sessions.some(s => s.key === `codex-cli:${cliId}`));
  assert.equal(monitor.usageSnapshot().filter(p => p.providerId.startsWith('codex')).length, 1);
  await fs.rename(workspace, `${workspace}-moved`);
  await assert.rejects(cli.open(cliId), /workspace is unavailable/);
  const missing = new CodexCliAdapter({ root: path.join(dir, 'absent') });
  assert.deepEqual((await missing.read()).sessions, []);
  assert.match((await missing.read()).health, /Start a local Codex CLI session/);
  assert.ok(snapshot.sessions.every(s => s.id !== 'archived' && s.id !== 'helper'));
  assert.ok(snapshot.sessions.some(s => s.id === data.ids[0]));
});

// Catch cached turn states that survive an append, same-size rewrite, or missing file.
test('cached CLI records refresh after file changes and recover after a missing rollout', async () => {
  const { data, cli } = await setup();
  const file = path.join(data.root, cliId + '.jsonl');
  const stamp = new Date(Math.floor(data.now / 1000) * 1000);
  const state = async () => required((await cli.read()).sessions.find(session => session.id === cliId)).state;
  await fs.utimes(file, stamp, stamp);
  assert.equal(await state(), 'working');
  await rolloutLine(data, cliId, data.now, 'response_item', { type: 'function_call', name: 'request_user_input', call_id: 'question' });
  // An append can share the previous modification time on a coarse filesystem.
  await fs.utimes(file, stamp, stamp);
  assert.equal(await state(), 'waiting');
  const text = await fs.readFile(file, 'utf8');
  await fs.writeFile(file, text.replace('request_user_input', 'ignored_user_input'));
  await fs.utimes(file, stamp, new Date(stamp.getTime() + 1000));
  assert.equal(await state(), 'working');
  const saved = path.join(data.root, 'saved-cache-rollout.jsonl');
  await fs.rename(file, saved);
  assert.equal(await state(), 'unknown');
  await fs.rename(saved, file);
  assert.equal(await state(), 'working');
});
