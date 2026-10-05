import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { spawn } from 'node:child_process';
import { electronBinary } from './electron.js';

// Catch stopped session and usage polling after a delayed install failure.
// The native app and IPC bridges are real. The updater and verifier are controlled fixtures.
async function main() {
  if (process.platform !== 'win32') throw Error('The installer recovery check requires Windows.');
  const evidence = path.resolve(__dirname, '..', '..', 'evidence');
  await fs.mkdir(evidence, { recursive: true });
  const dir = await fs.mkdtemp(path.join(evidence, 'update-recovery-'));
  const code = String.raw`
const { app, BrowserWindow } = require('electron');
const { EventEmitter } = require('node:events');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
app.setPath('userData', path.join(__dirname, 'profile'));
process.argv.push('--demo');
let after = false, verifies = 0;
const adapters = require(process.argv[2]);
adapters.createAdapters = async () => [{ id: 'fixture', name: 'Fixture',
  usage: { scope: 'Fixture', windows: [{ id: 'daily' }] },
  async read() { return { health: 'Ready', sessions: [{ id: 'chat', title: after ? 'After failure' : 'Before failure', state: 'idle', detail: 'Fixture', updatedAt: Date.now() }] }; },
  async readUsage() { return { windows: [{ id: 'daily', remainingPercent: after ? 42 : 72 }], updatedAt: Date.now() }; }
}];
const signature = require(process.argv[3]);
signature.verifyWindowsInstaller = async () => {
  if (++verifies === 2) { await pause(3500); throw Error('Controlled install verification failure'); }
};
class Engine extends EventEmitter {
  async checkForUpdates() { this.emit('update-available', { version: '0.2.0' }); return {}; }
  async downloadUpdate() { return [path.join(__dirname, 'fixture.exe')]; }
  quitAndInstall() {
    const panel = BrowserWindow.getAllWindows().find(win => win.webContents.getURL().endsWith('/index.html'));
    assert.ok(panel, 'Native panel is missing');
    // Model native updater event ordering with real window close handlers. No installer runs.
    require('electron').autoUpdater.emit('before-quit-for-update');
    panel.close();
    assert.equal(panel.isDestroyed(), true, 'The panel blocked update shutdown');
  }
}
const updates = require(process.argv[4]);
const Original = updates.Updates;
updates.Updates = class extends Original {
  constructor(_engine, reason, changed) { super(new Engine(), reason, changed); }
};
// Speed up only the usage interval. Session polling retains its real two-second interval.
const timeout = global.setTimeout;
global.setTimeout = (callback, delay, ...args) => timeout(callback, delay === 60000 ? 2000 : delay, ...args);
require(process.argv[5]);
(async () => {
  const deadline = Date.now() + 20000;
  let panel, settings;
  for (;;) {
    panel = BrowserWindow.getAllWindows().find(win => win.webContents.getURL().endsWith('/index.html'));
    settings = BrowserWindow.getAllWindows().find(win => win.webContents.getURL().endsWith('/settings.html'));
    if (panel && settings) {
      const value = await panel.webContents.executeJavaScript('window.sessionLights.read()').catch(() => null);
      if (value?.update.kind === 'available') break;
    }
    assert.ok(Date.now() < deadline, 'Native app did not start');
    await pause(50);
  }
  const read = () => panel.webContents.executeJavaScript('window.sessionLights.read()');
  const wait = async (condition, message) => {
    while (!condition(await read())) {
      assert.ok(Date.now() < deadline, message);
      await pause(50);
    }
  };
  await settings.webContents.executeJavaScript('window.settings.action({ type: "update", command: "download" })');
  await wait(value => value.update.kind === 'ready', 'Download did not become ready');
  await settings.webContents.executeJavaScript('window.settings.action({ type: "update", command: "install" })');
  await wait(value => value.update.kind === 'download-error', 'Delayed install failure was not reported');
  after = true;
  await wait(value => value.sessions[0]?.title === 'After failure' && value.usage[0]?.windows[0]?.remainingPercent === 42,
    'Session or usage polling stopped after the failed install');
  await panel.webContents.executeJavaScript('window.sessionLights.action({ type: "expand", reducedMotion: true })');
  assert.equal(await panel.webContents.executeJavaScript('document.querySelector(".session-title").textContent'), 'After failure');
  await settings.webContents.executeJavaScript('window.settings.action({ type: "update", command: "download" })');
  await wait(value => value.update.kind === 'ready', 'Download retry did not become ready');
  await settings.webContents.executeJavaScript('window.settings.action({ type: "update", command: "install" })');
  while (!panel.isDestroyed()) {
    assert.ok(Date.now() < deadline, 'The panel blocked update shutdown');
    await pause(50);
  }
  await fs.writeFile(path.join(__dirname, 'report.json'), JSON.stringify({ passed: true, checks: ['delayed install failure', 'session polling continues', 'usage polling continues', 'fresh session reaches the renderer', 'native update event permits panel shutdown'] }, null, 2));
  console.log('Update recovery passed: sessions, usage, and rendered rows stay live after failure; native update shutdown closes the panel.');
  app.quit();
})().catch(error => { console.error(error); app.exit(1); });
`;
  const runner = path.join(dir, 'runner.cjs');
  await fs.writeFile(runner, code);
  const source = path.resolve(__dirname, '..', 'src');
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(electronBinary(), [runner, path.join(source, 'adapters', 'index.js'), path.join(source, 'windows-signature.js'),
    path.join(source, 'updates.js'), path.join(source, 'main.js'), '--disable-gpu'], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk; }); child.stderr.on('data', chunk => { output += chunk; });
  const timer = setTimeout(() => child.kill(), 30000);
  const codeResult = await new Promise<number | null>((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); })
    .finally(() => clearTimeout(timer));
  await fs.writeFile(path.join(dir, 'process.log'), output);
  console.log(output); console.log('Evidence: ' + dir);
  if (codeResult !== 0) throw Error('Update recovery check failed.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
