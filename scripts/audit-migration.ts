import { readdir, readFile } from 'node:fs/promises';
import * as path from 'node:path';
import * as assert from 'node:assert/strict';

async function files(root: string): Promise<string[]> {
  const result: string[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const file = path.join(root, entry.name);
    if (entry.isDirectory()) result.push(...await files(file));
    else result.push(file);
  }
  return result;
}
async function main(): Promise<void> {
  const root = path.resolve(__dirname, '..', '..');
  const source = (await Promise.all(['src', 'scripts', 'test'].map(folder => files(path.join(root, folder))))).flat();
  const code = source.filter(file => /\.(?:[cm]?js|tsx?)$/.test(file));
  for (const file of code) {
    assert.match(file, /\.ts$/, `Unmigrated source: ${file}`);
    const text = await readFile(file, 'utf8');
    assert.doesNotMatch(text, /:\s*any\b|\bas\s+any\b|<\s*any\s*>|^\s*\/\/\s*@ts-(?:ignore|nocheck)/m, `Unsafe type bypass: ${file}`);
    if (!file.endsWith('.type-test.ts')) assert.doesNotMatch(text, /^\s*\/\/\s*@ts-expect-error/m, `Suppressed implementation check: ${file}`);
  }
  for (const name of ['renderer', 'tooltip']) {
    const text = await readFile(path.join(root, 'build', 'src', 'ui', `${name}.js`), 'utf8');
    assert.doesNotMatch(text, /\brequire\s*\(|\bmodule\.exports\b/, `Node code reached the ${name} bundle.`);
  }
  for (const name of ['preload', 'tooltip-preload']) {
    const text = await readFile(path.join(root, 'build', 'src', `${name}.js`), 'utf8');
    const dependencies = [...text.matchAll(/\brequire\(["']([^"']+)["']\)/g)].map(match => match[1]);
    assert.deepEqual(dependencies, ['electron'], `${name} cannot load local modules in the renderer sandbox.`);
  }
  console.log(`Migration audit passed: ${code.length} TypeScript files; browser bundles contain no Node imports; preloads require only Electron.`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
