import { execFile } from 'node:child_process';
import * as path from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

// Windows uses 100–225 percent for Accessibility > Text size. This is separate
// from monitor DPI, which Electron already applies to logical window pixels.
// Matches .NET's system text reader: https://source.dot.net/System.Windows.Forms.Primitives/System/Windows/Forms/Internals/ScaleHelper.cs.html
export function scaleFromPercent(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 100 && value <= 225 ? value / 100 : 1;
}

export function scaleFromRegistry(output: string): number {
  const match = /^\s*TextScaleFactor\s+REG_DWORD\s+(0x[\da-f]+|\d+)\s*$/im.exec(output);
  return scaleFromPercent(match ? Number(match[1]) : undefined);
}

export async function readSystemTextScale(): Promise<number> {
  if (process.platform !== 'win32') return 1;
  try {
    const { stdout } = await run(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'reg.exe'),
      ['query', 'HKCU\\Software\\Microsoft\\Accessibility', '/v', 'TextScaleFactor'],
      { windowsHide: true, timeout: 1500, encoding: 'utf8' });
    return scaleFromRegistry(stdout);
  } catch {
    // A missing value means the user has not changed the default text size.
    return 1;
  }
}
