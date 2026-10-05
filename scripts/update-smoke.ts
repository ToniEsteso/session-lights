import { app } from 'electron';
import { NsisUpdater } from 'electron-updater';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { Updates } from '../src/updates.js';
import { updateView } from '../src/shared/updates.js';
import type { UpdateState } from '../src/shared/updates.js';
import { isRecord } from '../src/shared/validation.js';
import { required } from '../test/assertions.js';

async function main() {
  const installer = required(process.argv[2]), dir = required(process.argv[3]);
  app.setPath('userData', path.join(dir, 'profile'));
  await app.whenReady();
  const bytes = await fs.readFile(installer);
  const sha512 = createHash('sha512').update(bytes).digest('base64');
  const metadata: unknown = JSON.parse(await fs.readFile(path.resolve(__dirname, '..', '..', 'package.json'), 'utf8'));
  assert.ok(isRecord(metadata) && typeof metadata.version === 'string');
  let failCheck = true, corrupt = false, latest = '0.0.0', downloads = 0;
  const states: UpdateState[] = [];
  const server = createServer((request, response) => {
    if (request.url?.startsWith('/latest.yml')) {
      response.setHeader('Content-Type', 'application/yaml');
      response.end(failCheck ? 'not: [valid yaml' : JSON.stringify({ version: latest,
        files: [{ url: 'installer.exe', sha512, size: bytes.length }], path: 'installer.exe', sha512,
        releaseDate: new Date().toISOString() }));
    } else if (request.url?.startsWith('/installer.exe')) {
      downloads++;
      const content = corrupt ? Buffer.from('corrupt installer') : bytes;
      response.setHeader('Content-Length', content.length);
      response.setHeader('Content-Type', 'application/octet-stream');
      let offset = 0;
      const send = () => {
        if (response.destroyed) return;
        if (offset >= content.length) { response.end(); return; }
        response.write(content.subarray(offset, offset + 1024 * 1024)); offset += 1024 * 1024;
        setTimeout(send, 25);
      };
      send();
    } else { response.statusCode = 404; response.end(); }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const url = `http://127.0.0.1:${address.port}`;
  const config = path.join(dir, 'app-update.yml');
  await fs.writeFile(config, JSON.stringify({ provider: 'generic', url, updaterCacheDirName: 'download-cache' }));
  assert.equal(app.getVersion(), '0.0.0');
  const engine = new NsisUpdater({ provider: 'generic', url });
  engine.forceDevUpdateConfig = true;
  engine.updateConfigPath = config;
  engine.disableDifferentialDownload = true;
  const updates = new Updates(engine, '', () => { states.push(structuredClone(updates.state)); });
  const snapshot = () => structuredClone(updates.state);
  try {
    assert.equal(engine.autoDownload, false); assert.equal(engine.autoInstallOnAppQuit, false);
    await updates.run('install');
    await updates.run('check');
    assert.equal(snapshot().kind, 'check-error');
    assert.equal(updateView(updates.state).command, 'check');
    failCheck = false;
    await updates.run('check');
    assert.equal(snapshot().kind, 'current');
    latest = metadata.version;
    await updates.run('check');
    assert.deepEqual(updates.state, { kind: 'available', version: latest });
    assert.equal(downloads, 0, 'Checks must not download.');
    await updates.run('install');
    corrupt = true;
    await updates.run('download');
    assert.equal(snapshot().kind, 'download-error', 'Invalid checksum must prevent installation.');
    corrupt = false;
    const downloading = updates.run('download');
    await updates.run('download'); await updates.run('check');
    await downloading;
    assert.deepEqual(updates.state, { kind: 'ready', version: latest });
    assert.equal(downloads, 2, 'Concurrent commands must not duplicate the download.');
    assert.ok(states.some(state => state.kind === 'downloading' && state.percent > 0 && state.percent < 100), 'Real download progress must be reported.');
    const pending = path.join(dir, 'download-cache', 'pending');
    const downloaded = path.join(pending, required((await fs.readdir(pending)).find(name => name.endsWith('.exe'))));
    assert.deepEqual(await fs.readFile(downloaded), bytes, 'Downloaded installer must match the build.');
    updates.close();
    await fs.writeFile(path.join(dir, 'report.json'), JSON.stringify({ installer, sha512, states, downloads,
      checks: ['manual downloads', 'manual installation', 'check failure and retry', 'up to date', 'new version', 'checksum rejection', 'download retry', 'concurrent commands', 'real progress', 'downloaded bytes match'],
      limitation: 'The installer is downloaded but not installed by this check. Signing is not tested by the unsigned fixture.' }, null, 2));
    console.log('Update checks passed: real NSIS updater, local HTTP feed, checksum failure, retry, progress, and installer bytes.');
  } finally {
    updates.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
  }
  app.quit();
}
main().catch(error => { console.error(error); app.exit(1); });
