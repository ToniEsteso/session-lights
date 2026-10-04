const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { createInterface } = require('node:readline');

async function nativeBinary(file) {
  let handle;
  try {
    handle = await fs.open(file, 'r');
    const header = Buffer.alloc(4); await handle.read(header, 0, 4, 0);
    return header.toString('ascii', 0, 2) === 'MZ' ||
      [0xfeedface, 0xfeedfacf, 0xcefaedfe, 0xcffaedfe, 0xcafebabe, 0xbebafeca].includes(header.readUInt32BE());
  } catch { return false; }
  finally { await handle?.close(); }
}

async function findCodex() {
  if (process.env.SESSION_LIGHTS_CODEX_BINARY) {
    const file = process.env.SESSION_LIGHTS_CODEX_BINARY;
    if (path.isAbsolute(file) && await nativeBinary(file)) return file;
    throw Error('The selected Codex runtime is unavailable.');
  }
  const candidates = [];
  if (process.platform === 'win32') {
    const root = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'OpenAI', 'Codex', 'bin');
    try {
      const versions = await Promise.all((await fs.readdir(root, { withFileTypes: true })).filter(entry => entry.isDirectory())
        .map(async entry => ({ dir: path.join(root, entry.name), time: (await fs.stat(path.join(root, entry.name))).mtimeMs })));
      versions.sort((a, b) => b.time - a.time);
      candidates.push(...versions.map(version => path.join(version.dir, 'codex.exe')));
    } catch { /* Try the CLI installation next. */ }
  } else if (process.platform === 'darwin') {
    candidates.push('/Applications/Codex.app/Contents/Resources/codex', path.join(os.homedir(), 'Applications', 'Codex.app', 'Contents', 'Resources', 'codex'));
  }
  const triple = process.platform === 'win32' ? `${process.arch === 'arm64' ? 'aarch64' : 'x86_64'}-pc-windows-msvc` :
    `${process.arch === 'arm64' ? 'aarch64' : 'x86_64'}-apple-darwin`;
  const executable = process.platform === 'win32' ? 'codex.exe' : 'codex';
  const directories = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
  if (process.platform === 'darwin') directories.push('/opt/homebrew/bin', '/usr/local/bin', path.join(os.homedir(), '.local', 'bin'));
  for (const dir of [...new Set(directories)]) {
    candidates.push(path.join(dir, executable));
    const roots = [path.join(dir, 'node_modules', '@openai', 'codex'), path.join(dir, '..', 'lib', 'node_modules', '@openai', 'codex')];
    try { roots.push(path.dirname(path.dirname(await fs.realpath(path.join(dir, 'codex'))))); } catch { /* Not an npm symlink. */ }
    for (const root of roots) {
      candidates.push(path.join(root, 'vendor', triple, 'bin', executable));
      try {
        const packageFile = require.resolve(`@openai/codex-${process.platform}-${process.arch}/package.json`, { paths: [root] });
        candidates.push(path.join(path.dirname(packageFile), 'vendor', triple, 'bin', executable));
      } catch { /* Not an npm installation. */ }
    }
  }
  for (const file of [...new Set(candidates)]) if (await nativeBinary(file)) return file;
  throw Error('Codex runtime not found. Install Codex CLI or select its runtime.');
}

function windowsFrom(result) {
  // Prefer the account-wide Codex bucket, not an unrelated model bucket.
  const bucket = result?.rateLimitsByLimitId ? result.rateLimitsByLimitId.codex : result?.rateLimits;
  const windows = [];
  for (const [id, label, duration] of [['fiveHour', '5h', 300], ['weekly', 'Weekly', 10080]]) {
    const value = [bucket?.primary, bucket?.secondary].find(window => window?.windowDurationMins === duration);
    if (!value || !Number.isFinite(value.usedPercent) || !Number.isFinite(value.resetsAt) || value.resetsAt <= 0) continue;
    windows.push({ id, label, remainingPercent: Math.max(0, Math.min(100, 100 - value.usedPercent)), resetsAt: value.resetsAt });
  }
  return windows;
}

class CodexUsage {
  constructor({ command, args = ['app-server', '--listen', 'stdio://'], env = process.env, timeout = 15000 } = {}) {
    this.command = command; this.args = args; this.env = env; this.timeout = timeout;
    this.pending = new Map(); this.nextId = 0; this.closed = false;
  }
  async connect() {
    if (this.closed) throw Error('Usage reader stopped.');
    if (this.connecting) return this.connecting;
    if (this.child) return;
    const connecting = this.connecting = this.start();
    try { await connecting; }
    finally { if (this.connecting === connecting) this.connecting = undefined; }
  }
  async start() {
    const command = this.command || await findCodex();
    if (this.closed) throw Error('Usage reader stopped.');
    const child = this.child = spawn(command, this.args, { env: this.env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    child.stderr.resume(); // Never forward Codex logs or account details into the panel.
    const ended = () => { if (this.child === child) this.disconnect(); };
    child.stdin.on('error', ended);
    child.once('error', ended);
    child.once('exit', ended);
    child.stdout.once('end', ended);
    const lines = this.lines = createInterface({ input: child.stdout });
    lines.on('line', line => {
      let value; try { value = JSON.parse(line); } catch { return; }
      if (this.child !== child || !value || typeof value !== 'object' || Array.isArray(value)) return;
      const request = this.pending.get(value.id);
      if (!request) return;
      clearTimeout(request.timer); this.pending.delete(value.id);
      if (value.error) request.reject(Error('Codex usage is unavailable. Check your ChatGPT sign-in.'));
      else request.resolve(value.result);
    });
    await this.request('initialize', { clientInfo: { name: 'session_lights', title: 'Session Lights', version: '0.1.0' } });
    if (this.child !== child) throw Error('Codex usage connection ended.');
    child.stdin.write(`${JSON.stringify({ method: 'initialized' })}\n`);
  }
  request(method, params) {
    return new Promise((resolve, reject) => {
      if (!this.child || this.child.stdin.destroyed) { reject(Error('Codex usage connection ended.')); return; }
      const id = ++this.nextId;
      const timer = setTimeout(() => { this.pending.delete(id); reject(Error('Codex usage read timed out.')); this.disconnect(); }, this.timeout);
      this.pending.set(id, { resolve, reject, timer });
      try { this.child.stdin.write(`${JSON.stringify({ id, method, ...(params ? { params } : {}) })}\n`); }
      catch { this.disconnect(); }
    });
  }
  disconnect() {
    this.lines?.close(); this.lines = undefined;
    const child = this.child; this.child = undefined;
    child?.kill();
    for (const request of this.pending.values()) { clearTimeout(request.timer); request.reject(Error('Codex usage connection ended.')); }
    this.pending.clear();
  }
  async read() {
    try {
      await this.connect();
      const windows = windowsFrom(await this.request('account/rateLimits/read'));
      return { windows, message: windows.length ? '' : 'Usage limits unavailable for this account.', updatedAt: Date.now() };
    } catch (error) {
      this.disconnect();
      return { windows: [], message: error.message, updatedAt: null };
    }
  }
  close() { this.closed = true; this.disconnect(); }
}
module.exports = { CodexUsage };
