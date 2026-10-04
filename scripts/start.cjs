const path = require('node:path');
const { spawn } = require('node:child_process');
const env = { ...process.env };
// Some editor terminals inherit this variable from the editor's own runtime.
// Its presence, even with an empty value, turns Electron into a Node process.
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(require('electron'), [path.join(__dirname, '..'), ...process.argv.slice(2)],
  { env, windowsHide: true, stdio: 'inherit' });
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
