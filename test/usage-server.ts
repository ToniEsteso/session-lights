import { isRecord } from '../src/shared/validation.js';
// Isolated JSON-RPC service for native UI checks. It never reads a real Codex account.
import * as fs from 'node:fs';
import { createInterface } from 'node:readline';
const file = process.env.SESSION_LIGHTS_USAGE_FIXTURE;
if (!file) throw Error('Missing usage fixture path.');
const lines = createInterface({ input: process.stdin });
let initialized = false;
lines.on('line', line => {
  const value: unknown = JSON.parse(line);
  if (!isRecord(value)) return;
  if (value.method === 'initialized') { initialized = true; return; }
  const fixture: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!isRecord(fixture)) throw Error('Invalid usage fixture.');
  if (value.method === 'initialize') {
    if (fixture.noise) for (const line of ['null', '[]', '42', 'not json', '{"method":"notice"}']) console.log(line);
    const reply = () => console.log(JSON.stringify({ id: value.id, result: {} }));
    if (typeof fixture.initializeDelayMs === 'number' && fixture.initializeDelayMs > 0) setTimeout(reply, fixture.initializeDelayMs);
    else reply();
    return;
  }
  if (!initialized || value.method !== 'account/rateLimits/read') {
    console.log(JSON.stringify({ id: value.id, error: { code: -32601, message: 'Unsupported request.' } })); return;
  }
  if (fixture.exitBeforeRead) process.exit(0);
  if (fixture.hang) return;
  console.log(JSON.stringify({ id: value.id, ...fixture }));
});
