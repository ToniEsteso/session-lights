import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { electronBinary } from './electron.js';
import * as assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { CodexCliAdapter } from '../src/adapters/codex-cli.js';
import { CodexDesktopAdapter } from '../src/adapters/codex-desktop.js';
import { findCodex } from '../src/adapters/codex-runtime.js';
import { SessionMonitor } from '../src/core.js';

// Read the installed runtime and its actual records. Do not print chat contents.
async function main() {
  const root = process.argv.find(arg => arg.startsWith('--root='))?.slice('--root='.length);
  const id = process.argv.find(arg => arg.startsWith('--id='))?.slice('--id='.length);
  const expected = process.argv.find(arg => arg.startsWith('--expect='))?.slice('--expect='.length);
  if (id && !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)) throw Error('Supply a valid session UUID.');
  const options = root ? { root } : {};
  const cli = new CodexCliAdapter(options);
  const monitor = new SessionMonitor([new CodexDesktopAdapter(options), cli]);
  const binary = await findCodex('cli');
  await new Promise<void>((resolve, reject) => {
    const child = spawn(binary, ['--version'], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    child.stdout.on('data', chunk => process.stdout.write(chunk));
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolve() : reject(Error('Codex CLI version check failed.')));
  });
  const snapshot = await monitor.read();
  const desktopIds = new Set(snapshot.sessions.filter(s => s.providerId === 'codex').map(s => s.id));
  const sessions = snapshot.sessions.filter(s => s.providerId === cli.id);
  assert.ok(sessions.every(s => !desktopIds.has(s.id)), 'A session appears in both adapters.');
  console.log(`Desktop sessions: ${desktopIds.size}; CLI sessions: ${sessions.length}.`);
  if (id) {
    const session = sessions.find(session => session.id === id);
    assert.ok(session, 'The requested unarchived CLI session was not found.');
    if (expected) assert.equal(session.state, expected);
    console.log(`CLI session ${session.id}: ${session.state}.`);
    if (process.argv.includes('--panel')) {
      const evidence = path.join(__dirname, '..', '..', 'evidence'); await fs.mkdir(evidence, { recursive: true });
      const dir = await fs.mkdtemp(path.join(evidence, 'cli-live-'));
      const recordsRoot = root || process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
      await fs.symlink(path.resolve(recordsRoot), path.join(dir, 'codex'), process.platform === 'win32' ? 'junction' : 'dir');
      await fs.writeFile(path.join(dir, 'system-text-percent.json'), '100');
      await fs.writeFile(path.join(dir, 'usage.json'), JSON.stringify({ result: { rateLimits: {} } }));
      const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
      await new Promise<void>((resolve, reject) => {
        const child = spawn(electronBinary(), [path.join(__dirname, '..', '..'), `--desktop-test=${dir}`, `--live-cli=${session.id}`, `--live-cli-state=${expected || session.state}`], { windowsHide: true, env, stdio: 'inherit' });
        const timeout = setTimeout(() => { child.kill(); reject(Error('Live CLI panel check timed out.')); }, 30_000);
        child.once('error', error => { clearTimeout(timeout); reject(error); });
        child.once('exit', code => { clearTimeout(timeout); code === 0 ? resolve() : reject(Error('Live CLI panel check failed.')); });
      });
      console.log(`Live panel evidence: ${dir}`);
    }
    if (process.argv.includes('--open')) { await monitor.open(session, async () => { throw Error('CLI opening must not use a desktop link.'); }); console.log('CLI resume terminal started.'); }
  } else if (expected || process.argv.includes('--open') || process.argv.includes('--panel')) throw Error('Supply --id to check a state or open a session.');
  assert.equal(monitor.usageSnapshot().length, 1, 'Codex account limits must have one owner.');
  console.log('Installed Codex CLI check passed.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
