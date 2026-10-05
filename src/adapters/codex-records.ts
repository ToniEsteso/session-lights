import { epochMilliseconds } from '../shared/time.js';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { resolveState } from '../core.js';

import type { SessionReading } from '../shared/contracts.js';
import type { RecordedTurn, TurnSignal } from '../core.js';
import { isRecord, hasErrorCode } from '../shared/validation.js';

export interface CodexRecordsOptions { home?: string; root?: string; now?: () => number }
interface RolloutTurn extends RecordedTurn { waiting?: NonNullable<TurnSignal['waiting']>; turnId?: string; statusAt: number }
interface HistoryTurn { status: string; turnId?: string }
interface Tail { text: string; modifiedAt: number; size: number }
interface ProjectCatalog { byId: Map<string, { id: string; name: string }>; roots: { id: string; path: string }[] }
interface ThreadRow { id: string; title: string; cwd: string; source: string; rollout_path: string; updated_at: number; name?: string; originator?: string; updated_at_ms?: number; project_id?: string }
function parseThread(value: unknown): ThreadRow | undefined {
  if (!isRecord(value) || typeof value.id !== 'string' ||
      typeof value.source !== 'string' || typeof value.updated_at !== 'number' ||
      !Number.isFinite(value.updated_at) || value.updated_at < 0 || value.updated_at > 8.64e12 ||
      (value.updated_at_ms != null && (typeof value.updated_at_ms !== 'number' || !Number.isFinite(value.updated_at_ms) || value.updated_at_ms < 0 || value.updated_at_ms > 8.64e15))) return;
  const row: ThreadRow = { id: value.id, title: typeof value.title === 'string' ? value.title : '', cwd: typeof value.cwd === 'string' ? value.cwd : '', source: value.source, rollout_path: typeof value.rollout_path === 'string' ? value.rollout_path : '', updated_at: value.updated_at };
  if (typeof value.name === 'string') row.name = value.name;
  if (typeof value.originator === 'string') row.originator = value.originator;
  if (typeof value.updated_at_ms === 'number') row.updated_at_ms = value.updated_at_ms;
  if (typeof value.project_id === 'string' || typeof value.project_id === 'number') row.project_id = String(value.project_id);
  return row;
}
const MAX_TAIL = 512 * 1024;
async function tail(file: string) {
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

async function newestDatabase(root: string, prefix: string) {
  const entries = await fs.readdir(root);
  const versions = entries.flatMap(name => {
    const match = name.match(new RegExp(`^${prefix}_(\\d+)\\.sqlite$`));
    return match ? [{ name, version: Number(match[1]) }] : [];
  }).sort((a, b) => b.version - a.version);
  const newest = versions[0];
  return newest ? path.join(root, newest.name) : null;
}

function readDatabase<T>(file: string, action: (db: DatabaseSync) => T): T {
  const db = new DatabaseSync(file, { readOnly: true });
  try { db.exec('PRAGMA busy_timeout = 200;'); return action(db); }
  finally { db.close(); }
}

function isCodexScratchWorkspace(cwd: string) {
  const parts = cwd.replaceAll('\\', '/').split('/').filter(Boolean);
  return parts.some((part, index) => part.toLowerCase() === 'codex' && /^\d{4}-\d{2}-\d{2}$/.test(parts[index + 1] || ''));
}

function codexPath(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const windows = /^[a-z]:[\\/]/i.test(value) || /^\\\\/.test(value) || /^\/\/[^/]/.test(value);
  const api = windows ? path.win32 : path.posix;
  let clean = value.trim();
  if (windows) clean = clean.replace(/^\\\\\?\\UNC\\/i, '\\\\').replace(/^\\\\\?\\/, '');
  const normalized = api.resolve(clean);
  return { api, windows, normalized: windows ? normalized.toLowerCase() : normalized };
}

function pathContains(root: string, child: string) {
  const rootPath = codexPath(root), childPath = codexPath(child);
  if (!rootPath || !childPath || rootPath.windows !== childPath.windows) return false;
  const relative = rootPath.api.relative(rootPath.normalized, childPath.normalized);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${rootPath.api.sep}`) && !rootPath.api.isAbsolute(relative));
}

function readProjectCatalog(db: DatabaseSync): ProjectCatalog {
  const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map(row => row.name));
  const byId: ProjectCatalog['byId'] = new Map(), roots: ProjectCatalog['roots'] = [];
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

function findCodexProject(row: ThreadRow, catalog: ProjectCatalog) {
  if (row.project_id != null) {
    const project = catalog.byId.get(String(row.project_id));
    if (project) return project;
  }
  const root = catalog.roots.filter(projectRoot => pathContains(projectRoot.path, row.cwd))
    .sort((a, b) => (codexPath(b.path)?.normalized.length ?? 0) - (codexPath(a.path)?.normalized.length ?? 0))[0];
  return root ? catalog.byId.get(root.id) : undefined;
}

class CodexRecords {
  readonly root: string;
  private readonly now: () => number;
  private readonly fileCache = new Map<string, Tail>();
  constructor({ home = os.homedir(), root = process.env.CODEX_HOME || path.join(home, '.codex'), now = Date.now }: CodexRecordsOptions = {}) {
    this.root = path.resolve(root); this.now = now;
  }

  async cachedTail(file: string) {
    const stat = await fs.stat(file);
    const previous = this.fileCache.get(file);
    if (previous?.size === stat.size && previous.modifiedAt === stat.mtimeMs) return previous;
    const value = { ...await tail(file), size: stat.size };
    this.fileCache.set(file, value);
    return value;
  }

  async rolloutState(file: string): Promise<RolloutTurn> {
    const data = await this.cachedTail(file);
    let status: string | undefined, turnId: string | undefined, statusAt = 0, lastUserAt = 0, lastProgressAt = 0;
    const requests = new Map<string, { at: number; kind: 'approval' | 'question' }>();
    for (const line of data.text.split('\n')) {
      let record: unknown;
      try { record = JSON.parse(line); } catch { continue; } // A live writer can leave a partial line.
      if (!isRecord(record)) continue;
      const payload = isRecord(record.payload) ? record.payload : {};
      const at = Date.parse(typeof record.timestamp === 'string' ? record.timestamp : '') || 0;
      if (record.type === 'event_msg') {
        if (['task_started', 'task_complete', 'turn_aborted'].includes(typeof payload.type === 'string' ? payload.type : '')) {
          status = payload.type === 'task_started' ? 'inProgress' : payload.type === 'task_complete' ? (payload.error != null ? 'failed' : 'completed') : 'interrupted';
          turnId = typeof payload.turn_id === 'string' ? payload.turn_id : undefined;
          statusAt = at;
          requests.clear();
        }
        if (payload.type === 'user_message') lastUserAt = at;
      }
      if (record.type === 'response_item' && payload.type === 'message' && payload.role === 'user') lastUserAt = at;
      if (record.type === 'response_item') {
        if (payload.type === 'function_call' && typeof payload.call_id === 'string') {
          if (payload.name === 'request_user_input') requests.set(payload.call_id, { at, kind: 'question' });
          if (payload.name === 'request_permissions') requests.set(payload.call_id, { at, kind: 'approval' });
        }
        if (['function_call_output', 'custom_tool_call_output'].includes(typeof payload.type === 'string' ? payload.type : '')) {
          lastProgressAt = at;
          if (typeof payload.call_id === 'string') requests.delete(payload.call_id);
        }
      }
    }
    const waiting = [...requests.values()].sort((a, b) => b.at - a.at)[0];
    return { ...(waiting ? { waiting } : {}), status, ...(turnId ? { turnId } : {}), statusAt, lastUserAt, lastProgressAt, updatedAt: data.modifiedAt };
  }

  async read(kind: 'desktop' | 'cli', logData = { signals: new Map<string, TurnSignal>(), found: false }): Promise<SessionReading> {
    const now = this.now();
    let stateFile;
    try { stateFile = await newestDatabase(this.root, 'state'); }
    catch (error) { if (!hasErrorCode(error, 'ENOENT')) throw error; }
    if (!stateFile) return { sessions: [], health: `No Codex session database. Start a local Codex ${kind === 'cli' ? 'CLI session' : 'desktop chat'}.` };
    const state = readDatabase(stateFile, db => {
      const columns = new Set(db.prepare('PRAGMA table_info(threads)').all().map(c => c.name));
      if (!['id', 'title', 'cwd', 'source', 'rollout_path', 'updated_at', 'archived'].every(c => columns.has(c))) throw Error('Unsupported Codex database.');
      const extras = ['name', 'originator', 'updated_at_ms', 'project_id'].filter(c => columns.has(c));
      const values = db.prepare(`SELECT id, title, cwd, source, rollout_path, updated_at${extras.map(c => `, ${c}`).join('')} FROM threads WHERE archived = 0`).all();
      const rows = values.flatMap(value => { const row = parseThread(value); return row ? [row] : []; });
      return { rows, invalidRows: values.length - rows.length, projects: readProjectCatalog(db) };
    });
    const { rows, projects, invalidRows } = state;
    const selected: ThreadRow[] = [];
    for (const row of rows) {
      if (kind === 'cli') { if (row.source === 'cli' && row.id) selected.push(row); continue; }
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
      if (/codex desktop/i.test(origin || '')) selected.push(row);
    }
    const turns = new Map<string, HistoryTurn>();
    let historyHealth = '';
    try {
      const historyFile = await newestDatabase(this.root, 'thread_history');
      if (historyFile) readDatabase(historyFile, db => {
        const query = db.prepare('SELECT status, turn_id FROM thread_turns WHERE thread_id = ? ORDER BY rollout_ordinal DESC LIMIT 1');
        for (const row of selected) {
          const turn = query.get(row.id);
          if (turn && typeof turn.status === 'string') turns.set(row.id, { status: turn.status, ...(typeof turn.turn_id === 'string' ? { turnId: turn.turn_id } : {}) });
        }
      });
    } catch {
      turns.clear();
      historyHealth = ' Turn history is unavailable; using session records.';
    }
    const sessions: SessionReading['sessions'] = [];
    for (const row of selected) {
      let recorded: RolloutTurn | undefined;
      try { recorded = await this.rolloutState(row.rollout_path); }
      catch { recorded = undefined; }
      const updatedAt = epochMilliseconds(Math.max(0, row.updated_at_ms || row.updated_at * 1000, recorded?.updatedAt || 0));
      const signal: TurnSignal = kind === 'cli' ? { ...(recorded?.waiting ? { waiting: recorded.waiting } : {}), lastUserAt: recorded?.lastUserAt || 0, lastProgressAt: 0 } : logData.signals.get(row.id) || { lastUserAt: 0, lastProgressAt: 0 };
      const history = turns.get(row.id);
      const sameTurn = recorded?.turnId && history?.turnId === recorded.turnId;
      let status = history?.status || recorded?.status;
      let conflict = Boolean(history && recorded?.status && history.status !== recorded.status && !sameTurn);
      if (sameTurn && recorded && recorded.status !== 'inProgress') {
        if (history?.status === 'inProgress') status = recorded.status;
        else if (history?.status !== recorded.status) conflict = true;
      }
      if (history && ['completed', 'interrupted', 'failed'].includes(history.status) && recorded && signal.lastUserAt > recorded.statusAt) conflict = true;
      const state: ReturnType<typeof resolveState> = conflict ? { state: 'unknown', detail: 'Turn records conflict; current state cannot be confirmed.' } : !recorded ? { state: 'unknown', detail: 'The session record cannot be read.' } : resolveState({
        ...recorded, ...signal, status, updatedAt,
        lastUserAt: Math.max(recorded.lastUserAt || 0, signal.lastUserAt || 0),
        // CLI requests clear by call ID. Desktop questions stay open during tool work.
        lastProgressAt: kind === 'cli' || signal.waiting?.kind === 'question' ? 0 : recorded.lastProgressAt || 0
      }, now);
      const title = [row.name, row.title].find(value => typeof value === 'string' && value.trim()) || 'Untitled session';
      const cwd = typeof row.cwd === 'string' ? row.cwd : '';
      const codexProject = findCodexProject(row, projects);
      const project = codexProject?.name || (isCodexScratchWorkspace(cwd) ? 'No workspace' : path.basename(cwd.replaceAll('\\', '/')) || cwd);
      const localProjectId = row.project_id == null ? undefined : String(row.project_id);
      const projectId = localProjectId ? `codex:${localProjectId}` : undefined;
      sessions.push({ id: row.id, title: title.replace(/\s+/g, ' ').trim().slice(0, 160),
        project, ...(projectId ? { projectId } : {}), workspace: cwd, updatedAt, ...state });
    }
    // Release cached logs and rollouts which are no longer used.
    const activeRollouts = new Set(selected.map(row => row.rollout_path));
    for (const [file, value] of this.fileCache) if (!activeRollouts.has(file) && now - value.modifiedAt > 2 * 86_400_000) this.fileCache.delete(file);
    return { sessions, health: (kind === 'cli' ? 'Reading local CLI session records. Approval prompts without recorded requests cannot be detected.' : logData.found ? 'Reading local session records. State is based on the last recorded event.' :
      'Reading session records. Desktop logs are missing; approval and question detection is limited.') + historyHealth + (invalidRows ? ' Some session rows have invalid timestamps and were skipped.' : '') };
  }
}

export { CodexRecords };
