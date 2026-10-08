import { spawn } from 'node:child_process';
import * as os from 'node:os';
import * as path from 'node:path';
import type { UsageReading, UsageWindow } from '../shared/contracts.js';
import { epochMilliseconds, unixSeconds } from '../shared/time.js';

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
// Claude prints the account limits for its `/usage` command. It makes no model request.
const LIMITS: [string, string, RegExp][] = [
  ['fiveHour', '5h', /^Current session:\s*(\d+(?:\.\d+)?)% used(?:\s*·\s*resets\s+(.+))?$/m],
  ['weekly', 'Weekly', /^Current week \(all models\):\s*(\d+(?:\.\d+)?)% used(?:\s*·\s*resets\s+(.+))?$/m]
];

function zoneParts(at: number, zone: string) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: 'numeric',
    day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' }).formatToParts(at);
  const part = (type: string) => Number(parts.find(item => item.type === type)?.value);
  return { year: part('year'), month: part('month'), day: part('day'), hour: part('hour'), minute: part('minute'), second: part('second') };
}
// Convert a wall-clock time in an IANA zone to epoch milliseconds. Two passes handle offset changes.
function zonedTime(year: number, month: number, day: number, hour: number, minute: number, zone: string) {
  const wall = Date.UTC(year, month - 1, day, hour, minute);
  let at = wall;
  for (let pass = 0; pass < 2; pass++) {
    const p = zoneParts(at, zone);
    at += wall - Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  }
  return at;
}

/** Read "Oct 8, 1:39pm (Europe/Madrid)" or "1:39pm (Europe/Madrid)". Claude omits the year. */
export function resetTime(text: string, now: number): number | undefined {
  const match = text.match(/^(?:([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+)?(\d{1,2})(?::(\d{2}))?\s*([ap])m\s*\(([^)]+)\)\s*$/i);
  if (!match) return;
  const [, monthName, dayText, hourText, minuteText, meridiem, zone] = match;
  let hour = Number(hourText) % 12;
  if (meridiem!.toLowerCase() === 'p') hour += 12;
  const minute = Number(minuteText || 0);
  try {
    const today = zoneParts(now, zone!);
    const month = monthName ? MONTHS.indexOf(monthName.toLowerCase()) + 1 : today.month;
    if (!month) return;
    const day = dayText ? Number(dayText) : today.day;
    let at = zonedTime(today.year, month, day, hour, minute, zone!);
    // A reset is never far in the past. A past date means the next year, or tomorrow for a time only.
    if (at < now - 3_600_000) at = monthName ? zonedTime(today.year + 1, month, day, hour, minute, zone!) : at + 86_400_000;
    return Number.isFinite(at) ? at : undefined;
  } catch { return; }
}

export function parseUsage(text: string, now: number): UsageReading {
  const windows: UsageWindow[] = [];
  for (const [id, label, pattern] of LIMITS) {
    const match = text.match(pattern);
    if (!match) continue;
    const used = Number(match[1]);
    if (!Number.isFinite(used)) continue;
    const reset = match[2] ? resetTime(match[2].trim(), now) : undefined;
    windows.push({ id, label, remainingPercent: Math.max(0, Math.min(100, 100 - used)),
      ...(reset ? { resetsAt: unixSeconds(Math.floor(reset / 1000)) } : {}) });
  }
  return { windows, message: windows.length ? '' : 'Usage limits unavailable for this account.', updatedAt: epochMilliseconds(now) };
}

function powershellQuote(value: string) { return `'${value.replaceAll("'", "''")}'`; }

export interface ClaudeUsageOptions { binary: string; root: string; timeout?: number; now?: () => number }

/** Run `claude -p /usage` without saving a session. The reader never touches credentials. */
export async function readClaudeUsage({ binary, root, timeout = 30_000, now = Date.now }: ClaudeUsageOptions): Promise<UsageReading> {
  const args = ['-p', '/usage', '--no-session-persistence'];
  let command = binary, commandArgs = args;
  if (process.platform === 'win32' && /\.cmd$/i.test(binary)) {
    command = path.join(process.env.SystemRoot || 'C:/Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    commandArgs = ['-NoProfile', '-NonInteractive', '-Command', `& ${powershellQuote(binary)} ${args.map(powershellQuote).join(' ')}`];
  }
  const output = await new Promise<string>((resolve, reject) => {
    const child = spawn(command, commandArgs, { cwd: os.tmpdir(), env: { ...process.env, CLAUDE_CONFIG_DIR: root },
      windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    let text = '';
    const timer = setTimeout(() => { child.kill(); reject(Error('Claude usage read timed out.')); }, timeout);
    child.stdout.setEncoding('utf8').on('data', chunk => { if (text.length < 100_000) text += chunk; });
    child.once('error', () => { clearTimeout(timer); reject(Error('Cannot start Claude Code.')); });
    child.once('close', code => {
      clearTimeout(timer);
      if (code === 0) resolve(text); else reject(Error('Claude usage is unavailable. Check your Claude sign-in.'));
    });
  });
  return parseUsage(output, now());
}
