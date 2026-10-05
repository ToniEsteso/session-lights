const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { DatabaseSync } = require('node:sqlite');
const { resolveState } = require('../core.cjs');
const { CodexUsage } = require('./codex-usage.cjs');

const MAX_TAIL = 512 * 1024;
async function tail(file) {
  const handle = await fs.open(file, 'r');
  try {
    const stat = await handle.stat();
    const start = Math.max(0, stat.size - MAX_TAIL);
    const data = Buffer.alloc(Math.min(stat.size, MAX_TAIL));
    const { bytesRead } = await handle.read(data, 0, data.length, start);
    const text = data.subarray(0, bytesRead).toString('utf8');
    return { text: start ? text.slice(text.indexOf('\n') + 1) : text, modifiedAt: stat.mtimeMs };
  } finally { await handle.close(); }
}

function desktopLogs(platform, home) {
  if (platform === 'win32') return path.join(process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), 'Codex', 'Logs');
  if (platform === 'darwin') return path.join(home, 'Library', 'Logs', 'com.openai.codex');
  return path.join(home, '.config', 'Codex', 'logs');
}

async function newestDatabase(root, prefix) {
  const entries = await fs.readdir(root);
  const versions = entries.map(name => ({ name, match: name.match(new RegExp(`^${prefix}_(\\d+)\\.sqlite$`)) }))
    .filter(entry => entry.match).sort((a, b) => Number(b.match[1]) - Number(a.match[1]));
  return versions.length ? path.join(root, versions[0].name) : null;
}

function readDatabase(file, action) {
  const db = new DatabaseSync(file, { readOnly: true });
  try { db.exec('PRAGMA busy_timeout = 200;'); return action(db); }
  finally { db.close(); }
}

function parseLog(text, signals) {
  for (const line of text.split('\n')) {
    const at = Date.parse(line.slice(0, 24));
    if (!Number.isFinite(at)) continue;
    const notification = /^\S+ info \[electron-message-handler\] \[desktop-notifications\] show notification /.test(line);
    const response = /^\S+ info \[AppServerConnection\] response_routed /.test(line);
    if (!notification && !response) continue;
    const id = line.match(/(?:conversationId|threadId)=([0-9a-f-]{36})(?:\s|$)/i)?.[1];
    if (!id) continue;
    const signal = signals.get(id) || { lastUserAt: 0, lastProgressAt: 0 };
    if (notification) {
      const kind = line.match(/\bkind=(approval|question)\b/)?.[1];
      if (kind && (!signal.waiting || at > signal.waiting.at)) signal.waiting = { at, kind };
    }
    if (response && /\bmethod=turn\/(start|steer)\b/.test(line) && line.includes('errorCode=null')) signal.lastUserAt = Math.max(at, signal.lastUserAt);
    signals.set(id, signal);
  }
}

function isCodexScratchWorkspace(cwd) {
  const parts = cwd.replaceAll('\\', '/').split('/').filter(Boolean);
  return parts.some((part, index) => part.toLowerCase() === 'codex' && /^\d{4}-\d{2}-\d{2}$/.test(parts[index + 1] || ''));
}

function codexPath(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const windows = /^[a-z]:[\\/]/i.test(value) || /^\\\\/.test(value) || /^\/\/[^/]/.test(value);
  const api = windows ? path.win32 : path.posix;
  let clean = value.trim();
  if (windows) clean = clean.replace(/^\\\\\?\\UNC\\/i, '\\\\').replace(/^\\\\\?\\/, '');
  const normalized = api.resolve(clean);
  return { api, windows, normalized: windows ? normalized.toLowerCase() : normalized };
}

function pathContains(root, child) {
  const rootPath = codexPath(root), childPath = codexPath(child);
  if (!rootPath || !childPath || rootPath.windows !== childPath.windows) return false;
  const relative = rootPath.api.relative(rootPath.normalized, childPath.normalized);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${rootPath.api.sep}`) && !rootPath.api.isAbsolute(relative));
}

function readProjectCatalog(db) {
  const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map(row => row.name));
  const byId = new Map(), roots = [];
  if (tables.has('projects')) {
    const columns = new Set(db.prepare('PRAGMA table_info(projects)').all().map(column => column.name));
    if (columns.has('id') && columns.has('name')) for (const row of db.prepare('SELECT id, name FROM projects').all()) {
      if (row.id == null) continue;
      byId.set(String(row.id), { id: String(row.id), name: typeof row.name === 'string' ? row.name.trim() : '' });
    }
  }
  if (tables.has('project_roots')) {
    const columns = new Set(db.prepare('PRAGMA table_info(project_roots)').all().map(column => column.name));
    if (columns.has('project_id') && columns.has('path')) for (const row of db.prepare('SELECT project_id, path FROM project_roots').all()) {
      if (row.project_id != null && typeof row.path === 'string' && row.path.trim()) roots.push({ id: String(row.project_id), path: row.path.trim() });
    }
  }
  return { byId, roots };
}

function findCodexProject(row, catalog) {
  if (row.project_id != null) {
    const project = catalog.byId.get(String(row.project_id));
    if (project) return project;
  }
  const root = catalog.roots.filter(projectRoot => pathContains(projectRoot.path, row.cwd))
    .sort((a, b) => codexPath(b.path).normalized.length - codexPath(a.path).normalized.length)[0];
  return root ? catalog.byId.get(root.id) : undefined;
}

class CodexDesktopAdapter {
  constructor({ home = os.homedir(), root = process.env.CODEX_HOME || path.join(home, '.codex'),
    logs = desktopLogs(process.platform, home), now = Date.now, usageOptions } = {}) {
    this.id = 'codex'; this.name = 'Codex'; this.root = root; this.logs = logs; this.now = now;
    this.fileCache = new Map();
    this.usage = { scope: 'Account-wide usage', windows: [
      { id: 'fiveHour', label: '5h', title: '5-hour limit' }, { id: 'weekly', label: 'Weekly', title: 'Weekly limit' }
    ] };
    this.usageReader = new CodexUsage(usageOptions);
  }

  readUsage() { return this.usageReader.read(); }
  close() { this.usageReader.close(); }
  async open(id, openExternal) {
    if (!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)) throw Error('Invalid Codex chat link.');
    try { await openExternal(`codex://threads/${id}`); }
    catch { throw Error('Cannot open Codex. Check that the desktop app is installed.'); }
  }

  async cachedTail(file) {
    const stat = await fs.stat(file);
    const previous = this.fileCache.get(file);
    if (previous?.size === stat.size && previous.modifiedAt === stat.mtimeMs) return previous;
    const value = { ...await tail(file), size: stat.size };
    this.fileCache.set(file, value);
    return value;
  }

  async readSignals(now) {
    const signals = new Map();
    let found = false;
    // Codex creates date folders in UTC. Include yesterday across midnight.
    for (const at of [now - 86_400_000, now]) {
      const parts = new Date(at).toISOString().slice(0, 10).split('-');
      const dir = path.join(this.logs, ...parts);
      let files;
      try { files = await fs.readdir(dir); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
      for (const name of files.filter(name => name.endsWith('.log'))) {
        found = true;
        parseLog((await this.cachedTail(path.join(dir, name))).text, signals);
      }
    }
    return { signals, found };
  }

  async rolloutState(file) {
    const data = await this.cachedTail(file);
    let status, lastUserAt = 0, lastProgressAt = 0;
    for (const line of data.text.split('\n')) {
      let record;
      try { record = JSON.parse(line); } catch { continue; } // A live writer can leave a partial line.
      if (!record || typeof record !== 'object' || Array.isArray(record)) continue;
      const payload = record.payload || {};
      const at = Date.parse(record.timestamp) || 0;
      if (record.type === 'event_msg') {
        if (payload.type === 'task_started') status = 'inProgress';
        if (payload.type === 'task_complete') status = 'completed';
        if (payload.type === 'turn_aborted') status = 'interrupted';
        if (payload.type === 'user_message') lastUserAt = at;
      }
      if (record.type === 'response_item' && payload.type === 'message' && payload.role === 'user') lastUserAt = at;
      if (record.type === 'response_item' && ['function_call_output', 'custom_tool_call_output'].includes(payload.type)) lastProgressAt = at;
    }
    return { status, lastUserAt, lastProgressAt, updatedAt: data.modifiedAt };
  }

  async read() {
    const now = this.now();
    let stateFile;
    try { stateFile = await newestDatabase(this.root, 'state'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (!stateFile) return { sessions: [], health: 'No Codex session database. Open a local Codex desktop chat.' };
    const state = readDatabase(stateFile, db => {
      const columns = new Set(db.prepare('PRAGMA table_info(threads)').all().map(c => c.name));
      if (!['id', 'title', 'cwd', 'source', 'rollout_path', 'updated_at', 'archived'].every(c => columns.has(c))) throw Error('Unsupported Codex database.');
      const extras = ['name', 'originator', 'updated_at_ms', 'project_id'].filter(c => columns.has(c));
      return { rows: db.prepare(`SELECT id, title, cwd, source, rollout_path, updated_at${extras.map(c => `, ${c}`).join('')} FROM threads WHERE archived = 0`).all(),
        projects: readProjectCatalog(db) };
    });
    const { rows, projects } = state;
    const desktop = [];
    for (const row of rows) {
      if (!['vscode', 'app', 'desktop'].includes(row.source) || typeof row.id !== 'string' || !row.id) continue;
      let origin = row.originator;
      if (!origin) {
        try {
          const handle = await fs.open(row.rollout_path, 'r');
          try {
            const buffer = Buffer.alloc(4096);
            const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
            // Originator occurs before the large instructions field.
            origin = buffer.subarray(0, bytesRead).toString('utf8').match(/"originator"\s*:\s*"([^"]+)"/)?.[1];
          } finally { await handle.close(); }
        } catch { /* Keep unknown origins out of desktop-only scope. */ }
      }
      if (/codex desktop/i.test(origin || '')) desktop.push(row);
    }
    const turns = new Map();
    let historyHealth = '';
    try {
      const historyFile = await newestDatabase(this.root, 'thread_history');
      if (historyFile) readDatabase(historyFile, db => {
        const query = db.prepare('SELECT status FROM thread_turns WHERE thread_id = ? ORDER BY rollout_ordinal DESC LIMIT 1');
        for (const row of desktop) turns.set(row.id, query.get(row.id)?.status);
      });
    } catch {
      turns.clear();
      historyHealth = ' Turn history is unavailable; using session records.';
    }
    let logData;
    try { logData = await this.readSignals(now); }
    catch { logData = { signals: new Map(), found: false }; }
    const sessions = [];
    for (const row of desktop) {
      let recorded;
      try { recorded = await this.rolloutState(row.rollout_path); }
      catch { recorded = { unavailable: true }; }
      const updatedAt = Math.max(row.updated_at_ms || row.updated_at * 1000, recorded.updatedAt || 0);
      const signal = logData.signals.get(row.id) || {};
      const state = recorded.unavailable ? { state: 'unknown', detail: 'The session record cannot be read.' } : resolveState({
        ...recorded, ...signal, status: turns.get(row.id) || recorded.status, updatedAt,
        lastUserAt: Math.max(recorded.lastUserAt || 0, signal.lastUserAt || 0),
        // Async questions can stay open while tools run. Only new user input clears them.
        lastProgressAt: signal.waiting?.kind === 'question' ? 0 : recorded.lastProgressAt || 0
      }, now);
      const title = [row.name, row.title].find(value => typeof value === 'string' && value.trim()) || 'Untitled session';
      const cwd = typeof row.cwd === 'string' ? row.cwd : '';
      const codexProject = findCodexProject(row, projects);
      const project = codexProject?.name || (isCodexScratchWorkspace(cwd) ? 'No workspace' : path.basename(cwd.replaceAll('\\', '/')) || cwd);
      const localProjectId = row.project_id == null ? undefined : String(row.project_id);
      const projectId = localProjectId ? `codex:${localProjectId}` : undefined;
      sessions.push({ id: row.id, title: title.replace(/\s+/g, ' ').trim().slice(0, 160),
        project, projectId, workspace: cwd, updatedAt, ...state });
    }
    // Release cached logs and rollouts which are no longer used.
    const activeRollouts = new Set(desktop.map(row => row.rollout_path));
    for (const [file, value] of this.fileCache) if (!activeRollouts.has(file) && now - value.modifiedAt > 2 * 86_400_000) this.fileCache.delete(file);
    return { sessions, health: (logData.found ? 'Reading local session records. State is based on the last recorded event.' :
      'Reading session records. Desktop logs are missing; approval and question detection is limited.') + historyHealth };
  }
}

module.exports = { CodexDesktopAdapter, desktopLogs };
