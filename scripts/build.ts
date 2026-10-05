import { cp, mkdir, readdir } from 'node:fs/promises';
import * as path from 'node:path';
import { build } from 'esbuild';

async function main(): Promise<void> {
  const root = path.resolve(__dirname, '..', '..');
  const output = path.join(root, 'build', 'src');
  const ui = path.join(output, 'ui');
  await mkdir(ui, { recursive: true });
  for (const entry of await readdir(path.join(root, 'src', 'ui'))) {
    if (/\.(html|css)$/.test(entry)) await cp(path.join(root, 'src', 'ui', entry), path.join(ui, entry));
  }
  await build({ entryPoints: [path.join(root, 'src', 'ui', 'renderer.ts'), path.join(root, 'src', 'ui', 'tooltip.ts')],
    outdir: ui, bundle: true, platform: 'browser', format: 'iife', target: 'es2022', sourcemap: true });
  // Sandboxed Electron preloads can require Electron, but cannot load local modules.
  await build({ entryPoints: [path.join(root, 'src', 'preload.ts'), path.join(root, 'src', 'tooltip-preload.ts')],
    outdir: output, bundle: true, platform: 'node', format: 'cjs', external: ['electron'], target: 'node22', sourcemap: true });
}
main().catch(error => { console.error(error); process.exitCode = 1; });
