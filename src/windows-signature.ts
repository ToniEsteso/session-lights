import { execFile } from 'node:child_process';
import * as path from 'node:path';
import { isRecord } from './shared/validation.js';

// Use the installed app as the publisher anchor. Never accept a failed tool run.
export async function verifyWindowsInstaller(file: string, installed = process.execPath): Promise<void> {
  const systemRoot = process.env.SystemRoot;
  if (!systemRoot || !path.win32.isAbsolute(systemRoot) || !path.isAbsolute(file) || !path.isAbsolute(installed)) throw Error('Signature verification is unavailable.');
  const command = [
    "$ErrorActionPreference = 'Stop'",
    "$ProgressPreference = 'SilentlyContinue'",
    '[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()',
    '$installed = Get-AuthenticodeSignature -LiteralPath $env:SESSION_LIGHTS_SIGNATURE_INSTALLED',
    '$download = Get-AuthenticodeSignature -LiteralPath $env:SESSION_LIGHTS_SIGNATURE_DOWNLOAD',
    '@{ installedStatus = [int]$installed.Status; downloadStatus = [int]$download.Status; installedPublisher = $installed.SignerCertificate.Subject; downloadPublisher = $download.SignerCertificate.Subject } | ConvertTo-Json -Compress'
  ].join('; ');
  const output = await new Promise<string>((resolve, reject) => {
    execFile(path.win32.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
      ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(command, 'utf16le').toString('base64')],
      { windowsHide: true, timeout: 30_000, maxBuffer: 16 * 1024, encoding: 'utf8',
        env: { ...process.env, PSModulePath: '', SESSION_LIGHTS_SIGNATURE_INSTALLED: installed, SESSION_LIGHTS_SIGNATURE_DOWNLOAD: file } },
      (error, stdout, stderr) => { if (error || stderr.trim()) reject(Error('Signature verification failed.')); else resolve(stdout); });
  });
  const result: unknown = JSON.parse(output.replace(/^\uFEFF/, ''));
  if (!isRecord(result) || result.installedStatus !== 0 || result.downloadStatus !== 0 ||
      typeof result.installedPublisher !== 'string' || !result.installedPublisher || result.downloadPublisher !== result.installedPublisher) {
    throw Error('The update publisher could not be verified.');
  }
}
