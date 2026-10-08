import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { spawn } from 'node:child_process';
import type { AdapterSession, SessionAdapter, SessionReading, SessionState, UsageDefinition, UsageReading } from '../shared/contracts.js';
import { epochMilliseconds } from '../shared/time.js';
import { readClaudeUsage } from './claude-usage.js';
import { readT3, withT3 } from './t3.js';
import { hasErrorCode, isRecord } from '../shared/validation.js';

const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const HEAD_BYTES = 64 * 1024;
const TAIL_BYTES = 512 * 1024;
const ACTIVE_AGE = 15 * 60_000;
const USAGE_AGE = 2 * 60_000;

// Claude Code records which program started a session. The CLI, the desktop app, editors, and
// hosts such as T3 Code all write the same transcripts, so one adapter reads them all.
function sourceLabel(entrypoint: string | undefined) {
  if (!entrypoint) return undefined;
  if (entrypoint === 'cli') return 'CLI';
  if (/^(claude-desktop|local-agent)/.test(entrypoint)) return 'Desktop';
  if (entrypoint === 'claude-vscode') return 'VS Code';
  if (entrypoint.startsWith('sdk')) return 'SDK';
  return undefined;
}

interface LiveSession { status: 'busy' | 'idle' | 'waiting'; waitingFor: string; at: number }

// A running Claude Code process keeps ~/.claude/sessions/<pid>.json with its live status.
// Claude removes the file on exit. A crash leaves it behind, so check that the process still runs.
async function readLive(root: string): Promise<Map<string, LiveSession>> {
  const live = new Map<string, LiveSession>();
  const folder = path.join(root, 'sessions');
  let files;
  try { files = await fs.readdir(folder); } catch { return live; }
  for (const name of files.filter(name => name.endsWith('.json'))) {
    try {
      const value: unknown = JSON.parse(await fs.readFile(path.join(folder, name), 'utf8'));
      if (!isRecord(value) || typeof value.sessionId !== 'string' || typeof value.pid !== 'number') continue;
      if (value.status !== 'busy' && value.status !== 'idle' && value.status !== 'waiting') continue;
      try { process.kill(value.pid, 0); }
      catch (error) { if (!hasErrorCode(error, 'EPERM')) continue; }
      const at = typeof value.statusUpdatedAt === 'number' ? value.statusUpdatedAt : 0;
      const known = live.get(value.sessionId);
      if (known && known.at > at) continue;
      live.set(value.sessionId, { status: value.status, waitingFor: typeof value.waitingFor === 'string' ? value.waitingFor : '', at });
    } catch { /* A file that is being replaced or damaged does not hide other sessions. */ }
  }
  return live;
}

function withLive(session: AdapterSession, live: LiveSession | undefined): AdapterSession {
  if (!live) return session;
  const updatedAt = epochMilliseconds(Math.max(session.updatedAt, live.at));
  if (live.status === 'busy') return { ...session, state: 'working', detail: '', updatedAt };
  if (live.status === 'waiting') {
    const detail = live.waitingFor === 'sandbox request' ? 'Sandbox approval needed'
      : live.waitingFor === 'input needed' ? 'Answer needed' : 'Waiting for you';
    return { ...session, state: 'waiting', detail, updatedAt };
  }
  // The process is idle. A recorded failure stays visible; a missing completion marker does not.
  return session.state === 'error' || session.state === 'idle' ? session : { ...session, state: 'idle', detail: '', updatedAt };
}

function textContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.filter(isRecord).filter(block => block.type === 'text' && typeof block.text === 'string')
    .map(block => block.text).join(' ');
}

// Read complete lines only. A writer can be in the middle of its next record.
function entries(buffer: Buffer, startsMidFile = false, endsMidFile = false): Record<string, unknown>[] {
  let source = buffer.toString('utf8');
  if (startsMidFile) source = source.slice(source.indexOf('\n') + 1);
  if (endsMidFile) source = source.slice(0, source.lastIndexOf('\n') + 1);
  return source.split('\n').flatMap(line => {
    try { const value: unknown = JSON.parse(line); return isRecord(value) ? [value] : []; }
    catch { return []; }
  });
}

async function readSession(file: string, id: string): Promise<AdapterSession | undefined> {
  const handle = await fs.open(file, 'r');
  try {
    const stat = await handle.stat();
    const head = Buffer.alloc(Math.min(stat.size, HEAD_BYTES));
    const tail = Buffer.alloc(Math.min(stat.size, TAIL_BYTES));
    const headRead = await handle.read(head, 0, head.length, 0);
    const offset = Math.max(0, stat.size - TAIL_BYTES);
    const tailRead = await handle.read(tail, 0, tail.length, offset);
    const first = entries(head.subarray(0, headRead.bytesRead), false, stat.size > head.length);
    const last = entries(tail.subarray(0, tailRead.bytesRead), offset > 0);
    if (first.some(entry => entry.isSidechain === true)) return;
    let customTitle = '', aiTitle = '', summary = '', prompt = '', workspace = '';
    let model: string | undefined, entrypoint: string | undefined;
    let state: SessionState = 'unknown';
    let detail = 'The transcript does not confirm a turn state.';
    let updatedAt = 0;
    let stateAt = 0;
    let hasReply = false;
    const questions = new Set<string>();
    for (const entry of [...first, ...last]) {
      if (entry.isSidechain === true || (typeof entry.sessionId === 'string' && entry.sessionId !== id)) continue;
      if (typeof entry.cwd === 'string') workspace = entry.cwd;
      if (typeof entry.entrypoint === 'string') entrypoint = entry.entrypoint;
      if (entry.type === 'assistant' && entry.isApiErrorMessage !== true && isRecord(entry.message) &&
          typeof entry.message.model === 'string' && entry.message.model.trim() && !entry.message.model.trim().startsWith('<')) {
        model = entry.message.model.trim();
        hasReply = true;
      }
      if (entry.type === 'custom-title' && typeof entry.customTitle === 'string') customTitle = entry.customTitle;
      if (entry.type === 'ai-title' && typeof entry.aiTitle === 'string') aiTitle = entry.aiTitle;
      if (entry.type === 'summary' && typeof entry.summary === 'string') summary = entry.summary;
      if (entry.type === 'user' && entry.isMeta !== true && entry.isCompactSummary !== true && isRecord(entry.message)) {
        const text = textContent(entry.message.content).trim();
        if (!prompt && text && !text.startsWith('<') && !text.startsWith('[Request interrupted by user')) prompt = text;
      }
    }
    // State comes from the tail, so an old head record cannot mask missing activity.
    for (const entry of last) {
      if (entry.isSidechain === true || (typeof entry.sessionId === 'string' && entry.sessionId !== id)) continue;
      const timestamp = typeof entry.timestamp === 'string' ? Date.parse(entry.timestamp) : NaN;
      if (Number.isFinite(timestamp)) updatedAt = Math.max(updatedAt, timestamp);
      if ((entry.type === 'user' || entry.type === 'assistant') && isRecord(entry.message)) {
        const content = entry.message.content;
        const blocks = Array.isArray(content) ? content.filter(isRecord) : [];
        if (entry.type === 'user') {
          if (entry.isMeta === true || entry.isCompactSummary === true) continue;
          stateAt = Number.isFinite(timestamp) ? timestamp : 0;
          const text = textContent(content);
          if (text.startsWith('[Request interrupted by user')) {
            questions.clear(); state = 'idle'; detail = 'The last turn stopped.';
          } else {
            if (text) questions.clear();
            for (const block of blocks) {
              if (block.type === 'tool_result' && typeof block.tool_use_id === 'string') questions.delete(block.tool_use_id);
            }
            state = questions.size ? 'waiting' : 'working';
            detail = questions.size ? 'Answer needed' : '';
          }
        } else if (entry.isApiErrorMessage === true) {
          stateAt = Number.isFinite(timestamp) ? timestamp : 0;
          questions.clear(); state = 'error'; detail = '';
        } else {
          stateAt = Number.isFinite(timestamp) ? timestamp : 0;
          for (const block of blocks) {
            if (block.type === 'tool_use' && block.name === 'AskUserQuestion' && typeof block.id === 'string') questions.add(block.id);
          }
          const stop = entry.message.stop_reason;
          if (stop === 'end_turn' || stop === 'stop_sequence' || stop === 'max_tokens') {
            questions.clear(); state = 'idle'; detail = '';
          } else if (questions.size) {
            state = 'waiting'; detail = 'Answer needed';
          } else if (stop === 'tool_use' || blocks.some(block => block.type === 'tool_use' || block.type === 'thinking')) {
            state = 'working'; detail = '';
          } else {
            state = 'unknown'; detail = 'The transcript does not confirm that the turn finished.';
          }
        }
      } else if (entry.type === 'system' && entry.subtype === 'turn_duration') {
        stateAt = Number.isFinite(timestamp) ? timestamp : 0;
        questions.clear(); state = 'idle'; detail = '';
      } else if (entry.type === 'progress' && Number.isFinite(timestamp)) {
        stateAt = timestamp;
      }
    }
    const title = (customTitle || aiTitle || summary || prompt).replace(/\s+/g, ' ').trim().slice(0, 200);
    // Commands such as /usage run in a session with no prompt and no model reply. It is not a chat.
    if (!title && !prompt && !hasReply) return;
    if ((state === 'working' || state === 'waiting') && (!stateAt || Date.now() - stateAt >= ACTIVE_AGE)) {
      state = 'unknown'; detail = 'No recent activity';
    }
    // mtime is a recorded file activity time, never the poll time.
    const source = sourceLabel(entrypoint);
    return { id, title: title || `Claude Code ${id.slice(0, 8)}`, workspace,
      ...(source ? { source } : {}), ...(model ? { model } : {}),
      state, detail, updatedAt: epochMilliseconds(updatedAt || stat.mtimeMs) };
  } finally { await handle.close(); }
}

function powershellQuote(value: string) { return `'${value.replaceAll("'", "''")}'`; }
function shellQuote(value: string) { return `'${value.replaceAll("'", "'\\''")}'`; }

async function findClaude(): Promise<string> {
  const override = process.env.SESSION_LIGHTS_CLAUDE_BINARY;
  const directories = (process.env.PATH || '').split(path.delimiter).filter(dir => path.isAbsolute(dir));
  directories.push(path.join(os.homedir(), '.local', 'bin'));
  if (process.platform === 'darwin') directories.push('/opt/homebrew/bin', '/usr/local/bin');
  const names = process.platform === 'win32' ? ['claude.exe', 'claude.cmd'] : ['claude'];
  const candidates = override ? [override] : directories.flatMap(dir => names.map(name => path.join(dir, name)));
  for (const file of [...new Set(candidates)]) {
    if (!path.isAbsolute(file) || (process.platform === 'win32' && !/\.(exe|cmd)$/i.test(file))) continue;
    try {
      if (!(await fs.stat(file)).isFile()) continue;
      await fs.access(file, process.platform === 'win32' ? fs.constants.F_OK : fs.constants.X_OK);
      return file;
    } catch { /* Try the next installed launcher. */ }
  }
  throw Error('Claude Code not found. Install Claude Code and add it to PATH.');
}

async function launchTerminal(binary: string, id: string, workspace: string, root: string) {
  let command: string, args: string[];
  if (process.platform === 'win32') {
    command = path.join(process.env.SystemRoot || 'C:/Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    const script = `Set-Location -LiteralPath ${powershellQuote(workspace)}; $env:CLAUDE_CONFIG_DIR = ${powershellQuote(root)}; & ${powershellQuote(binary)} '--resume' ${powershellQuote(id)}`;
    const encoded = Buffer.from(script, 'utf16le').toString('base64');
    args = ['-NoProfile', '-NonInteractive', '-Command', `$ErrorActionPreference = 'Stop'; Start-Process -FilePath ${powershellQuote(command)} -ArgumentList '-NoProfile -NoExit -EncodedCommand ${encoded}'`];
  } else if (process.platform === 'darwin') {
    command = '/usr/bin/osascript';
    const script = `cd ${shellQuote(workspace)} && CLAUDE_CONFIG_DIR=${shellQuote(root)} ${shellQuote(binary)} --resume ${shellQuote(id)}`;
    const appleString = `"${script.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('\n', '\\n').replaceAll('\r', '\\r')}"`;
    args = ['-e', `tell application "Terminal" to do script ${appleString}`, '-e', 'tell application "Terminal" to activate'];
  } else {
    command = 'x-terminal-emulator'; args = ['-e', binary, '--resume', id];
  }
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { cwd: workspace, env: { ...process.env, CLAUDE_CONFIG_DIR: root }, windowsHide: true, stdio: 'ignore' });
    child.once('error', () => reject(Error('Cannot open a terminal for Claude Code.')));
    child.once('exit', code => code === 0 ? resolve() : reject(Error('Cannot open a terminal for Claude Code.')));
  });
}

export class ClaudeCodeAdapter implements SessionAdapter {
  readonly id = 'claude-code';
  readonly name = 'Claude';
  readonly usage: UsageDefinition = { scope: 'Account-wide usage', windows: [
    { id: 'fiveHour', label: '5h', title: '5-hour limit' }, { id: 'weekly', label: 'Weekly', title: 'Weekly limit' }
  ] };
  private readonly root: string;
  private readonly t3: string | undefined;
  private usageRead: { at: number; reading: UsageReading } | undefined;
  private usagePending: Promise<UsageReading> | undefined;
  constructor({ root = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), t3 }: { root?: string; t3?: string | undefined } = {}) {
    this.root = path.resolve(root); this.t3 = t3;
  }
  async read(): Promise<SessionReading> {
    const projects = path.join(this.root, 'projects');
    let directories;
    try { directories = await fs.readdir(projects, { withFileTypes: true }); }
    catch (error) {
      return { sessions: [], health: hasErrorCode(error, 'ENOENT') ? 'No local Claude Code sessions found.' : 'Cannot read Claude Code session folders.' };
    }
    const live = await readLive(this.root);
    const t3 = readT3(this.t3);
    const sessions = new Map<string, AdapterSession>();
    let unreadable = 0;
    for (const directory of directories.filter(entry => entry.isDirectory())) {
      const folder = path.join(projects, directory.name);
      let files;
      try { files = await fs.readdir(folder, { withFileTypes: true }); }
      catch { unreadable++; continue; }
      for (const file of files.filter(entry => entry.isFile() && entry.name.endsWith('.jsonl'))) {
        const id = file.name.slice(0, -6);
        if (!UUID.test(id)) continue;
        try {
          const session = await readSession(path.join(folder, file.name), id);
          if (session && (!sessions.has(id) || session.updatedAt > sessions.get(id)!.updatedAt)) sessions.set(id, session);
        } catch { unreadable++; }
      }
    }
    return { sessions: [...sessions.values()].flatMap(session => withT3(withLive(session, live.get(session.id)), t3.find('claude', session.id)) ?? []),
      health: `A running Claude Code process reports its live state. Other sessions use the last recorded event.${unreadable ? ` Cannot read ${unreadable} records or folders.` : ''}` };
  }
  // `claude /usage` takes seconds to start. Share one run and keep its result for a short time.
  async readUsage(): Promise<UsageReading> {
    if (this.usageRead && Date.now() - this.usageRead.at < USAGE_AGE) return this.usageRead.reading;
    this.usagePending ||= (async () => {
      try {
        const reading = await readClaudeUsage({ binary: await findClaude(), root: this.root });
        if (reading.windows.length) this.usageRead = { at: Date.now(), reading };
        return reading;
      } finally { this.usagePending = undefined; }
    })();
    return this.usagePending;
  }
  async open(id: string) {
    if (!UUID.test(id)) throw Error('Invalid Claude Code session ID.');
    const session = (await this.read()).sessions.find(session => session.id === id);
    if (!session) throw Error('The Claude Code session is no longer available.');
    // Report a missing installation even when old records have no workspace.
    const binary = await findClaude();
    const workspace = session.workspace;
    if (!workspace || !path.isAbsolute(workspace)) throw Error('The session workspace is unavailable.');
    try { if (!(await fs.stat(workspace)).isDirectory()) throw Error('Not a directory.'); }
    catch { throw Error('The session workspace is unavailable.'); }
    await launchTerminal(binary, id, workspace, this.root);
  }
}
