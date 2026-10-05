import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
function command(executable: string, args: string[]) {
  const result = spawnSync(executable, args, { encoding: 'utf8', windowsHide: true });
  if (result.error || result.status !== 0) throw Error(result.error?.message || result.stderr || result.stdout || `${executable} failed.`);
}
async function main() {
  if (!['win32', 'darwin'].includes(process.platform)) throw Error('Build on Windows or macOS.');
  const root = path.join(__dirname, '..', '..');
  const output = path.join(root, 'dist', `session-lights-${process.platform}-${process.arch}-${Date.now()}`);
  const electronDist = path.join(path.dirname(require.resolve('electron')), 'dist');
  await fs.cp(electronDist, output, { recursive: true, errorOnExist: true, verbatimSymlinks: true });
  let resources;
  if (process.platform === 'win32') {
    await fs.rename(path.join(output, 'electron.exe'), path.join(output, 'Session Lights.exe'));
    resources = path.join(output, 'resources');
  } else {
    const bundle = path.join(output, 'Session Lights.app');
    await fs.rename(path.join(output, 'Electron.app'), bundle);
    resources = path.join(bundle, 'Contents', 'Resources');
    const plist = path.join(bundle, 'Contents', 'Info.plist');
    const text = await fs.readFile(plist, 'utf8');
    await fs.writeFile(plist, text.replace(/(<key>CFBundleName<\/key>\s*<string>)[^<]+/, '$1Session Lights')
      .replace(/(<key>CFBundleIdentifier<\/key>\s*<string>)[^<]+/, '$1local.session-lights'));
  }
  const target = path.join(resources, 'app');
  await fs.mkdir(target, { recursive: true });
  await fs.cp(path.join(root, 'build', 'src'), path.join(target, 'src'), { recursive: true });
  await fs.writeFile(path.join(target, 'package.json'), JSON.stringify({ name: 'session-lights', version: '0.1.0', main: 'src/main.js', type: 'commonjs' }, null, 2));
  await fs.copyFile(path.join(root, 'README.md'), path.join(output, 'README.md'));
  await fs.cp(path.join(root, 'docs'), path.join(output, 'docs'), { recursive: true });
  await fs.copyFile(path.join(root, 'VERIFICATION.md'), path.join(output, 'VERIFICATION.md'));
  if (process.platform === 'win32') command('icacls', [output, '/grant', '*S-1-15-2-1:(OI)(CI)(RX)']);
  else command('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', path.join(output, 'Session Lights.app')]);
  console.log(`Portable app: ${output}`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
