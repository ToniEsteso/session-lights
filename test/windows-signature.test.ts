import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { verifyWindowsInstaller } from '../src/windows-signature.js';

test('Windows signatures accept a trusted publisher and reject changed bytes and unavailable verification', { skip: process.platform !== 'win32' }, async () => {
  const systemRoot = process.env.SystemRoot;
  assert.ok(systemRoot);
  const signed = path.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const base = path.join(__dirname, '..', '.test-data'); await fs.mkdir(base, { recursive: true });
  const dir = await fs.mkdtemp(path.join(base, 'signature-'));
  // Quotes and shell characters in a path must remain literal data.
  const copy = path.join(dir, "publisher's $copy; file.exe");
  await fs.copyFile(signed, copy);
  await verifyWindowsInstaller(copy, signed);
  await assert.rejects(verifyWindowsInstaller(process.execPath, signed), /publisher/);
  await fs.writeFile(copy, 'unsigned replacement');
  await assert.rejects(verifyWindowsInstaller(copy, signed), /publisher/);
  try {
    process.env.SystemRoot = path.join(dir, 'missing-system-root');
    await assert.rejects(verifyWindowsInstaller(signed, signed), /verification failed/);
  } finally { process.env.SystemRoot = systemRoot; }
});
