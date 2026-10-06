import { electronBinary } from './electron.js';
import * as path from 'node:path';
import { spawn } from 'node:child_process';
import { closeSync, mkdirSync, openSync, unlinkSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
const root = path.resolve(__dirname, '..', '..');
const env = { ...process.env };
// Some editor terminals inherit this variable from the editor's own runtime.
// Its presence, even with an empty value, turns Electron into a Node process.
delete env.ELECTRON_RUN_AS_NODE;

function checkProfile(folder: string) {
  const probe = path.join(folder, `.launch-write-${randomUUID()}`);
  try {
    mkdirSync(folder, { recursive: true });
    closeSync(openSync(probe, 'wx'));
    unlinkSync(probe);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw Error(`Cannot write the app profile at ${folder}. ${detail}\nCheck create, write, and delete access to this folder, then start again.`);
  }
}

try {
  const binary = electronBinary();
  checkProfile(path.join(root, '.tmp', 'dev-profile'));
  const child = spawn(binary, [root, ...process.argv.slice(2)],
    { cwd: root, env, windowsHide: true, stdio: 'inherit' });
  child.on('error', error => {
    console.error(`Cannot start Electron at ${binary}. ${error.message}\nCheck execute access to the runtime folder.`);
    process.exitCode = 1;
  });
  child.on('close', async (code, signal) => {
    if (code !== 0) console.error(`Electron stopped before a successful exit (${signal || code}). Check the preceding app error.`);
    process.exitCode = code ?? 1;
    // Chromium still holds profile files during app.quit. Remove only this
    // launch's demo data after the child and its output streams have closed.
    if (process.argv.includes('--demo') && child.pid) {
      const profile = path.join(root, '.tmp', `demo-profile-${child.pid}`);
      try { await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); }
      catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        console.error(`Cannot remove this launch's demo profile at ${profile}. ${detail}`);
        process.exitCode = 1;
      }
    }
  });
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
