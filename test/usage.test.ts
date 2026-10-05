import { required } from './assertions.js';
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { CodexUsage } from '../src/adapters/codex-usage.js';

async function setup(options = {}, timeout = 3000) {
  const base = path.join(__dirname, '..', '.test-data');
  await fs.mkdir(base, { recursive: true });
  const dir = await fs.mkdtemp(path.join(base, 'usage-'));
  const file = path.join(dir, 'usage.json');
  const healthy = { result: { rateLimits: {
    primary: { usedPercent: 24, windowDurationMins: 300, resetsAt: Math.floor(Date.now() / 1000) + 7200 },
    secondary: { usedPercent: 16, windowDurationMins: 10080, resetsAt: Math.floor(Date.now() / 1000) + 345600 }
  } } };
  await fs.writeFile(file, JSON.stringify({ ...healthy, ...options }));
  const reader = new CodexUsage({ command: process.execPath, args: [path.join(__dirname, 'usage-server.js')], timeout,
    env: { ...process.env, SESSION_LIGHTS_USAGE_FIXTURE: file } });
  return { reader, file, healthy };
}

test('unrelated and malformed service lines do not stop live usage reads', async t => {
  const { reader } = await setup({ noise: true }); t.after(() => reader.close());
  const result = await reader.read();
  assert.equal(result.message, '');
  assert.equal(required(result.windows.find(window => window.id === 'fiveHour')).remainingPercent, 76);
});

test('two reads during startup both wait for the service to become ready', async t => {
  const { reader } = await setup({ initializeDelayMs: 100 }); t.after(() => reader.close());
  const results = await Promise.all([reader.read(), reader.read()]);
  for (const result of results) {
    assert.equal(result.message, '');
    assert.equal(required(result.windows.find(window => window.id === 'weekly')).remainingPercent, 84);
  }
});

test('a stopped or silent service clears usage and reconnects on the next read', async t => {
  const { reader, file, healthy } = await setup({ exitBeforeRead: true }, 1000); t.after(() => reader.close());
  let result = await reader.read();
  assert.equal(result.windows.length, 0); assert.match(result.message ?? '', /connection ended/);
  await fs.writeFile(file, JSON.stringify({ ...healthy, hang: true }));
  result = await reader.read();
  assert.equal(result.windows.length, 0); assert.match(result.message ?? '', /timed out/);
  await fs.writeFile(file, JSON.stringify(healthy));
  result = await reader.read();
  assert.equal(result.message, ''); assert.equal(result.windows.length, 2);
  reader.close();
  result = await reader.read();
  assert.equal(result.windows.length, 0); assert.match(result.message ?? '', /stopped/);
});


// Catch default usage that waits for an optional setting before reading the account.
test('Codex adapter reads account limits automatically and closes its runtime', async t => {
  const { reader, file } = await setup(); reader.close();
  const { CodexDesktopAdapter } = await import('../src/adapters/codex-desktop.js');
  const { SessionMonitor } = await import('../src/core.js');
  const marker = path.join(path.dirname(file), 'started');
  const service = path.join(path.dirname(file), 'service.cjs');
  await fs.writeFile(service, `require('node:fs').writeFileSync(process.env.SESSION_LIGHTS_START_MARKER, String(process.pid)); require(${JSON.stringify(path.join(__dirname, 'usage-server.js'))});`);
  const adapter = new CodexDesktopAdapter({ usageOptions: {
    command: process.execPath, args: [service], timeout: 3000,
    env: { ...process.env, SESSION_LIGHTS_USAGE_FIXTURE: file, SESSION_LIGHTS_START_MARKER: marker }
  } });
  t.after(() => adapter.close());
  const monitor = new SessionMonitor([adapter]);
  const usage = required((await monitor.readUsage())[0]);
  assert.equal(usage.windows.find(window => window.id === 'fiveHour')?.remainingPercent, 76);
  assert.equal(usage.windows.find(window => window.id === 'weekly')?.remainingPercent, 84);
  const childPid = Number(await fs.readFile(marker, 'utf8'));
  adapter.close();
  const deadline = Date.now() + 3000;
  while (true) {
    try { process.kill(childPid, 0); } catch { break; }
    assert.ok(Date.now() < deadline, 'Closing the adapter must stop its runtime.');
    await new Promise(resolve => setTimeout(resolve, 20));
  }
});
