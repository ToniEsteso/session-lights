import { electronBinary } from './electron.js';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { spawn } from 'node:child_process';
import { fixture } from '../test/fixtures.js';
import { DatabaseSync } from 'node:sqlite';
async function main() {
  const root = path.join(__dirname, '..', '..', 'evidence');
  await fs.mkdir(root, { recursive: true });
  const dir = await fs.mkdtemp(path.join(root, 'desktop-'));
  const data = await fixture(dir);
  // Older settings must not hide old chats after the filter control is removed.
  const db = new DatabaseSync(path.join(data.root, 'state_5.sqlite'));
  db.prepare('UPDATE threads SET updated_at = ? WHERE id = ?').run(Math.floor((Date.now() - 2 * 86_400_000) / 1000), data.ids[1]);
  db.close();
  await fs.mkdir(path.join(dir, 'profile'), { recursive: true });
  await fs.writeFile(path.join(dir, 'profile', 'preferences.json'), JSON.stringify({ showAll: false, sortOrder: 'obsolete', codexUsageEnabled: true }));
  await fs.writeFile(path.join(dir, 'system-text-percent.json'), '100');
  await fs.writeFile(path.join(dir, 'usage.json'), JSON.stringify({ result: { rateLimitsByLimitId: { codex: {
    primary: { usedPercent: 24, windowDurationMins: 300, resetsAt: Math.floor(Date.now() / 1000) + 7200 },
    secondary: { usedPercent: 16, windowDurationMins: 10080, resetsAt: Math.floor(Date.now() / 1000) + 345600 }
  } } } }));
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  const launch = (restart = false) => new Promise<number | null>((resolve, reject) => {
    const child = spawn(electronBinary(), [path.join(__dirname, '..', '..'), `--desktop-test=${dir}`, ...(restart ? ['--adapter-visibility-restart'] : []), ...(process.argv.includes('--disable-gpu') ? ['--disable-gpu'] : [])],
      { windowsHide: true, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.on('data', chunk => { output += chunk; });
    const timeout = setTimeout(() => { child.kill(); }, 45_000);
    child.on('error', error => { clearTimeout(timeout); reject(error); });
    child.on('exit', async code => {
      clearTimeout(timeout);
      await fs.writeFile(path.join(dir, restart ? 'restart-process.log' : 'process.log'), output);
      console.log(output); console.log(`Evidence: ${dir}`);
      resolve(code);
    });
  });
  const first = await launch();
  process.exitCode = first === 0 && await launch(true) === 0 ? 0 : 1;
}
main().catch(error => { console.error(error); process.exitCode = 1; });
