import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { parseAction, parseSettingsAction } from '../src/shared/validation.js';
import { Updates } from '../src/updates.js';

test('settings IPC accepts only fixed update commands and finite menu anchors', () => {
  for (const input of [null, { type: 'update', command: 'run', url: 'https://example.com' }, { type: 'update', command: 'downgrade' }, { type: 'open', path: 'C:/file.exe' }]) {
    assert.equal(parseSettingsAction(input), undefined);
  }
  assert.deepEqual(parseSettingsAction({ type: 'update', command: 'download', url: 'https://example.com' }), { type: 'update', command: 'download' });
  assert.equal(parseSettingsAction({ type: 'codex-usage', enabled: 'true' }), undefined);
  assert.deepEqual(parseSettingsAction({ type: 'codex-usage', enabled: true }), { type: 'codex-usage', enabled: true });
  assert.equal(parseAction({ type: 'settings', y: Infinity }), undefined);
  assert.deepEqual(parseAction({ type: 'settings', y: 20 }), { type: 'settings', y: 20 });
});
test('development update commands cannot download or install', async () => {
  let changes = 0;
  const updates = new Updates(undefined, 'Development build', () => { changes++; });
  updates.start();
  for (const command of ['check', 'download', 'install'] as const) await updates.run(command);
  updates.close();
  assert.deepEqual(updates.state, { kind: 'disabled', reason: 'Development build' });
  assert.equal(changes, 0);
});
