import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { parseAction, parseSettingsAction } from '../src/shared/validation.js';
import { Updates } from '../src/updates.js';

test('settings IPC accepts fixed update commands and panel navigation', () => {
  for (const input of [null, { type: 'update', command: 'run', url: 'https://example.com' }, { type: 'update', command: 'downgrade' }, { type: 'open', path: 'C:/file.exe' }]) {
    assert.equal(parseSettingsAction(input), undefined);
  }
  assert.deepEqual(parseSettingsAction({ type: 'update', command: 'download', url: 'https://example.com' }), { type: 'update', command: 'download' });
  assert.deepEqual(parseAction({ type: 'settings' }), { type: 'settings', reducedMotion: false });
  assert.deepEqual(parseAction({ type: 'settings', reducedMotion: true }), { type: 'settings', reducedMotion: true });
  assert.deepEqual(parseSettingsAction({ type: 'close' }), { type: 'close' });
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
