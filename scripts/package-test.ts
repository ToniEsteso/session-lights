import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import * as assert from 'node:assert/strict';
import { spawn } from 'node:child_process';

async function main() {
  const root = path.join(__dirname, '..', '..');
  const directory = path.resolve(process.argv[2] || '');
  const relative = path.relative(path.join(root, 'dist'), directory);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw Error('Supply this project\'s portable app folder.');
  const resources = process.platform === 'win32' ? path.join(directory, 'resources', 'app') : path.join(directory, 'Session Lights.app', 'Contents', 'Resources', 'app');
  async function compare(folder: string) {
    for (const item of await fs.readdir(path.join(root, 'build', folder), { withFileTypes: true })) {
      const child = path.join(folder, item.name);
      if (item.isDirectory()) await compare(child);
      else assert.deepEqual(await fs.readFile(path.join(resources, child)), await fs.readFile(path.join(root, 'build', child)), `Package differs: ${child}`);
    }
  }
  await compare('src');
  const executable = process.platform === 'win32' ? path.join(directory, 'Session Lights.exe') : path.join(directory, 'Session Lights.app', 'Contents', 'MacOS', 'Electron');
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(executable, ['--launch-check'], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', data => { output += data; }); child.stderr.on('data', data => { output += data; });
  const timeout = setTimeout(() => child.kill(), 25_000);
  const code = await new Promise((resolve, reject) => { child.on('error', reject); child.on('exit', resolve); }).finally(() => clearTimeout(timeout));
  await fs.mkdir(path.join(root, 'evidence'), { recursive: true });
  await fs.writeFile(path.join(root, 'evidence', 'package-launch.log'), output);
  assert.equal(code, 0, output);
  assert.match(output, /Session Lights is running\. Local sessions: \d+\. Panel above other windows: true\./);
  assert.match(output, /Usage windows: 2\./);
  console.log('Package check passed: source files match; native app and tray start; real session reader runs.');
  console.log(output);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
