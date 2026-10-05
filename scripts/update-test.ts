import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { spawn } from 'node:child_process';
import { electronBinary } from './electron.js';

async function main() {
  if (process.platform !== 'win32') throw Error('The update download check requires Windows.');
  const root = path.resolve(__dirname, '..', '..');
  const installer = path.resolve(process.argv[2] || '');
  const relative = path.relative(path.join(root, 'dist'), installer);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || !installer.endsWith('.exe')) throw Error('Supply an installer from this project\'s dist folder.');
  await fs.access(installer);
  const evidence = path.join(root, 'evidence');
  await fs.mkdir(evidence, { recursive: true });
  const dir = await fs.mkdtemp(path.join(evidence, 'updates-'));
  const runner = path.join(dir, 'runner');
  await fs.mkdir(runner);
  await fs.writeFile(path.join(runner, 'package.json'), JSON.stringify({ name: 'session-lights-update-check', version: '0.0.0', main: path.join(__dirname, 'update-smoke.js') }));
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  env.LOCALAPPDATA = dir;
  const child = spawn(electronBinary(), [runner, installer, dir], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', data => { output += data; }); child.stderr.on('data', data => { output += data; });
  const timeout = setTimeout(() => child.kill(), 60_000);
  const code = await new Promise((resolve, reject) => { child.on('error', reject); child.on('exit', resolve); }).finally(() => clearTimeout(timeout));
  await fs.writeFile(path.join(dir, 'process.log'), output);
  console.log(output); console.log(`Evidence: ${dir}`);
  process.exitCode = code === 0 ? 0 : 1;
}
main().catch(error => { console.error(error); process.exitCode = 1; });
