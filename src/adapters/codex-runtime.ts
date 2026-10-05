import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import type { FileHandle } from 'node:fs/promises';

async function nativeBinary(file: string) {
  let handle: FileHandle | undefined;
  try {
    handle = await fs.open(file, 'r');
    const header = Buffer.alloc(4); await handle.read(header, 0, 4, 0);
    return header.toString('ascii', 0, 2) === 'MZ' || header.equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46])) ||
      [0xfeedface, 0xfeedfacf, 0xcefaedfe, 0xcffaedfe, 0xcafebabe, 0xbebafeca].includes(header.readUInt32BE());
  } catch { return false; }
  finally { await handle?.close(); }
}

async function findCodex(prefer: 'desktop' | 'cli' = 'desktop') {
  if (prefer === 'desktop' && process.env.SESSION_LIGHTS_CODEX_BINARY) {
    const file = process.env.SESSION_LIGHTS_CODEX_BINARY;
    if (path.isAbsolute(file) && await nativeBinary(file)) return file;
    throw Error('The selected Codex runtime is unavailable.');
  }
  const desktopCandidates: string[] = [];
  const candidates: string[] = [];
  if (process.platform === 'win32') {
    const root = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'OpenAI', 'Codex', 'bin');
    try {
      const versions = await Promise.all((await fs.readdir(root, { withFileTypes: true })).filter(entry => entry.isDirectory())
        .map(async entry => ({ dir: path.join(root, entry.name), time: (await fs.stat(path.join(root, entry.name))).mtimeMs })));
      versions.sort((a, b) => b.time - a.time);
      desktopCandidates.push(...versions.map(version => path.join(version.dir, 'codex.exe')));
    } catch { /* Try the CLI installation next. */ }
  } else if (process.platform === 'darwin') {
    desktopCandidates.push('/Applications/Codex.app/Contents/Resources/codex', path.join(os.homedir(), 'Applications', 'Codex.app', 'Contents', 'Resources', 'codex'));
  }
  if (prefer === 'desktop') candidates.push(...desktopCandidates);
  const triple = process.platform === 'win32' ? `${process.arch === 'arm64' ? 'aarch64' : 'x86_64'}-pc-windows-msvc` :
    `${process.arch === 'arm64' ? 'aarch64' : 'x86_64'}-${process.platform === 'darwin' ? 'apple-darwin' : 'unknown-linux-musl'}`;
  const executable = process.platform === 'win32' ? 'codex.exe' : 'codex';
  const directories = (process.env.PATH || '').split(path.delimiter).filter(dir => path.isAbsolute(dir));
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
  for (const file of [...new Set(candidates)]) {
    const isDesktop = desktopCandidates.some(candidate => process.platform === 'win32' ? candidate.toLowerCase() === file.toLowerCase() : candidate === file);
    if (prefer === 'cli' && isDesktop) continue;
    if (path.isAbsolute(file) && await nativeBinary(file)) return file;
  }
  throw Error(prefer === 'cli' ? 'Codex CLI not found. Install Codex CLI and add it to PATH.' : 'Codex runtime not found. Install Codex CLI or select its runtime.');
}

export { findCodex };
