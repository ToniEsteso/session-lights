import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { spawn } from 'node:child_process';
import { CodexRecords } from './codex-records.js';
import { findCodex } from './codex-runtime.js';
import type { CodexRecordsOptions } from './codex-records.js';
import type { SessionAdapter } from '../shared/contracts.js';

// Use literal arguments at each shell boundary. Session records are external input.
function singleQuote(value: string) { return `'${value.replaceAll("'", "''")}'`; }
function shellQuote(value: string) { return `'${value.replaceAll("'", "'\\''")}'`; }
async function launchTerminal({ binary, id, workspace, root }: { binary: string; id: string; workspace: string; root: string }) {
  let command: string, args: string[];
  if (process.platform === 'win32') {
    command = path.join(process.env.SystemRoot || 'C:/Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    args = ['-NoProfile', '-NonInteractive', '-Command', `$ErrorActionPreference = 'Stop'; Start-Process -FilePath ${singleQuote(binary)} -ArgumentList @('resume', ${singleQuote(id)}) -WorkingDirectory ${singleQuote(workspace)}`];
  } else if (process.platform === 'darwin') {
    command = '/usr/bin/osascript';
    const script = `cd ${shellQuote(workspace)} && CODEX_HOME=${shellQuote(root)} ${shellQuote(binary)} resume ${shellQuote(id)}`;
    const appleString = `"${script.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('\n', '\\n').replaceAll('\r', '\\r')}"`;
    args = ['-e', `tell application "Terminal" to do script ${appleString}`, '-e', 'tell application "Terminal" to activate'];
  } else {
    command = 'x-terminal-emulator'; args = ['-e', binary, 'resume', id];
  }
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { cwd: workspace, env: { ...process.env, CODEX_HOME: root }, windowsHide: true, stdio: 'ignore' });
    child.once('error', () => reject(Error('Cannot open a terminal for Codex CLI.')));
    child.once('exit', code => code === 0 ? resolve() : reject(Error('Cannot open a terminal for Codex CLI.')));
  });
}
class CodexCliAdapter implements SessionAdapter {
  readonly id = 'codex-cli';
  readonly name = 'Codex CLI';
  private readonly records: CodexRecords;
  constructor(options: CodexRecordsOptions = {}) { this.records = new CodexRecords(options); }
  read() { return this.records.read('cli'); }
  async open(id: string) {
    if (!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)) throw Error('Invalid Codex CLI session ID.');
    const session = (await this.read()).sessions.find(session => session.id === id);
    if (!session) throw Error('The Codex CLI session is no longer available.');
    const workspace = session.workspace;
    if (!workspace || !path.isAbsolute(workspace)) throw Error('The session workspace is unavailable.');
    try { if (!(await fs.stat(workspace)).isDirectory()) throw Error('Not a directory.'); }
    catch { throw Error('The session workspace is unavailable.'); }
    await launchTerminal({ binary: await findCodex('cli'), id, workspace, root: this.records.root });
  }
}
export { CodexCliAdapter };
