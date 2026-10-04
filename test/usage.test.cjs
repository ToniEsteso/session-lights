const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { CodexUsage } = require('../src/adapters/codex-usage.cjs');

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
  const reader = new CodexUsage({ command: process.execPath, args: [path.join(__dirname, 'usage-server.cjs')], timeout,
    env: { ...process.env, SESSION_LIGHTS_USAGE_FIXTURE: file } });
  return { reader, file, healthy };
}

test('unrelated and malformed service lines do not stop live usage reads', async t => {
  const { reader } = await setup({ noise: true }); t.after(() => reader.close());
  const result = await reader.read();
  assert.equal(result.message, '');
  assert.equal(result.windows.find(window => window.id === 'fiveHour').remainingPercent, 76);
});

test('two reads during startup both wait for the service to become ready', async t => {
  const { reader } = await setup({ initializeDelayMs: 100 }); t.after(() => reader.close());
  const results = await Promise.all([reader.read(), reader.read()]);
  for (const result of results) {
    assert.equal(result.message, '');
    assert.equal(result.windows.find(window => window.id === 'weekly').remainingPercent, 84);
  }
});

test('a stopped or silent service clears usage and reconnects on the next read', async t => {
  const { reader, file, healthy } = await setup({ exitBeforeRead: true }, 1000); t.after(() => reader.close());
  let result = await reader.read();
  assert.equal(result.windows.length, 0); assert.match(result.message, /connection ended/);
  await fs.writeFile(file, JSON.stringify({ ...healthy, hang: true }));
  result = await reader.read();
  assert.equal(result.windows.length, 0); assert.match(result.message, /timed out/);
  await fs.writeFile(file, JSON.stringify(healthy));
  result = await reader.read();
  assert.equal(result.message, ''); assert.equal(result.windows.length, 2);
  reader.close();
  result = await reader.read();
  assert.equal(result.windows.length, 0); assert.match(result.message, /stopped/);
});
