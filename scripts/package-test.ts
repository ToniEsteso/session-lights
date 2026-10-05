import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import * as assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { extractFile } from '@electron/asar';
import { isRecord } from '../src/shared/validation.js';

async function main() {
  const root = path.resolve(__dirname, '..', '..');
  const directory = path.resolve(process.argv[2] || path.join(root, 'dist', 'win-unpacked'));
  const relative = path.relative(path.join(root, 'dist'), directory);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw Error('Supply this project\'s unpacked app folder.');
  const resources = process.platform === 'win32' ? path.join(directory, 'resources') : path.join(directory, 'Session Lights.app', 'Contents', 'Resources');
  const archive = path.join(resources, 'app.asar');
  async function compare(folder: string) {
    for (const item of await fs.readdir(path.join(root, folder), { withFileTypes: true })) {
      const child = path.join(folder, item.name);
      if (item.isDirectory()) await compare(child);
      else if (!child.endsWith('.map')) assert.deepEqual(extractFile(archive, child), await fs.readFile(path.join(root, child)), `Package differs: ${child}`);
    }
  }
  await compare('build/src');
  const source: unknown = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
  const packaged: unknown = JSON.parse(extractFile(archive, 'package.json').toString('utf8'));
  assert.ok(isRecord(source) && isRecord(packaged));
  assert.equal(packaged.version, source.version);
  assert.equal(packaged.main, 'build/src/main.js');
  assert.deepEqual(await fs.readFile(path.join(resources, 'installation.md')), await fs.readFile(path.join(root, 'docs', 'installation.md')));
  const feed = await fs.readFile(path.join(resources, 'app-update.yml'), 'utf8');
  assert.match(feed, /provider: github/); assert.match(feed, /repo: session-lights\s/);
  const executable = process.platform === 'win32' ? path.join(directory, 'Session Lights.exe') : path.join(directory, 'Session Lights.app', 'Contents', 'MacOS', 'Session Lights');
  const evidence = path.join(root, 'evidence');
  await fs.mkdir(evidence, { recursive: true });
  const profile = await fs.mkdtemp(path.join(evidence, 'package-check-'));
  const env = { ...process.env };
  env.CODEX_HOME = path.join(profile, 'codex');
  env.SESSION_LIGHTS_CODEX_BINARY = path.join(profile, 'unavailable-codex.exe');
  env.LOCALAPPDATA = profile;
  delete env.ELECTRON_RUN_AS_NODE;
  await fs.mkdir(env.CODEX_HOME);
  const child = spawn(executable, ['--launch-check'], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', data => { output += data; }); child.stderr.on('data', data => { output += data; });
  const timeout = setTimeout(() => child.kill(), 25_000);
  const code = await new Promise((resolve, reject) => { child.on('error', reject); child.on('exit', resolve); }).finally(() => clearTimeout(timeout));
  await fs.mkdir(path.join(root, 'evidence'), { recursive: true });
  await fs.writeFile(path.join(root, 'evidence', 'package-launch.log'), output);
  assert.equal(code, 0, output);
  assert.match(output, /Session Lights is running\. Local sessions: 0\. Panel above other windows: true\./);
  assert.ok(output.includes(`Version: ${source.version}.`));
  assert.match(output, /Update mode: idle\./);
  assert.match(output, /Usage windows: 0\./);
  console.log('Package check passed: compiled files, version, update feed, help, native app, and tray.');
  console.log(output);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
