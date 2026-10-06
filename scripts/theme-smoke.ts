import type { BrowserWindow } from 'electron';
import type { ThemeChoice } from '../src/shared/contracts.js';
import { nativeTheme } from 'electron';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { DatabaseSync } from 'node:sqlite';

interface ThemeCheckOptions { win: BrowserWindow; tooltipWin: BrowserWindow; testDir: string; refresh: () => Promise<void> }
// Catch lost saved choices, mixed window themes, unreadable status text, and broken radio keyboard input.
export async function checkThemes({ win, tooltipWin, testDir, refresh }: ThemeCheckOptions): Promise<string[]> {
  const rendererErrors: string[] = [];
  const onConsole = (event: Electron.Event<Electron.WebContentsConsoleMessageEventParams>) => { if (event.level === 'error') rendererErrors.push(event.message); };
  for (const window of [win, tooltipWin]) window.webContents.on('console-message', onConsole);
  assert.equal(await win.webContents.executeJavaScript('window.settings.read().then(value => value.theme)'), 'system', 'Old preferences must default to System.');
  const panel = (code: string) => win.webContents.executeJavaScript(code);
  const settings = (code: string) => win.webContents.executeJavaScript(code);
  const wait = async (check: () => Promise<boolean>) => {
    const deadline = Date.now() + 8000;
    while (!await check()) {
      if (Date.now() > deadline) throw Error('Theme did not reach the expected visible state.');
      await new Promise(resolve => setTimeout(resolve, 30));
    }
  };
  const closeSettings = async () => {
    win.focus();
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
    await wait(async () => await panel("document.querySelector('#settings-view').hidden"));
  };
  const themeMatches = async (dark: boolean) => {
    const query = `matchMedia('(prefers-color-scheme: dark)').matches === ${dark} && getComputedStyle(document.documentElement).colorScheme === '${dark ? 'dark' : 'light'}'`;
    return (await Promise.all([win, tooltipWin].map(window => window.webContents.executeJavaScript(query)))).every(Boolean);
  };
  const choose = async (theme: ThemeChoice) => {
    await panel("window.sessionLights.action({ type: 'settings', reducedMotion: true })");
    await settings(`document.querySelector('input[value=${theme}]').click()`);
    await wait(async () => await settings(`document.querySelector('input[value=${theme}]').checked && window.settings.read().then(value => value.theme === '${theme}')`));
    if (theme !== 'system') await wait(() => themeMatches(theme === 'dark'));
  };
  const capture = async (window: BrowserWindow, name: string) => {
    await window.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    await fs.writeFile(path.join(testDir, name), (await window.webContents.capturePage()).toPNG());
  };
  // Use the real two fixture sessions in the expanded panel for the requested captures.
  await panel("window.sessionLights.read().then(value => { if (!value.preferences.expanded) return window.sessionLights.action({ type: 'expand', reducedMotion: true }); })");
  for (const theme of ['light', 'dark'] as const) {
    await choose(theme);
    // Contrast is an observable requirement. Check text against the actual painted surfaces.
    const contrastCode = `(() => {
      const rgb = color => color.match(/[\\d.]+/g).slice(0, 3).map(Number);
      const luminance = color => rgb(color).map(c => { const s = c / 255; return s <= .04045 ? s / 12.92 : ((s + .055) / 1.055) ** 2.4; }).reduce((sum, c, i) => sum + c * [.2126, .7152, .0722][i], 0);
      const background = getComputedStyle(document.documentElement).getPropertyValue('--surface').trim();
      const probe = document.createElement('span'); document.body.append(probe); probe.style.backgroundColor = background;
      const bg = luminance(getComputedStyle(probe).backgroundColor);
      const result = ['--text', '--muted', '--status-idle', '--status-waiting', '--status-working', '--status-error', '--status-unknown'].map(token => {
        probe.style.color = 'var(' + token + ')'; const fg = luminance(getComputedStyle(probe).color);
        return { token, ratio: (Math.max(fg, bg) + .05) / (Math.min(fg, bg) + .05) };
      }); probe.remove(); return result;
    })()`;
    const ratios: { token: string; ratio: number }[] = await panel(contrastCode);
    for (const reading of ratios) assert.ok(reading.ratio >= 4.5, `${theme} ${reading.token} contrast is ${reading.ratio}`);
    await fs.writeFile(path.join(testDir, `contrast-${theme}.json`), JSON.stringify(ratios, null, 2));
    assert.equal(await settings("document.querySelector('#settings-footer').getBoundingClientRect().bottom <= innerHeight && document.querySelector('#appearance').getBoundingClientRect().width > 0"), true);
    await capture(win, `settings-${theme}.png`);
    await closeSettings();
    await capture(win, `app-${theme}.png`);
    if (process.argv.includes('--theme-only')) {
      const db = new DatabaseSync(path.join(testDir, 'codex', 'state_5.sqlite'));
      try {
        db.prepare('UPDATE threads SET archived = 1 WHERE id IN (?, ?)').run('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222');
        await refresh();
        await wait(async () => await panel("!document.querySelector('#empty').hidden && document.querySelector('#empty').textContent.includes('No local sessions')"));
        await capture(win, `empty-${theme}.png`);
      } finally {
        db.prepare('UPDATE threads SET archived = 0 WHERE id IN (?, ?)').run('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222');
        db.close(); await refresh();
      }
    }
    const key: string = await panel("document.querySelector('.session-button').dataset.key");
    await panel(`window.sessionLights.tooltip({ kind: 'session', key: ${JSON.stringify(key)}, y: 45 })`);
    await wait(async () => tooltipWin.isVisible() && await tooltipWin.webContents.executeJavaScript("document.querySelector('#title').textContent.length > 0"));
    assert.equal(await tooltipWin.webContents.executeJavaScript("getComputedStyle(document.querySelector('#status')).color === getComputedStyle(document.querySelector('#meter span')).backgroundColor"), true);
    await capture(tooltipWin, `tooltip-${theme}.png`);
    await panel('window.sessionLights.tooltip(null)');
    // Reload every window, with the theme already set, to catch late JavaScript theme application.
    for (const window of [win, tooltipWin]) {
      await window.webContents.reload();
      await new Promise<void>(resolve => window.webContents.once('did-finish-load', () => resolve()));
    }
    await wait(() => themeMatches(theme === 'dark'));
    await wait(async () => await settings(`document.querySelector('input[value=${theme}]').checked`));
  }
  await choose('system');
  await wait(() => themeMatches(nativeTheme.shouldUseDarkColors));
  assert.equal(nativeTheme.themeSource, 'system');
  const checks = ['Light and Dark apply to all native windows', 'all text and status colors pass 4.5:1 contrast', 'theme choice survives window reload', 'System matches the operating system theme', 'Light and Dark app, Settings, and tooltip captures'];
  // Optional real OS check uses a task-owned script and always restores the prior setting.
  if (process.argv.includes('--verify-system-theme') && process.platform === 'win32') {
    const execute = promisify(execFile);
    const script = path.join(__dirname, '..', '..', 'scripts', 'windows-theme-check.ps1');
    const command = async (theme: string, original?: string) => {
      const result = await execute('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, '-Theme', theme, ...(original ? ['-Original', original] : [])], { windowsHide: true });
      return result.stdout.trim();
    };
    const original = await command('Read');
    try {
      for (const theme of ['Light', 'Dark', 'Light']) {
        await command(theme);
        await wait(async () => nativeTheme.shouldUseDarkColors === (theme === 'Dark') && await themeMatches(theme === 'Dark'));
        assert.equal(await settings("window.settings.read().then(value => value.theme)"), 'system');
      }
      await choose('dark');
      await command('Light');
      await wait(() => themeMatches(true));
      await choose('light');
      await command('Dark');
      await wait(() => themeMatches(false));
      await choose('system');
      checks.push('System follows real Windows theme changes without restart', 'explicit Light and Dark ignore OS theme changes');
    } finally { await command('Restore', original); }
  }
  // Native radio arrows change the selected theme and keep keyboard focus visible.
  win.focus();
  await settings("document.querySelector('#settings-back').focus()");
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Tab' });
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Tab' });
  await wait(async () => await settings("document.activeElement.value === 'system'"));
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Right' });
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Right' });
  await wait(async () => await settings("document.activeElement.value === 'light' && window.settings.read().then(value => value.theme === 'light')"));
  await wait(() => themeMatches(false));
  assert.equal(await settings("getComputedStyle(document.activeElement.closest('label')).outlineStyle"), 'solid');
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Left' });
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Left' });
  await wait(async () => await settings("document.activeElement.value === 'system' && window.settings.read().then(value => value.theme === 'system')"));
  checks.push('keyboard arrow keys change themes and show focus');
  await settings("window.settings.action({ type: 'theme', theme: 'invalid' })");
  assert.equal(await settings("window.settings.read().then(value => value.theme)"), 'system');
  checks.push('invalid theme commands cannot change the app theme');
  if (process.argv.includes('--theme-only')) {
    const blockedWrite = path.join(testDir, 'profile', 'preferences.json.tmp');
    await fs.mkdir(blockedWrite);
    try {
      await settings("document.querySelector('input[value=dark]').click()");
      await wait(async () => await settings("!document.querySelector('#settings-error').hidden && document.querySelector('input[value=system]').checked"));
      assert.equal(nativeTheme.themeSource, 'system');
    } finally { await fs.rmdir(blockedWrite); }
    checks.push('failed preference writes show an error and preserve the current theme', 'empty states use both themes');
  }
  if (process.argv.includes('--theme-only')) {
    await Promise.all([settings("Promise.all([window.settings.action({ type: 'theme', theme: 'light' }), window.settings.action({ type: 'adapter', id: 'atlas', visible: false })])"), panel("window.sessionLights.action({ type: 'hide-session', key: 'codex:22222222-2222-4222-8222-222222222222' })")]);
    await wait(async () => await settings("window.settings.read().then(value => value.theme === 'light' && value.adapters.some(adapter => adapter.id === 'atlas' && !adapter.visible))"));
    await wait(() => themeMatches(false));
    await wait(async () => await panel("document.querySelectorAll('.session').length === 1 && document.querySelector('#hidden-sessions').textContent === '1 session hidden'"));
    checks.push('theme, adapter, and session choices survive concurrent saves');
  }
  // Leave Dark saved so the parent can verify a cold app restart.
  await choose('dark');
  await closeSettings();
  assert.deepEqual(rendererErrors, [], 'Renderer errors after theme checks.');
  for (const window of [win, tooltipWin]) window.webContents.removeListener('console-message', onConsole);
  return checks;
}

// Catch a saved choice that applies only after a window has already loaded.
export async function checkThemeStartup({ win, tooltipWin, testDir }: ThemeCheckOptions, theme: ThemeChoice): Promise<void> {
  assert.equal(nativeTheme.themeSource, theme);
  const scheme = nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
  for (const window of [win, tooltipWin]) {
    assert.equal(await window.webContents.executeJavaScript('getComputedStyle(document.documentElement).colorScheme'), scheme);
  }
  assert.equal(await win.webContents.executeJavaScript('window.settings.read().then(value => value.theme)'), theme);
  assert.equal(await win.webContents.executeJavaScript("window.settings.read().then(value => value.adapters.some(adapter => adapter.id === 'atlas' && !adapter.visible))"), true, 'Theme restart must preserve hidden adapters.');
  assert.equal(await win.webContents.executeJavaScript("window.sessionLights.read().then(value => value.sessions.length === 1 && value.hiddenSessions.some(session => session.key === 'codex:22222222-2222-4222-8222-222222222222'))"), true, 'Theme restart must preserve hidden sessions.');
  const next = theme === 'dark' ? 'light' : 'system';
  await win.webContents.executeJavaScript(`window.settings.action({ type: 'theme', theme: '${next}' })`);
  await fs.writeFile(path.join(testDir, `startup-${theme}.json`), JSON.stringify({ theme, scheme, passed: true }, null, 2));
  console.log(`Cold restart passed: ${theme}.`);
}
