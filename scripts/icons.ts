import { app, BrowserWindow } from 'electron';
import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import { electronBinary } from './electron.js';

// Renders assets/icon.svg and assets/icon-small.svg into the installer icons.
// Chromium rasterizes the SVG, so the output matches the app's own rendering.
const assets = path.resolve(__dirname, '..', '..', 'assets');
// macOS icons keep Apple's 100 px margin. Windows icons crop most of it.
const windowsView = '68 68 888 888';
// Small sizes use the simplified drawing. Editor lines and rings blur below 64 px.
const smallSizes = [16, 20, 24, 32, 40, 48];
const largeSizes = [64, 128, 256];

async function render(win: BrowserWindow, svg: string, size: number, viewBox?: string): Promise<Buffer> {
  let source = svg.replace(/width="\d+" height="\d+"/, `width="${size}" height="${size}"`);
  if (viewBox) source = source.replace(/viewBox="[^"]+"/, `viewBox="${viewBox}"`);
  const url = `data:image/svg+xml;base64,${Buffer.from(source).toString('base64')}`;
  const data: unknown = await win.webContents.executeJavaScript(`new Promise((resolve, reject) => {
    const image = new Image(); image.onerror = () => reject(Error('Cannot load the icon SVG.'));
    image.onload = () => { const c = document.createElement('canvas'); c.width = c.height = ${size};
      c.getContext('2d').drawImage(image, 0, 0, ${size}, ${size}); resolve(c.toDataURL('image/png')); };
    image.src = ${JSON.stringify(url)}; })`);
  if (typeof data !== 'string' || !data.startsWith('data:image/png;base64,')) throw Error(`Cannot render the ${size} px icon.`);
  return Buffer.from(data.slice(data.indexOf(',') + 1), 'base64');
}

// An ICO file can hold PNG images directly. Windows Vista and later read this form.
function ico(images: { size: number; png: Buffer }[]): Buffer {
  const header = Buffer.alloc(6 + 16 * images.length);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  images.forEach(({ size, png }, index) => {
    const entry = 6 + 16 * index;
    header.writeUInt8(size % 256, entry);
    header.writeUInt8(size % 256, entry + 1);
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(png.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += png.length;
  });
  return Buffer.concat([header, ...images.map(image => image.png)]);
}

async function generate(): Promise<void> {
  await app.whenReady();
  const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
  try {
    await win.loadURL('about:blank');
    const icon = await readFile(path.join(assets, 'icon.svg'), 'utf8');
    const small = await readFile(path.join(assets, 'icon-small.svg'), 'utf8');
    await writeFile(path.join(assets, 'icon.png'), await render(win, icon, 1024));
    const images = [];
    for (const size of smallSizes) images.push({ size, png: await render(win, small, size) });
    for (const size of largeSizes) images.push({ size, png: await render(win, icon, size, windowsView) });
    await writeFile(path.join(assets, 'icon.ico'), ico(images));
    console.log(`Wrote assets/icon.png (1024 px) and assets/icon.ico (${images.map(image => image.size).join(', ')} px).`);
  } finally { win.destroy(); }
}

if (process.versions.electron) {
  generate().then(() => app.quit(), error => { console.error(error); app.exit(1); });
} else {
  // Editor terminals can set this variable. It makes Electron run as plain Node.
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(electronBinary(), [__filename], { env, stdio: 'inherit', windowsHide: true });
  child.on('close', code => { process.exitCode = code ?? 1; });
}
