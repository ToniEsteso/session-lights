import { accessSync, constants, readdirSync, readFileSync } from 'node:fs';
import * as path from 'node:path';

// Resolve without loading Electron's package. Its loader can download a missing
// runtime, which hides the original file-access or installation failure.
export function electronBinary(): string {
  let target = path.resolve(__dirname, '..', '..', 'node_modules', 'electron');
  try {
    const packageRoot = path.dirname(require.resolve('electron'));
    target = path.join(packageRoot, 'path.txt');
    const executable = readFileSync(target, 'utf8').trim();
    if (!executable) throw Error('The executable path is empty.');
    const runtime = process.env.ELECTRON_OVERRIDE_DIST_PATH || path.join(packageRoot, 'dist');
    target = path.join(runtime, executable);
    accessSync(target, constants.R_OK | constants.X_OK);
    // Electron also needs the adjacent DLLs, data files, and resource packs.
    // An executable alone does not prove that the runtime is readable.
    for (const entry of readdirSync(runtime, { withFileTypes: true })) {
      if (entry.isFile()) {
        target = path.join(runtime, entry.name);
        accessSync(target, constants.R_OK);
      }
    }
    return path.join(runtime, executable);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw Error(`Cannot read the Electron runtime at ${target}. ${detail}\nRun dependency setup in this checkout. If setup passes, check read and execute access to this runtime folder.`);
  }
}
