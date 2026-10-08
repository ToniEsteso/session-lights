import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import type { AdapterSession } from '../shared/contracts.js';
import { isRecord } from '../shared/validation.js';

// T3 Code runs Codex and Claude Code underneath. Each of them keeps its own records, so Session Lights
// works without T3. When T3 is installed, its database adds what the providers do not record:
// the thread title, the project, and a pending approval or question while T3 is open.
export const T3_SOURCE = 'T3 Code';
export type T3Provider = 'codex' | 'claude';
export interface T3Thread {
  title: string;
  project: string;
  projectRoot: string;
  /** The thread was deleted or archived in T3. */
  removed: boolean;
  /** The user or T3 marked the thread settled. T3 hides it from its active list. */
  settled: boolean;
  /** Set only while T3 runs. A stopped T3 leaves these counts behind. */
  waiting: 'approval' | 'question' | undefined;
  running: boolean;
}
export interface T3View { find(provider: T3Provider, providerSessionId: string): T3Thread | undefined }
const EMPTY: T3View = { find: () => undefined };
const PROVIDERS: Record<string, T3Provider> = { codex: 'codex', claudeAgent: 'claude' };

function alive(pid: unknown) {
  if (typeof pid !== 'number' || !Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; }
  catch (error) { return isRecord(error) && error.code === 'EPERM'; }
}
function text(value: unknown) { return typeof value === 'string' ? value.trim() : ''; }

// T3 keeps a release database in `userdata` and a development one in `dev`.
function databases(base: string) { return ['userdata', 'dev'].map(name => path.join(base, name)); }

function readOne(folder: string): Map<string, T3Thread> {
  const found = new Map<string, T3Thread>();
  const file = path.join(folder, 'state.sqlite');
  if (!fs.existsSync(file)) return found;
  let running = false;
  try { running = alive((JSON.parse(fs.readFileSync(path.join(folder, 'server-runtime.json'), 'utf8')) as { pid?: unknown }).pid); }
  catch { /* No runtime file means T3 is not open. */ }
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    db.exec('PRAGMA busy_timeout = 200;');
    const columns = (table: string) => new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(column => String(column.name)));
    const threads = columns('projection_threads'), runtime = columns('provider_session_runtime');
    if (!['thread_id', 'title', 'project_id'].every(name => threads.has(name)) ||
        !['thread_id', 'provider_name', 'resume_cursor_json'].every(name => runtime.has(name))) return found;
    const optional = (table: string, name: string, columnSet: Set<string>, fallback = 'NULL') => columnSet.has(name) ? `${table}.${name}` : fallback;
    const sessions = columns('projection_thread_sessions');
    const projects = columns('projection_projects');
    const rows = db.prepare(`SELECT t.thread_id AS id, t.title AS title, ${optional('t', 'deleted_at', threads)} AS deleted_at,
        ${optional('t', 'archived_at', threads)} AS archived_at, ${optional('t', 'settled_override', threads)} AS settled, ${optional('t', 'pending_approval_count', threads, '0')} AS approvals,
        ${optional('t', 'pending_user_input_count', threads, '0')} AS questions, r.provider_name AS provider, r.resume_cursor_json AS cursor,
        ${optional('s', 'status', sessions)} AS status, ${optional('p', 'title', projects)} AS project,
        ${optional('p', 'workspace_root', projects)} AS root
      FROM projection_threads t JOIN provider_session_runtime r ON r.thread_id = t.thread_id
      LEFT JOIN projection_thread_sessions s ON s.thread_id = t.thread_id
      LEFT JOIN projection_projects p ON p.project_id = t.project_id`).all();
    for (const row of rows) {
      const provider = PROVIDERS[text(row.provider)];
      if (!provider || typeof row.cursor !== 'string') continue;
      let cursor: unknown;
      try { cursor = JSON.parse(row.cursor); } catch { continue; }
      if (!isRecord(cursor)) continue;
      // Codex stores its thread ID. Claude stores the ID of the session to resume.
      const id = text(provider === 'codex' ? cursor.threadId : cursor.resume);
      if (!id) continue;
      const active = running && row.status !== 'stopped';
      found.set(`${provider}:${id.toLowerCase()}`, {
        title: text(row.title), project: text(row.project), projectRoot: text(row.root),
        removed: Boolean(row.deleted_at || row.archived_at), settled: row.settled === 'settled',
        waiting: active && Number(row.approvals) > 0 ? 'approval' : active && Number(row.questions) > 0 ? 'question' : undefined,
        running: active && row.status === 'running'
      });
    }
  } finally { db.close(); }
  return found;
}

/** Read T3 Code's database. Missing, locked, or unfamiliar data gives an empty view, never an error. */
export function readT3(base = process.env.T3CODE_HOME || path.join(os.homedir(), '.t3')): T3View {
  const merged = new Map<string, T3Thread>();
  for (const folder of databases(base)) {
    try { for (const [key, thread] of readOne(folder)) merged.set(key, thread); }
    catch { /* T3 may be writing or may use a newer layout. Provider records still work. */ }
  }
  return merged.size ? { find: (provider, id) => merged.get(`${provider}:${id.toLowerCase()}`) } : EMPTY;
}

/**
 * Add T3 details to a session that a provider reported. Returns undefined for a thread that T3 no longer lists:
 * deleted, archived, or settled. New activity makes T3 unsettle a thread, and a turn that runs or waits keeps it listed.
 */
export function withT3(session: AdapterSession, thread: T3Thread | undefined): AdapterSession | undefined {
  if (!thread) return session;
  if (thread.removed || (thread.settled && !thread.running && !thread.waiting)) return undefined;
  const next: AdapterSession = { ...session, source: T3_SOURCE };
  if (thread.title && thread.title !== 'New thread') next.title = thread.title.replace(/\s+/g, ' ').slice(0, 200);
  if (thread.project) next.project = thread.project;
  if (thread.projectRoot) next.projectRoot = thread.projectRoot;
  if (thread.waiting) { next.state = 'waiting'; next.detail = thread.waiting === 'approval' ? 'Approval needed' : 'Answer needed'; }
  else if (thread.running && session.state !== 'waiting') { next.state = 'working'; next.detail = ''; }
  return next;
}
