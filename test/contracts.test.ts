import { epochMilliseconds } from '../src/shared/time.js';
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { parseAction, parseTooltipTarget } from '../src/shared/validation.js';
import { parseSessions, parseUsageWindows } from '../src/shared/readings.js';
import { clean } from '../src/preferences.js';
import { windowsFrom } from '../src/adapters/codex-usage.js';
import { SessionMonitor } from '../src/core.js';
import type { SessionAdapter } from '../src/shared/contracts.js';
import { required } from './assertions.js';

test('IPC rejects invalid commands, coordinates, and tooltip targets', () => {
  for (const value of [null, [], 'quit', { type: 'sort', order: 'title' },
    { type: 'pin', key: 3 }, { type: 'move', phase: 'drag', screenY: 42 },
    { type: 'move', phase: 'start', screenY: Infinity }]) assert.equal(parseAction(value), undefined);
  assert.deepEqual(parseAction({ type: 'sort', order: 'project', extra: true }), { type: 'sort', order: 'project' });
  assert.deepEqual(parseAction({ type: 'move', phase: 'end', screenY: -20 }), { type: 'move', phase: 'end', screenY: -20 });
  assert.deepEqual(parseAction({ type: 'expand', reducedMotion: 'true' }), { type: 'expand', reducedMotion: false });
  assert.equal(parseTooltipTarget({ kind: 'usage', providerId: 'atlas', y: 1 }), undefined);
  assert.equal(parseTooltipTarget({ kind: 'session', key: 'atlas:chat', y: NaN }), undefined);
  assert.deepEqual(parseTooltipTarget({ kind: 'usage', providerId: 'atlas', id: 'daily', y: 42 }),
    { kind: 'usage', providerId: 'atlas', id: 'daily', y: 42 });
});

test('settings recover invalid values without admitting invalid sort orders', () => {
  const defaults = clean(null);
  assert.deepEqual(clean([]), defaults);
  assert.deepEqual(clean({ pinned: ['a', null, 'a', 'b'], displayId: 1.5, y: Infinity, sortOrder: 'obsolete' }),
    { ...defaults, pinned: ['a', 'b'] });
  assert.equal(clean({ pinned: Array.from({ length: 600 }, (_, i) => String(i)) }).pinned.length, 500);
});

test('provider JSON parses into complete sessions and bounded usage readings', () => {
  assert.throws(() => parseSessions({ sessions: [] }), /Unsupported session/);
  assert.throws(() => parseSessions([null]), /Unsupported session/);
  const session = required(parseSessions([{ id: 'chat', title: 'Chat', state: 'new-state', updatedAt: 'yesterday' }])[0]);
  assert.equal(session.state, 'unknown'); assert.equal(session.updatedAt, 0);
  assert.throws(() => parseUsageWindows([{ remainingPercent: 72 }]), /Unsupported usage window/);
  assert.throws(() => parseUsageWindows([{ id: 'daily', remainingPercent: 42, resetsAt: -1 }]), /Unsupported usage reset/);
  const windows = parseUsageWindows([{ id: 'daily', remainingPercent: 101 }, { id: 'tokens', remainingPercent: 42 }]);
  assert.equal(required(windows[0]).remainingPercent, undefined);
  assert.deepEqual(required(windows[1]), { id: 'tokens', remainingPercent: 42 });
});

test('Codex usage ignores malformed buckets and chooses account windows by duration', () => {
  for (const value of [null, [], 42, { rateLimitsByLimitId: [] }, { rateLimits: { primary: null } },
    { rateLimits: { primary: { windowDurationMins: 300, usedPercent: '24', resetsAt: 123 } } }]) {
    assert.deepEqual(windowsFrom(value), []);
  }
  assert.deepEqual(windowsFrom({ rateLimits: { primary: { windowDurationMins: 300, usedPercent: 50, resetsAt: 123 } },
    rateLimitsByLimitId: { other: { primary: { windowDurationMins: 300, usedPercent: 0, resetsAt: 123 } } } }), []);
  assert.deepEqual(windowsFrom({ rateLimits: {
    secondary: { windowDurationMins: 300, usedPercent: -10, resetsAt: 123 },
    primary: { windowDurationMins: 10080, usedPercent: 105, resetsAt: 456 }
  } }), [
    { id: 'fiveHour', label: '5h', remainingPercent: 100, resetsAt: 123 },
    { id: 'weekly', label: 'Weekly', remainingPercent: 0, resetsAt: 456 }
  ]);
});

test('a new provider supplies sessions, arbitrary usage windows, and opening without UI changes', async () => {
  const opened: string[] = [];
  let closed = false;
  const adapter: SessionAdapter = {
    id: 'atlas', name: 'Atlas', usage: { scope: 'Workspace', windows: [{ id: 'daily', label: 'Daily' }] },
    async read() { return { health: 'Ready', sessions: [{ id: 'chat', title: 'A new provider',
      projectId: 'shared', state: 'idle', detail: 'Done', updatedAt: epochMilliseconds(1000) }] }; },
    async readUsage() { return { windows: [{ id: 'daily', remainingPercent: 72 }], updatedAt: epochMilliseconds(1000) }; },
    async open(id, openExternal) { opened.push(id); await openExternal(`atlas://${id}`); },
    close() { closed = true; }
  };
  const offline: SessionAdapter = { id: 'offline', name: 'Offline', async read() { throw Error('Offline'); } };
  const monitor = new SessionMonitor([offline, adapter]);
  const snapshot = await monitor.read();
  assert.equal(snapshot.sessions.length, 1);
  const session = required(snapshot.sessions[0]);
  assert.equal(session.key, 'atlas:chat'); assert.equal(session.projectGroup, 'shared');
  assert.equal(session.updatedAt, 1000);
  const usage = required((await monitor.readUsage())[0]);
  assert.equal(usage.providerId, 'atlas'); assert.equal(usage.scope, 'Workspace');
  assert.deepEqual(usage.windows, [{ id: 'daily', label: 'Daily', remainingPercent: 72 }]);
  await monitor.open(session, async url => { opened.push(url); });
  assert.deepEqual(opened, ['chat', 'atlas://chat']);
  monitor.close(); assert.equal(closed, true);
});
