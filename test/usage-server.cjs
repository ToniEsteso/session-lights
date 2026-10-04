// Isolated JSON-RPC service for native UI checks. It never reads a real Codex account.
const fs = require('node:fs');
const { createInterface } = require('node:readline');
const lines = createInterface({ input: process.stdin });
let initialized = false;
lines.on('line', line => {
  const value = JSON.parse(line);
  if (value.method === 'initialized') { initialized = true; return; }
  const fixture = JSON.parse(fs.readFileSync(process.env.SESSION_LIGHTS_USAGE_FIXTURE, 'utf8'));
  if (value.method === 'initialize') {
    if (fixture.noise) for (const line of ['null', '[]', '42', 'not json', '{"method":"notice"}']) console.log(line);
    const reply = () => console.log(JSON.stringify({ id: value.id, result: {} }));
    if (fixture.initializeDelayMs) setTimeout(reply, fixture.initializeDelayMs);
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
