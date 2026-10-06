import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { CodexUsage } from './codex-usage.js';
import { CodexRecords } from './codex-records.js';
import { resumeCodexCli } from './codex-terminal.js';
import { hasErrorCode } from '../shared/validation.js';
import type { SessionAdapter, SessionReading, UsageDefinition, OpenExternal } from '../shared/contracts.js';
import type { TurnSignal } from '../core.js';
import type { CodexUsageOptions } from './codex-usage.js';

export interface CodexOptions { home?: string; root?: string; logs?: string; now?: () => number; usageOptions?: CodexUsageOptions }
function desktopLogs(platform: NodeJS.Platform, home: string) {
  if (platform === 'win32') return path.join(process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), 'Codex', 'Logs');
  if (platform === 'darwin') return path.join(home, 'Library', 'Logs', 'com.openai.codex');
  return path.join(home, '.config', 'Codex', 'logs');
}

function parseLog(text: string, signals: Map<string, TurnSignal>) {
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
      if ((kind === 'approval' || kind === 'question') && (!signal.waiting || at > signal.waiting.at)) signal.waiting = { at, kind };
    }
    if (response && /\bmethod=turn\/(start|steer)\b/.test(line) && line.includes('errorCode=null')) signal.lastUserAt = Math.max(at, signal.lastUserAt);
    signals.set(id, signal);
  }
}

class CodexAdapter implements SessionAdapter {
  readonly id = 'codex';
  readonly name = 'Codex';
  readonly usage: UsageDefinition;
  private readonly records: CodexRecords;
  private readonly logs: string;
  private readonly now: () => number;
  private usageReader: CodexUsage | undefined;
  private readonly usageOptions: CodexUsageOptions | undefined;
  constructor({ home = os.homedir(), root = process.env.CODEX_HOME || path.join(home, '.codex'),
    logs = desktopLogs(process.platform, home), now = Date.now, usageOptions }: CodexOptions = {}) {
    this.records = new CodexRecords({ root, now }); this.logs = logs; this.now = now;
    this.usage = { scope: 'Account-wide usage', windows: [
      { id: 'fiveHour', label: '5h', title: '5-hour limit' }, { id: 'weekly', label: 'Weekly', title: 'Weekly limit' }
    ] };
    this.usageOptions = usageOptions;
  }

  async readUsage() {
    const reader = this.usageReader ||= new CodexUsage(this.usageOptions);
    return reader.read();
  }
  close() { this.usageReader?.close(); this.usageReader = undefined; }
  async open(id: string, openExternal: OpenExternal) {
    if (!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)) throw Error('Invalid Codex chat link.');
    const session = (await this.read()).sessions.find(session => session.id === id);
    if (!session) throw Error('The Codex session is no longer available.');
    if (session.source === 'CLI') {
      await resumeCodexCli(id, session.workspace, this.records.root);
      return;
    }
    try { await openExternal(`codex://threads/${id}`); }
    catch { throw Error('Cannot open Codex. Check that the desktop app is installed.'); }
  }

  async readSignals(now: number) {
    const signals = new Map<string, TurnSignal>();
    let found = false;
    // Codex creates date folders in UTC. Include yesterday across midnight.
    for (const at of [now - 86_400_000, now]) {
      const parts = new Date(at).toISOString().slice(0, 10).split('-');
      const dir = path.join(this.logs, ...parts);
      let files;
      try { files = await fs.readdir(dir); } catch (error) { if (hasErrorCode(error, 'ENOENT')) continue; throw error; }
      for (const name of files.filter(name => name.endsWith('.log'))) {
        found = true;
        parseLog((await this.records.cachedTail(path.join(dir, name))).text, signals);
      }
    }
    return { signals, found };
  }

  async read(): Promise<SessionReading> {
    let logData;
    try { logData = await this.readSignals(this.now()); }
    catch { logData = { signals: new Map<string, TurnSignal>(), found: false }; }
    return this.records.read(logData);
  }
}
export { CodexAdapter };
