import * as path from 'node:path';
import { spawn } from 'node:child_process';

if (process.platform !== 'win32' && process.platform !== 'darwin') throw Error('Build on Windows or macOS.');
const root = path.resolve(__dirname, '..', '..');
const args = [require.resolve('electron-builder/cli.js'), '--config', path.join(root, 'electron-builder.json'), '--publish', 'never'];
if (process.argv.includes('--dir')) args.push('--dir');
const child = spawn(process.execPath, args, { cwd: root, windowsHide: true, stdio: 'inherit' });
child.on('error', error => { console.error(error); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
