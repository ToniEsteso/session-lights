import { required } from '../test/assertions.js';
import type { App, BrowserWindow, Rectangle } from 'electron';
import { DatabaseSync } from 'node:sqlite';
import { Preferences } from '../src/preferences.js';
import type { SortOrder } from '../src/shared/contracts.js';
import { errorMessage } from '../src/shared/validation.js';
interface DesktopCheckOptions { app: App; win: BrowserWindow; tooltipWin: BrowserWindow; settingsWin: BrowserWindow; refresh: () => Promise<void>; refreshUsage: () => Promise<void>; showPanel: () => void; testDir: string; preferences: Preferences }
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as assert from 'node:assert/strict';
import { screen, nativeTheme } from 'electron';
import { checkThemes } from './theme-smoke.js';
import { logLine, setStatus, rolloutLine } from '../test/fixtures.js';

async function run({ app, win, tooltipWin, settingsWin, refresh, refreshUsage, showPanel, testDir, preferences }: DesktopCheckOptions) {
  const errors: string[] = [];
  win.webContents.on('console-message', event => { if (event.level === 'error') errors.push(event.message); });
  tooltipWin.webContents.on('console-message', event => { if (event.level === 'error') errors.push(event.message); });
  settingsWin.webContents.on('console-message', event => { if (event.level === 'error') errors.push(event.message); });
  const waitTooltip = async (condition: string) => {
    const deadline = Date.now() + 5000;
    while (!tooltipWin.isVisible() || !await tooltipWin.webContents.executeJavaScript(condition)) {
      if (Date.now() > deadline) {
        const text = await tooltipWin.webContents.executeJavaScript('document.body.textContent');
        throw Error(`Tooltip did not reach: ${condition}; visible=${tooltipWin.isVisible()}; text=${JSON.stringify(text)}`);
      }
      await new Promise(resolve => setTimeout(resolve, 30));
    }
  };
  const waitNative = async (condition: () => boolean) => {
    const deadline = Date.now() + 5000;
    while (!condition()) {
      if (Date.now() > deadline) throw Error('Native window did not reach the expected state.');
      await new Promise(resolve => setTimeout(resolve, 30));
    }
  };
  const js = (code: string) => win.webContents.executeJavaScript(code).catch(error => { throw Error(`Panel check failed: ${code}\n${errorMessage(error)}`); });
  const wait = async (condition: string) => {
    const deadline = Date.now() + 5000;
    while (!await js(condition)) { if (Date.now() > deadline) throw Error(`UI did not reach: ${condition}`); await new Promise(resolve => setTimeout(resolve, 30)); }
  };
  const capture = async (name: string) => {
    await js('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    await fs.writeFile(path.join(testDir, name), (await win.webContents.capturePage()).toPNG());
  };
  const settingsJs = (code: string) => settingsWin.webContents.executeJavaScript(code);
  const waitSettings = async (condition: string) => {
    const deadline = Date.now() + 5000;
    while (!await settingsJs(condition)) {
      if (Date.now() > deadline) throw Error(`Settings did not reach: ${condition}`);
      await new Promise(resolve => setTimeout(resolve, 30));
    }
  };
  const closeSettings = async () => {
    settingsWin.focus();
    settingsWin.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
    settingsWin.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
    await waitNative(() => !settingsWin.isVisible());
  };
  const toggleAdapter = async (id: string) => {
    await settingsJs(`[...document.querySelectorAll('input[data-adapter]')].find(input => input.dataset.adapter === ${JSON.stringify(id)}).focus()`);
    settingsWin.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Space' });
    settingsWin.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Space' });
  };
  const data = { root: path.join(testDir, 'codex'), log: path.join(testDir, 'logs', ...new Date().toISOString().slice(0, 10).split('-'), 'desktop.log') };
  const id = '11111111-1111-4111-8111-111111111111';
  try {
    const liveCliId = process.argv.find(arg => arg.startsWith('--live-cli='))?.slice('--live-cli='.length);
    if (liveCliId) {
      const expected = process.argv.find(arg => arg.startsWith('--live-cli-state='))?.slice('--live-cli-state='.length);
      showPanel();
      const key = JSON.stringify('codex-cli:' + liveCliId);
      await wait(`window.sessionLights.read().then(value => value.sessions.some(session => session.key === ${key}${expected ? ' && session.state === ' + JSON.stringify(expected) : ''}))`);
      await js('window.sessionLights.action({ type: "expand", reducedMotion: true })');
      await wait("document.querySelector('#panel').classList.contains('expanded')");
      const selected = `document.querySelector('[data-key="codex-cli:${liveCliId}"]')`;
      await wait(`Boolean(${selected})`);
      assert.match(await js(`${selected}.getAttribute('aria-description')`), /Codex CLI/);
      const state = await js(`window.sessionLights.read().then(value => value.sessions.find(session => session.key === ${key}).state)`);
      assert.equal(await js(`${selected}.querySelector('.dot').classList.contains(${JSON.stringify(state)})`), true);
      assert.equal(await js("document.querySelectorAll('.usage-row').length"), 2);
      await capture('live-cli.png');
      await js("document.querySelector('header [data-settings]').click()");
      await waitNative(() => settingsWin.isVisible());
      await toggleAdapter('codex-cli'); await wait(`!${selected}`);
      await toggleAdapter('codex-cli'); await wait(`Boolean(${selected})`);
      await fs.writeFile(path.join(testDir, 'live-cli-settings.png'), (await settingsWin.webContents.capturePage()).toPNG());
      await closeSettings();
      assert.deepEqual(errors, []);
      await fs.writeFile(path.join(testDir, 'live-cli-report.json'), JSON.stringify({ result: 'passed', sessionId: liveCliId, state, checks: ['live CLI record reaches the native light', 'one set of account gauges', 'CLI switch hides and restores its live session', 'no renderer errors'] }, null, 2));
      console.log(`Live CLI panel checks passed: 4; state=${state}.`); app.quit(); return;
    }
    if (process.argv.includes('--adapter-visibility-restart')) {
      showPanel();
      await wait("!document.querySelector('#adapters-hidden').hidden && document.querySelectorAll('.session, .usage-row').length === 0");
      win.focus();
      await waitNative(() => win.isFocused());
      await js("document.querySelector('#empty-settings').focus()");
      await wait("document.activeElement.id === 'empty-settings'");
      win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' });
      win.webContents.sendInputEvent({ type: 'char', keyCode: 'Enter' });
      win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' });
      await waitNative(() => settingsWin.isVisible());
      await waitSettings("document.querySelectorAll('input[role=switch]').length === 3 && [...document.querySelectorAll('input[role=switch]')].every(input => !input.checked)");
      await toggleAdapter('codex');
      await wait("document.querySelectorAll('.session').length === 2 && document.querySelector('#sessions').textContent.includes('Hidden Codex update')");
      assert.equal(await js(`document.querySelector('[data-key="codex:${id}"] .dot').classList.contains('error')`), true);
      assert.equal(await js("document.querySelectorAll('[data-provider=codex]').length"), 2);
      await closeSettings();
      const saved = new Preferences(preferences.file); await saved.load();
      assert.equal(saved.value.pinned.length, 1);
      assert.equal(await js("document.querySelectorAll('.pin[aria-pressed=true]').length"), 1);
      assert.deepEqual(errors, []);
      await fs.writeFile(path.join(testDir, 'adapter-restart-report.json'), JSON.stringify({ result: 'passed', checks: [
        'all-hidden empty state survives a full app restart', 'switch choices survive a full app restart',
        'empty-state Settings link works with Enter', 'restored adapter shows the latest saved sessions and usage', 'pins survive hiding and restart', 'no renderer errors'
      ] }, null, 2));
      console.log('Adapter restart checks passed: 6.'); app.quit(); return;
    }
    win.webContents.debugger.attach('1.3');
    await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
    // Legacy color assertions check the dark palette. Theme checks cover both.
    nativeTheme.themeSource = 'dark';
    showPanel();
    await wait("document.visibilityState === 'visible'");
    await wait("document.querySelectorAll('.session').length === 2");
    console.log('Native window:', JSON.stringify({ visible: win.isVisible(), alwaysOnTop: win.isAlwaysOnTop(), bounds: win.getBounds(), platform: process.platform }));
    assert.equal(win.isAlwaysOnTop(), true);
    const nativeWidth = await js('window.sessionLights.read().then(value => value.compactInset + 26)');
    assert.ok(nativeWidth >= 26 && nativeWidth <= 40, 'Unexpected native compact width.');
    assert.ok(Math.abs(win.getBounds().width - nativeWidth) <= 1, 'Native width exceeds DPI rounding tolerance.');
    assert.equal(await js("document.querySelector('#panel').getBoundingClientRect().width"), 26);
    assert.ok(win.getBounds().height <= 160);
    assert.equal(await js("Boolean(document.querySelector('.dot.working'))"), true);
    const centers = await js(`['#panel', '.usage-row:nth-child(1) .usage-gauge', '.usage-row:nth-child(2) .usage-gauge', ...Array.from(document.querySelectorAll('.dot'), (_, i) => '.session:nth-child(' + (i + 1) + ') .dot')].map(selector => {
      const box = document.querySelector(selector).getBoundingClientRect(); return box.x + box.width / 2;
    })`);
    assert.ok(Math.max(...centers) - Math.min(...centers) < 0.5, `Compact elements are off center: ${centers}`);
    // Catch unequal end spacing and a remaining transparent gap at the screen edge.
    const spacing = await js(`(() => {
      const panel = document.querySelector('#panel').getBoundingClientRect();
      const dots = [...document.querySelectorAll('.dot')].map(dot => dot.getBoundingClientRect());
      const lastGauge = document.querySelector('footer .gear svg').getBoundingClientRect();
      const style = getComputedStyle(document.querySelector('#panel'));
      return { top: dots[0].top - panel.top, bottom: panel.bottom - lastGauge.bottom,
        right: panel.right, viewport: innerWidth, radiusTop: style.borderTopRightRadius, radiusBottom: style.borderBottomRightRadius };
    })()`);
    assert.ok(spacing.top >= 8 && spacing.bottom >= 8 && spacing.bottom < 18, `End spacing differs: ${JSON.stringify(spacing)}`);
    assert.ok(Math.abs(spacing.right - spacing.viewport) < 0.5, 'The visible bar has a gap inside the native window.');
    assert.equal(spacing.radiusTop, '0px'); assert.equal(spacing.radiusBottom, '0px');
    const checkScreenEdge = () => {
      const bounds = win.getBounds();
      const display = screen.getDisplayMatching(bounds).bounds;
      assert.ok(Math.abs(bounds.x + bounds.width - display.x - display.width) <= 1, 'The native panel has a gap at the screen edge.');
    };
    checkScreenEdge();
    await js("document.querySelector('footer [data-settings]').click()");
    await waitNative(() => settingsWin.isVisible());
    assert.ok(settingsWin.getBounds().x + settingsWin.getBounds().width < win.getBounds().x, 'Settings must open to the left.');
    assert.equal(await settingsWin.webContents.executeJavaScript("document.querySelector('#update').disabled"), true);
    assert.match(await settingsWin.webContents.executeJavaScript("document.querySelector('#update').title"), /installed release/);
    assert.equal(await settingsWin.webContents.executeJavaScript("document.querySelector('h1, h2, #release-notes, #installation-help') === null"), true);
    await settingsWin.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    // Catch old saved opt-out flags still suppressing usage and excess Settings height.
    await wait("window.sessionLights.read().then(value => value.usage.find(source => source.providerId === 'codex').windows.some(window => window.remainingPercent === 76))");
    assert.equal(await settingsJs("document.querySelector('#codex-usage, #close, #theme-help, #adapter-help') === null"), true);
    assert.equal(await settingsJs("document.querySelector('footer').getBoundingClientRect().bottom <= innerHeight && innerHeight - document.querySelector('footer').getBoundingClientRect().bottom <= 12"), true);
    await fs.writeFile(path.join(testDir, 'settings.png'), (await settingsWin.webContents.capturePage()).toPNG());
    await closeSettings();
    await waitNative(() => !settingsWin.isVisible());
    assert.equal(await js("[...document.querySelectorAll('.dot')].every(dot => dot.textContent === '' && dot.getBoundingClientRect().width <= 10.5)"), true);
    assert.equal(await js("document.querySelector('.grip') === null && getComputedStyle(document.querySelector('footer')).display === 'flex' && getComputedStyle(document.querySelector('#expand')).display === 'none'"), true);
    const usageLayout = await js(`(() => {
      const section = document.querySelector('#usage');
      const lastSession = document.querySelector('.session:last-child').getBoundingClientRect();
      return { top: section.getBoundingClientRect().top, bottom: lastSession.bottom,
        border: parseFloat(getComputedStyle(section).borderTopWidth),
        gauges: [...document.querySelectorAll('.usage-gauge')].map(gauge => gauge.getBoundingClientRect().height),
        values: [...document.querySelectorAll('.usage-value')].map(value => getComputedStyle(value).display) };
    })()`);
    assert.ok(usageLayout.top > usageLayout.bottom && usageLayout.border > 0 && usageLayout.gauges.every((height: number) => height > 0) && usageLayout.values.every((display: string) => display === 'none'), JSON.stringify(usageLayout));
    assert.equal(await js("[...document.querySelectorAll('.gauge-needle')].every(needle => getComputedStyle(needle).stroke === 'rgb(140, 206, 107)')"), true);
    assert.match(await js("document.querySelector('[data-limit=fiveHour] .usage-gauge').getAttribute('aria-label')"), /5-hour limit: 76% remaining/);
    assert.match(await js("document.querySelector('[data-limit=weekly] .usage-gauge').getAttribute('aria-label')"), /Weekly limit: 84% remaining/);
    await capture('compact.png');
    // Restore panel focus before testing hover; closing settings can focus a row.
    win.focus();
    await waitNative(() => win.isFocused());
    win.webContents.sendInputEvent({ type: 'mouseMove', x: 0, y: 0 });
    const light = await js(`(() => { const box = document.querySelector('[data-key="codex:22222222-2222-4222-8222-222222222222"].session-button').getBoundingClientRect(); return { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) }; })()`);
    win.webContents.sendInputEvent({ type: 'mouseMove', ...light, globalX: win.getBounds().x + light.x, globalY: win.getBounds().y + light.y });
    await wait("document.querySelector('[data-key=\"codex:22222222-2222-4222-8222-222222222222\"].session-button').matches(':hover')");
    await waitTooltip("document.querySelector('#title').textContent === 'Review tests'");
    assert.equal(tooltipWin.isFocused(), false);
    assert.ok(tooltipWin.getBounds().x + tooltipWin.getBounds().width < win.getBounds().x);
    assert.match(await tooltipWin.webContents.executeJavaScript("document.body.textContent"), /Codex · project.+Idle.+Last recorded activity/s);
    await fs.writeFile(path.join(testDir, 'session-tooltip.png'), (await tooltipWin.webContents.capturePage()).toPNG());
    assert.equal(await js("getComputedStyle(document.querySelector('.session-button')).backgroundColor"), 'rgba(0, 0, 0, 0)');
    await capture('hover.png');
    // Catch movement delayed until release, overshoot on repeated moves, and lost position.
    const dragStart = win.getBounds();
    const handle = await js(`(() => { const box = document.querySelector('#handle').getBoundingClientRect(); return { x: Math.round(box.x + box.width / 2), y: 4 }; })()`);
    await js(`window.dragEvidence = []; for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'lostpointercapture']) document.addEventListener(type, event => window.dragEvidence.push({ type, target: event.target.id || event.target.className, screenY: event.screenY, clientY: event.clientY, pointerId: event.pointerId, button: event.button }), true);`);
    win.focus();
    // Electron input needs explicit global coordinates for PointerEvent.screenY.
    const pointerStart = { ...handle, globalX: dragStart.x + handle.x, globalY: dragStart.y + handle.y };
    win.webContents.sendInputEvent({ type: 'mouseMove', ...pointerStart });
    await waitNative(() => !tooltipWin.isVisible());
    assert.equal(await js("getComputedStyle(document.querySelector('#handle')).cursor"), 'grab');
    win.webContents.sendInputEvent({ type: 'mouseDown', ...pointerStart, button: 'left', clickCount: 1 });
    await wait("document.body.classList.contains('dragging')");
    assert.equal(await js("getComputedStyle(document.querySelector('#handle')).cursor"), 'grabbing');
    const dragTo = (delta: number) => {
      const screenY = pointerStart.globalY + delta;
      const clientY = screenY - win.getBounds().y;
      return js(`document.querySelector('#handle').dispatchEvent(new PointerEvent('pointermove', {
        bubbles: true, pointerId: 1, clientY: ${clientY}, screenY: ${screenY}, button: 0, buttons: 1
      }))`);
    };
    const waitPosition = async (target: number) => {
      const deadline = Date.now() + 5000;
      while (Math.abs(win.getBounds().y - target) > 1) {
        if (Date.now() > deadline) throw Error(`Panel did not follow the held drag: wanted ${target}, got ${win.getBounds().y}. Events: ${JSON.stringify(await js('window.dragEvidence'))}`);
        await new Promise(resolve => setTimeout(resolve, 30));
      }
    };
    await dragTo(40); await waitPosition(dragStart.y + 40);
    await dragTo(-20); await waitPosition(dragStart.y - 20);
    await refresh(); await waitPosition(dragStart.y - 20);
    const endY = pointerStart.globalY - 20;
    await js(`document.querySelector('#handle').dispatchEvent(new PointerEvent('pointerup', {
      bubbles: true, pointerId: 1, clientY: ${endY - win.getBounds().y}, screenY: ${endY}, button: 0, buttons: 0
    }))`);
    await wait("!document.body.classList.contains('dragging')");
    assert.equal(await js("getComputedStyle(document.querySelector('#handle')).cursor"), 'grab');
    await wait(`window.sessionLights.read().then(value => Math.abs(value.preferences.y - ${dragStart.y - 20}) <= 1)`);
    await refresh(); await waitPosition(dragStart.y - 20);
    // Catch an instant resize, a moving screen edge, and refreshes that interrupt motion.
    const frames: (Rectangle & { at: number; aboveOtherWindows: boolean })[] = [];
    const recordFrame = () => frames.push({ ...win.getBounds(), at: Date.now(), aboveOtherWindows: win.isAlwaysOnTop() });
    win.on('resize', recordFrame);
    await js("document.querySelector('.usage-gauge').click()");
    await wait("innerWidth > 50 && innerWidth < 320");
    checkScreenEdge(); await capture('expanding.png');
    const duringMotion = new DatabaseSync(path.join(data.root, 'state_5.sqlite'));
    duringMotion.prepare('UPDATE threads SET title = ? WHERE id = ?').run('Updated while opening', id); duringMotion.close();
    await refresh();
    await wait("document.querySelector('#panel').classList.contains('expanded') && !document.body.classList.contains('resizing')");
    assert.match(await js("document.querySelector('#sessions').textContent"), /Updated while opening/);
    const restoreTitle = new DatabaseSync(path.join(data.root, 'state_5.sqlite'));
    restoreTitle.prepare('UPDATE threads SET title = ? WHERE id = ?').run('Build the service', id); restoreTitle.close(); await refresh();
    const expandedEdge = win.getBounds().x + win.getBounds().width;
    assert.ok(new Set(frames.filter(frame => frame.width > nativeWidth + 2 && frame.width < 326).map(frame => frame.width)).size >= 3, 'Expansion did not pass through intermediate widths.');
    assert.ok(frames.every(frame => Math.abs(frame.x + frame.width - expandedEdge) <= 1), 'Expansion moved away from the screen edge.');
    assert.ok(frames.every(frame => frame.aboveOtherWindows), 'The panel lost its topmost state during expansion.');
    frames.length = 0;
    await js("document.querySelector('#expand').click()");
    await wait("innerWidth > 40 && innerWidth < 300");
    await capture('collapsing.png');
    await wait("!document.querySelector('#panel').classList.contains('expanded') && !document.body.classList.contains('resizing')");
    assert.ok(new Set(frames.filter(frame => frame.width > nativeWidth + 2 && frame.width < 326).map(frame => frame.width)).size >= 3, 'Collapse did not pass through intermediate widths.');
    assert.ok(frames.every(frame => Math.abs(frame.x + frame.width - expandedEdge) <= 1), 'Collapse moved away from the screen edge.');
    assert.ok(frames.every(frame => frame.aboveOtherWindows), 'The panel lost its topmost state during collapse.');
    await fs.writeFile(path.join(testDir, 'animation-frames.json'), JSON.stringify(frames, null, 2));
    // A second click during collapse must reverse smoothly and reach the new state.
    await js("document.querySelector('.session-button').click()");
    await wait("document.querySelector('#panel').classList.contains('expanded') && !document.body.classList.contains('resizing')");
    await js("document.querySelector('#expand').click()");
    await wait("!document.querySelector('#panel').classList.contains('expanded') && document.body.classList.contains('resizing')");
    await js("document.querySelector('.session-button').click()");
    await wait("document.querySelector('#panel').classList.contains('expanded') && !document.body.classList.contains('resizing')");
    assert.equal(win.getBounds().width, 328); checkScreenEdge();
    await js("document.querySelector('#expand').click()");
    await wait("!document.querySelector('#panel').classList.contains('expanded') && !document.body.classList.contains('resizing')");
    // The user's reduced-motion setting must avoid native and content animation.
    await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    frames.length = 0;
    await js("document.querySelector('.usage-gauge').click()");
    await wait("document.querySelector('#panel').classList.contains('expanded') && !document.body.classList.contains('resizing')");
    assert.equal(win.getBounds().width, 328);
    assert.equal(frames.some(frame => frame.width > nativeWidth + 2 && frame.width < 326), false, 'Reduced motion still animated the native window.');
    assert.equal(await js("document.getAnimations().some(animation => animation.playState === 'running')"), false);
    await js("document.querySelector('#expand').click()");
    await wait("!document.querySelector('#panel').classList.contains('expanded') && !document.body.classList.contains('resizing')");
    await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [] });
    win.webContents.debugger.detach(); win.removeListener('resize', recordFrame);
    await js("document.querySelector('.session-button').click()");
    await wait("document.querySelector('#panel').classList.contains('expanded') && !document.body.classList.contains('resizing')");
    assert.equal(win.getBounds().width, 328);
    checkScreenEdge();
    assert.match(await js("document.querySelector('#sessions').textContent"), /Build the service/);
    assert.equal(await js("Boolean(document.querySelector('.legend, #health, .summary'))"), false);
    assert.equal(await js("document.querySelector('#all, #quit') === null"), true);
    assert.equal(await js("document.querySelector('.session-project').textContent"), 'project');
    assert.equal(await js("document.querySelector('.session-button').hasAttribute('title')"), false);
    await wait("[...document.querySelectorAll('.session-activity')].every(time => time.textContent === 'just now')");
    assert.equal(await js(`window.sessionLights.read().then(value => [...document.querySelectorAll('.session-button')].every(button => {
      const session = value.sessions.find(session => session.key === button.dataset.key);
      const time = button.querySelector('.session-activity');
      const title = button.querySelector('.session-title').getBoundingClientRect();
      const box = time.getBoundingClientRect();
      const pin = button.parentElement.querySelector('.pin').getBoundingClientRect();
      return Date.parse(time.dateTime) === Math.trunc(session.updatedAt) && box.left >= title.right && box.right <= pin.left &&
        box.width + 0.5 >= time.scrollWidth && time.getAttribute('aria-label').startsWith('Last activity:');
    }))`), true);
    // Advance only the renderer clock. The unchanged payload must still update the row ages.
    await js("window.activityClock = Date.now; const now = Date.now(); Date.now = () => now + 61000; void 0;");
    await wait("[...document.querySelectorAll('.session-activity')].every(time => time.textContent === '1m ago')");
    await js("Date.now = window.activityClock; delete window.activityClock;");
    await wait("[...document.querySelectorAll('.session-activity')].every(time => time.textContent === 'just now')");
    assert.equal(await js("document.querySelector('#sessions').scrollHeight <= document.querySelector('#sessions').clientHeight"), true);
    // Catch removed panel title, stale sorting choices, and changed pin priority.
    assert.equal(await js("document.querySelector('.title') === null"), true);
    assert.equal(await js("document.querySelector('[data-sort][aria-pressed=true]').dataset.sort"), 'activity');
    // Catch controls hidden below the list, clipped choices, and more than one selected sort.
    assert.equal(await js("document.querySelector('input, select, #search, #state-filter') === null"), true);
    assert.equal(await js(`(() => {
      const tools = document.querySelector('.sort-tools').getBoundingClientRect();
      const header = document.querySelector('header').getBoundingClientRect();
      const list = document.querySelector('#sessions').getBoundingClientRect();
      const settings = document.querySelector('header [data-settings]').getBoundingClientRect();
      const choices = [...document.querySelectorAll('[data-sort]')].map(button => button.getBoundingClientRect());
      return tools.top >= header.top && tools.bottom <= header.bottom && tools.bottom <= list.top &&
        tools.right < settings.left && settings.right <= header.right && choices.length === 2 &&
        choices.every(box => box.width > 0 && box.left >= tools.left && box.right <= tools.right && box.top === choices[0].top);
    })()`), true);
    const selectSort = async (order: SortOrder) => {
      await js(`document.querySelector('[data-sort=${order}]').click()`);
      await wait(`window.sessionLights.read().then(value => value.preferences.sortOrder === ${JSON.stringify(order)})`);
      await wait(`document.querySelector('[data-sort][aria-pressed=true]').dataset.sort === ${JSON.stringify(order)}`);
      assert.equal(await js("document.querySelectorAll('[data-sort][aria-pressed=true]').length"), 1);
    };
    const activityDb = new DatabaseSync(path.join(data.root, 'state_5.sqlite'));
    activityDb.prepare('UPDATE threads SET updated_at = ? WHERE id = ?').run(Math.floor(Date.now() / 1000) + 120, '22222222-2222-4222-8222-222222222222'); activityDb.close();
    await refresh(); await selectSort('activity');
    await wait("document.querySelector('.session-title').textContent === 'Review tests'");
    await selectSort('activity');
    await win.webContents.reload();
    await wait("document.querySelector('[data-sort=activity]').getAttribute('aria-pressed') === 'true' && document.querySelector('.session-title').textContent === 'Review tests'");
    const reloadedPreferences = new Preferences(preferences.file);
    await reloadedPreferences.load(); assert.equal(reloadedPreferences.value.sortOrder, 'activity');
    await js("[...document.querySelectorAll('.pin')].find(button => button.dataset.key.endsWith('11111111-1111-4111-8111-111111111111')).click()");
    await wait("document.querySelector('.session-title').textContent === 'Build the service' && document.querySelector('.pin').getAttribute('aria-pressed') === 'true'");
    assert.equal(await js("document.querySelector('.pin svg path') !== null"), true);
    assert.equal(await js("getComputedStyle(document.querySelector('.pin path')).fill"), 'rgb(255, 212, 94)');
    await js("document.querySelector('.pin').click()");
    await wait("document.querySelector('.session-title').textContent === 'Review tests'");
    // Catch keyboard-inaccessible sorting and Escape failing to collapse the list at once.
    await js("document.querySelector('[data-sort=project]').focus()");
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' });
    win.webContents.sendInputEvent({ type: 'char', keyCode: 'Enter' });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' });
    await wait("document.querySelector('[data-sort=project]').getAttribute('aria-pressed') === 'true' && document.querySelectorAll('.project-heading').length === 1");
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
    await wait("!document.querySelector('#panel').classList.contains('expanded') && !document.body.classList.contains('resizing') && document.querySelectorAll('.session').length === 2");
    assert.equal(await js("getComputedStyle(document.querySelector('.sort-tools')).display"), 'none');
    await js("document.querySelector('.session-button').click()");
    await wait("document.querySelector('#panel').classList.contains('expanded') && !document.body.classList.contains('resizing') && document.querySelector('[data-sort=project]').getAttribute('aria-pressed') === 'true'");
    await selectSort('activity');
    const hoverUsage = await js("(() => { const box = document.querySelector('[data-limit=fiveHour]').getBoundingClientRect(); return { x: Math.round(box.x + 12), y: Math.round(box.y + 8) }; })()");
    win.webContents.sendInputEvent({ type: 'mouseMove', ...hoverUsage, globalX: win.getBounds().x + hoverUsage.x, globalY: win.getBounds().y + hoverUsage.y });
    await waitTooltip("document.querySelector('#title').textContent === '5-hour limit' && document.querySelector('#detail').textContent.startsWith('Resets in ')");
    assert.match(await tooltipWin.webContents.executeJavaScript("document.body.textContent"), /Account-wide usage.+76% remaining.+Resets in .+Reset:/s);
    await fs.writeFile(path.join(testDir, 'usage-tooltip.png'), (await tooltipWin.webContents.capturePage()).toPNG());
    // A data update replaces the hovered DOM row. Leaving it must still dismiss the card.
    await refreshUsage();
    const leaveUsage = { x: 2, y: 2 };
    win.webContents.sendInputEvent({ type: 'mouseMove', ...leaveUsage, globalX: win.getBounds().x + 2, globalY: win.getBounds().y + 2 });
    await waitNative(() => !tooltipWin.isVisible());
    // Catch used/remaining inversion, the wrong bucket, and old figures after a failed read.
    await wait("document.querySelector('[data-limit=fiveHour] .usage-value').textContent === '76% left' && document.querySelector('[data-limit=weekly] .usage-value').textContent === '84% left'");
    assert.match(await js("document.querySelector('[data-limit=fiveHour] .usage-reset').textContent"), /Resets in/);
    assert.equal(await js("[...document.querySelectorAll('.usage-row')].every(row => { const box = row.getBoundingClientRect(); return box.width > 0 && box.bottom <= innerHeight; })"), true);
    const usageFile = path.join(testDir, 'usage.json');
    const initialUsage = await fs.readFile(usageFile, 'utf8');
    await fs.writeFile(usageFile, JSON.stringify({ error: { code: -32000, message: 'Offline.' } }));
    await refreshUsage();
    await wait("[...document.querySelectorAll('.usage-value')].every(value => value.textContent === 'Unavailable')");
    assert.equal(await js("document.querySelectorAll('.session').length"), 2);
    assert.equal(await js("[...document.querySelectorAll('.usage-track')].every(track => !track.hasAttribute('aria-valuenow'))"), true);
    assert.equal(await js("[...document.querySelectorAll('.usage-reset')].every(reset => reset.hidden && !reset.textContent)"), true);
    await capture('usage-unavailable.png');
    await js("document.querySelector('#expand').click()");
    await wait("!document.querySelector('#panel').classList.contains('expanded') && !document.body.classList.contains('resizing')");
    assert.equal(await js("[...document.querySelectorAll('.gauge-needle')].every(needle => getComputedStyle(needle).visibility === 'hidden')"), true);
    await capture('compact-unavailable.png');
    await fs.writeFile(usageFile, JSON.stringify({ result: { rateLimitsByLimitId: {
      codex_other: { primary: { usedPercent: 0, windowDurationMins: 300, resetsAt: Math.floor(Date.now() / 1000) + 5000 } },
      codex: {
        primary: { usedPercent: 9, windowDurationMins: 10080, resetsAt: Math.floor(Date.now() / 1000) + 10000 },
        secondary: { usedPercent: 96, windowDurationMins: 300, resetsAt: Math.floor(Date.now() / 1000) + 5000 }
      }
    } } }));
    await refreshUsage();
    await wait("document.querySelector('[data-limit=fiveHour] .usage-value').textContent === '4% left' && document.querySelector('[data-limit=weekly] .usage-value').textContent === '91% left'");
    assert.equal(await js("document.querySelector('[data-limit=fiveHour]').classList.contains('empty')"), true);
    assert.equal(await js("getComputedStyle(document.querySelector('[data-limit=fiveHour] .usage-value')).color"), 'rgb(255, 128, 124)');
    assert.equal(await js("getComputedStyle(document.querySelector('[data-limit=fiveHour] .gauge-needle')).stroke"), 'rgb(255, 128, 124)');
    assert.equal(await js("getComputedStyle(document.querySelector('[data-limit=weekly] .gauge-needle')).stroke"), 'rgb(140, 206, 107)');
    await fs.writeFile(usageFile, JSON.stringify({ result: { rateLimits: {
      primary: { usedPercent: 85, windowDurationMins: 300, resetsAt: Math.floor(Date.now() / 1000) + 5000 },
      secondary: { usedPercent: 96, windowDurationMins: 10080, resetsAt: Math.floor(Date.now() / 1000) + 10000 }
    } } }));
    await refreshUsage();
    await wait("document.querySelector('[data-limit=fiveHour] .usage-value').textContent === '15% left'");
    assert.equal(await js("getComputedStyle(document.querySelector('[data-limit=fiveHour] .usage-value')).color"), 'rgb(255, 212, 94)');
    assert.equal(await js("getComputedStyle(document.querySelector('[data-limit=fiveHour] .gauge-needle')).stroke"), 'rgb(255, 212, 94)');
    assert.equal(await js("getComputedStyle(document.querySelector('[data-limit=weekly] .gauge-needle')).stroke"), 'rgb(255, 128, 124)');
    await capture('compact-warning.png');
    await fs.writeFile(usageFile, JSON.stringify({ result: { rateLimits: {
      primary: { usedPercent: 100, windowDurationMins: 300, resetsAt: Math.floor(Date.now() / 1000) + 5000 }, secondary: null
    } } }));
    await refreshUsage();
    await wait("document.querySelector('[data-limit=fiveHour] .usage-value').textContent === '0% left' && document.querySelector('[data-limit=weekly] .usage-value').textContent === 'Unavailable'");
    await capture('compact-empty-limit.png');
    await fs.writeFile(usageFile, JSON.stringify({ result: { rateLimits: {
      primary: { usedPercent: 24, windowDurationMins: 300, resetsAt: Math.floor(Date.now() / 1000) + 2 }, secondary: null
    } } }));
    await refreshUsage();
    await wait("document.querySelector('[data-limit=fiveHour] .usage-value').textContent === '76% left'");
    await new Promise(resolve => setTimeout(resolve, 2100));
    await refresh();
    await wait("document.querySelector('[data-limit=fiveHour] .usage-value').textContent === 'Unavailable'");
    await fs.writeFile(usageFile, initialUsage); await refreshUsage();
    await wait("document.querySelector('[data-limit=fiveHour] .usage-value').textContent === '76% left'");
    await js("document.querySelector('.usage-gauge').click()");
    await wait("document.querySelector('#panel').classList.contains('expanded') && !document.body.classList.contains('resizing')");
    await logLine(data, Date.now() + 1000, `[desktop-notifications] show notification conversationId=${id} kind=approval`);
    await refresh();
    await wait("Boolean(document.querySelector('.dot.waiting'))");
    await capture('expanded.png');
    await js("document.querySelector('.pin').click()");
    await wait("document.querySelector('.pin').getAttribute('aria-pressed') === 'true'");
    assert.equal(await js("document.querySelector('#hide, #quit') === null"), true);
    setStatus(data, id, 'completed'); await refresh();
    await wait("document.querySelectorAll('.dot.idle').length === 2");
    await win.webContents.reload();
    await wait("document.querySelector('#panel').classList.contains('expanded') && document.querySelector('.pin').getAttribute('aria-pressed') === 'true'");
    const persisted = JSON.parse(await fs.readFile(preferences.file, 'utf8'));
    assert.equal(persisted.expanded, true); assert.equal(persisted.pinned.length, 1);
    assert.ok(Math.abs(persisted.y - (dragStart.y - 20)) <= 1);
    assert.ok(Math.abs(win.getBounds().y - persisted.y) <= 1);
    assert.equal(await js("document.querySelectorAll('.session').length"), 2);
    assert.equal(await js("[...document.querySelectorAll('button')].filter(b => getComputedStyle(b).display !== 'none').every(b => b.getBoundingClientRect().right <= innerWidth)"), true);
    assert.equal(errors.length, 0, errors.join('\n'));
    // Many chats must not move lights off center or hide the usage controls.
    const many = new DatabaseSync(path.join(data.root, 'state_5.sqlite'));
    const copy = many.prepare('INSERT INTO threads SELECT ?, ?, name, cwd, source, originator, rollout_path, updated_at, archived FROM threads WHERE id = ?');
    for (let index = 3; index <= 24; index++) copy.run(`${String(index).padStart(8, '0')}-1111-4111-8111-111111111111`, `Extra chat ${index}`, id);
    many.close(); await refresh();
    await wait("document.querySelectorAll('.session').length === 24");
    assert.equal(await js("document.querySelector('#sessions').scrollHeight > document.querySelector('#sessions').clientHeight"), true);
    assert.equal(await js("['#usage', 'footer'].every(selector => document.querySelector(selector).getBoundingClientRect().bottom <= innerHeight + 0.5)"), true);
    await js("document.querySelector('#expand').click()");
    await wait("!document.querySelector('#panel').classList.contains('expanded') && !document.body.classList.contains('resizing')");
    const longCenters = await js(`['#panel', '.dot', '.usage-gauge'].map(selector => { const box = document.querySelector(selector).getBoundingClientRect(); return box.x + box.width / 2; })`);
    assert.ok(Math.max(...longCenters) - Math.min(...longCenters) < 0.5, `Long list lights are off center: ${longCenters}`);
    assert.equal(await js("document.querySelector('#usage').getBoundingClientRect().bottom <= innerHeight + 0.5"), true);
    await capture('compact-many-chats.png');
    await js("document.querySelector('.usage-gauge').click()");
    await wait("document.querySelector('#panel').classList.contains('expanded') && !document.body.classList.contains('resizing')");
    await js("document.querySelector('.session-button').focus(); document.querySelector('.session:last-child').scrollIntoView({ block: 'end' })");
    const scrollBefore = await js("document.querySelector('#sessions').scrollTop");
    assert.ok(scrollBefore > 0);
    const changed = new DatabaseSync(path.join(data.root, 'state_5.sqlite'));
    changed.prepare('UPDATE threads SET title = ? WHERE id = ?').run('Updated service title', id); changed.close();
    await refresh(); await wait("document.querySelector('#sessions').textContent.includes('Updated service title')");
    assert.ok(Math.abs(await js("document.querySelector('#sessions').scrollTop") - scrollBefore) < 1, 'A session refresh lost the scroll position.');
    assert.equal(errors.length, 0, errors.join('\n'));
    // Usage must remain accessible when there are no local chats.
    const db = new DatabaseSync(path.join(data.root, 'state_5.sqlite'));
    db.exec('UPDATE threads SET archived = 1'); db.close();
    await refresh();
    await wait("document.querySelectorAll('.session').length === 0 && !document.querySelector('#empty').hidden");
    assert.equal(await js("['#empty', '#usage', 'footer'].every(selector => { const box = document.querySelector(selector).getBoundingClientRect(); return box.height > 0 && box.bottom <= innerHeight + 0.5; })"), true);
    await capture('empty.png');
    await js("document.querySelector('#expand').click()");
    await wait("!document.querySelector('#panel').classList.contains('expanded') && !document.body.classList.contains('resizing')");
    assert.equal(await js("['#empty', '#usage'].every(selector => { const box = document.querySelector(selector).getBoundingClientRect(); return box.height > 0 && box.bottom <= innerHeight + 0.5; })"), true);
    await capture('compact-no-chats.png');
    // Catch hard-coded provider names, limit ids, and one provider hiding another's usage.
    const providerFile = path.join(testDir, 'provider.json');
    const atlas = { sessions: [{ id: '11111111-1111-4111-8111-111111111111', title: 'Atlas build', project: 'lab', state: 'waiting', detail: 'Input requested.', updatedAt: Date.now() - 300_000 }],
      windows: [{ id: 'daily', label: 'Daily', title: 'Daily allowance', remainingPercent: 31, resetsAt: Math.floor(Date.now() / 1000) + 8000 },
        { id: 'budget', label: 'Budget', remainingPercent: 50 }] };
    await fs.writeFile(providerFile, JSON.stringify(atlas)); await refresh(); await refreshUsage();
    await wait("document.querySelectorAll('.session').length === 1 && document.querySelectorAll('.usage-row').length === 4");
    const extraGauge = await js("(() => { const box = document.querySelector('[data-provider=atlas][data-limit=daily]').getBoundingClientRect(); return { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) }; })()");
    win.webContents.sendInputEvent({ type: 'mouseMove', ...extraGauge, globalX: win.getBounds().x + extraGauge.x, globalY: win.getBounds().y + extraGauge.y });
    await waitTooltip("document.querySelector('#title').textContent === 'Daily allowance' && document.querySelector('#meta').textContent === 'Atlas · Workspace usage'");
    assert.match(await tooltipWin.webContents.executeJavaScript("document.body.textContent"), /31% remaining.+Resets in/s);
    await fs.writeFile(path.join(testDir, 'provider-tooltip.png'), (await tooltipWin.webContents.capturePage()).toPNG());
    await js("document.querySelector('.session-button').click()");
    await wait("document.querySelector('#panel').classList.contains('expanded') && !document.body.classList.contains('resizing')");
    assert.equal(await js("document.querySelector('[data-provider=atlas][data-limit=daily] .usage-value').textContent"), '31% left');
    assert.equal(await js("document.querySelector('[data-provider=atlas][data-limit=budget] .usage-value').textContent"), '50% left');
    assert.equal(await js("document.querySelector('[data-provider=atlas][data-limit=budget] .usage-reset').textContent"), '');
    assert.equal(await js("document.querySelector('.session-activity').textContent"), '5m ago');
    await capture('multiple-providers.png');
    await js("document.querySelector('.session-button').click()");
    await wait("window.sessionLights.read().then(() => document.querySelector('#error').hidden)");
    const openedDeadline = Date.now() + 5000;
    while (!await fs.readFile(`${providerFile}.opened`, 'utf8').catch(() => '')) {
      if (Date.now() > openedDeadline) throw Error('The adapter did not open its chat.');
      await new Promise(resolve => setTimeout(resolve, 30));
    }
    assert.equal(await fs.readFile(`${providerFile}.opened`, 'utf8'), required(atlas.sessions[0]).id);
    await fs.writeFile(providerFile, JSON.stringify({ ...atlas, failUsage: true })); await refreshUsage();
    await wait("document.querySelectorAll('[data-provider=atlas]').length === 0 && document.querySelector('[data-provider=codex][data-limit=fiveHour] .usage-value').textContent === '76% left'");
    assert.equal(await js("document.querySelectorAll('.session').length"), 1);
    await fs.writeFile(providerFile, JSON.stringify(atlas)); await refreshUsage();
    await wait("document.querySelector('[data-provider=atlas][data-limit=daily] .usage-value').textContent === '31% left'");
    await fs.writeFile(providerFile, JSON.stringify({ ...atlas, windows: 'unsupported' })); await refreshUsage();
    await wait("document.querySelectorAll('[data-provider=atlas]').length === 0 && document.querySelector('[data-provider=codex][data-limit=fiveHour] .usage-value').textContent === '76% left'");
    await fs.writeFile(providerFile, JSON.stringify(atlas)); await refreshUsage();
    await wait("document.querySelector('[data-provider=atlas][data-limit=daily] .usage-value').textContent === '31% left'");
    assert.equal(errors.length, 0, errors.join('\n'));
    // Same paths from different providers group together. Equal folder names at different paths must not merge.
    const projectDb = new DatabaseSync(path.join(data.root, 'state_5.sqlite'));
    projectDb.prepare('UPDATE threads SET archived = 0, cwd = ? WHERE id = ?').run('C:/work/project', id);
    projectDb.prepare('UPDATE threads SET archived = 0, cwd = ? WHERE id = ?').run('C:/other/project', '22222222-2222-4222-8222-222222222222');
    projectDb.close();
    const projectAtlas = { ...atlas, sessions: [
      { id: 'shared', title: 'Atlas shared folder', project: 'Alias', workspace: 'c:\\WORK\\project\\', state: 'working', detail: 'Working.', updatedAt: Date.now() },
      { id: 'missing', title: 'No project supplied', state: 'idle', detail: 'Finished.', updatedAt: 0 },
      { id: 'named', title: 'Named project', project: 'Design', projectId: 'repo:design', state: 'idle', detail: 'Finished.', updatedAt: Date.now() },
      { id: 'remote', title: 'Remote design chat', projectId: 'repo:design', state: 'working', detail: 'Working.', updatedAt: Date.now() },
      { id: 'other', title: 'Other design project', project: 'Design', projectId: 'repo:other-design', state: 'idle', detail: 'Finished.', updatedAt: Date.now() }
    ] };
    await fs.writeFile(providerFile, JSON.stringify(projectAtlas)); await refresh(); await selectSort('project');
    await wait("document.querySelectorAll('.session').length === 7 && document.querySelectorAll('.project-heading').length === 4 && document.querySelector('.bookmarked-heading') !== null");
    assert.equal(await js("[...document.querySelectorAll('.session-project')].some(project => project.textContent === 'No workspace')"), true);
    assert.equal(await js(`(() => {
      const time = document.querySelector('[data-key="atlas:missing"] .session-activity');
      return time.textContent === '–' && !time.hasAttribute('datetime') && time.getAttribute('aria-label') === 'Last activity: Time unavailable';
    })()`), true);
    assert.equal(await js("[...document.querySelectorAll('.session-button')].find(button => button.dataset.key === 'atlas:remote').querySelector('.session-project').textContent"), 'repo:design');
    assert.equal(await js(`(() => {
      const groups = []; for (const child of document.querySelector('#sessions').children) {
        if (child.classList.contains('project-heading') || child.classList.contains('section-heading')) groups.push({ title: child.textContent, keys: [] });
        else groups.at(-1).keys.push(child.querySelector('.session-button').dataset.key);
      }
      return groups.some(group => group.keys.includes('codex:${id}') && group.keys.includes('atlas:shared')) &&
        groups.some(group => group.keys.includes('codex:22222222-2222-4222-8222-222222222222') && group.keys.length === 1) &&
        groups.some(group => group.keys.includes('atlas:named') && group.keys.includes('atlas:remote') && group.keys.length === 2) &&
        groups.some(group => group.keys.includes('atlas:other') && group.keys.length === 1);
    })()`), true);
    assert.equal(await js("[...document.querySelectorAll('.project-heading')].at(-1).querySelector('.project-name').textContent"), 'No workspace');
    assert.equal(await js("['#usage', 'footer'].every(selector => document.querySelector(selector).getBoundingClientRect().bottom <= innerHeight + 0.5)"), true);
    await capture('project-groups.png');
    // Hover events are ignored during a sort resize. Check the stable panel.
    await wait('window.sessionLights.read().then(value => !value.motion)');
    const projectHover = await js("(() => { const box = document.querySelector('.project-heading').getBoundingClientRect(); return { x: Math.round(box.x + 10), y: Math.round(box.y + 12) }; })()");
    win.webContents.sendInputEvent({ type: 'mouseMove', ...projectHover, globalX: win.getBounds().x + projectHover.x, globalY: win.getBounds().y + projectHover.y });
    await waitTooltip("document.querySelector('#meta').textContent.includes('Codex') && document.querySelector('#meta').textContent.includes('Atlas')");
    assert.match(await tooltipWin.webContents.executeJavaScript("document.querySelector('#detail').textContent"), /work.*project/i);
    await fs.writeFile(path.join(testDir, 'project-tooltip.png'), (await tooltipWin.webContents.capturePage()).toPNG());
    await js("document.querySelector('#expand').click()");
    await wait("!document.querySelector('#panel').classList.contains('expanded') && !document.body.classList.contains('resizing') && document.querySelectorAll('.session').length === 7 && document.querySelectorAll('.project-heading').length === 0");
    assert.equal(await js("getComputedStyle(document.querySelector('.sort-tools')).display"), 'none');
    await capture('compact-project-order.png');
    await js("document.querySelector('.session-button').click()");
    await wait("document.querySelector('#panel').classList.contains('expanded') && !document.body.classList.contains('resizing') && document.querySelectorAll('.session').length === 7");
    await win.webContents.reload();
    await wait("document.querySelector('[data-sort=project]').getAttribute('aria-pressed') === 'true' && document.querySelectorAll('.project-heading').length === 4");
    await reloadedPreferences.load(); assert.equal(reloadedPreferences.value.sortOrder, 'project');
    assert.equal(reloadedPreferences.value.pinned.length, 1);
    assert.ok(Math.abs(required(reloadedPreferences.value.y) - (dragStart.y - 20)) <= 1);
    assert.equal(errors.length, 0, errors.join('\n'));
    // Catch bookmarks falling back into project groups and hidden chats returning after refresh.
    const clickControl = async (selector: string) => {
      const point = await js(`(() => {
        const button = document.querySelector(${JSON.stringify(selector)});
        button.scrollIntoView({ block: 'nearest' });
        const box = button.getBoundingClientRect();
        return { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) };
      })()`);
      win.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...point });
      win.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...point });
    };
    const bookmarkKey = 'codex:22222222-2222-4222-8222-222222222222';
    assert.equal(await js("document.querySelector('.session-button').dataset.key"), bookmarkKey);
    assert.equal(await js("document.querySelector('#sessions').firstElementChild.textContent"), 'Bookmarked');
    await capture('bookmarks-project.png');
    await selectSort('activity');
    assert.equal(await js("document.querySelector('.session-button').dataset.key"), bookmarkKey);
    await capture('bookmarks-activity.png');
    await clickControl('.hide-session[data-key="atlas:other"]');
    await wait("!document.querySelector('.session-button[data-key=\"atlas:other\"]') && document.querySelector('#hidden-sessions').textContent === '1 session hidden'");
    await clickControl('.hide-session[data-key="' + bookmarkKey + '"]');
    await wait("document.querySelector('#hidden-sessions').textContent === '2 sessions hidden' && document.querySelectorAll('.session').length === 5");
    await refresh();
    assert.equal(await js(`document.querySelector('.session-button[data-key="${bookmarkKey}"]') === null`), true);
    await win.webContents.reload();
    await wait("document.querySelector('#hidden-sessions').textContent === '2 sessions hidden' && document.querySelectorAll('.session').length === 5");
    await capture('sessions-hidden.png');
    await clickControl('#expand');
    await wait("!document.querySelector('#panel').classList.contains('expanded') && !document.body.classList.contains('resizing')");
    assert.equal(await js("document.querySelectorAll('.dot').length"), 5);
    await capture('hidden-compact.png');
    await clickControl('.session-button');
    await wait("document.querySelector('#panel').classList.contains('expanded') && !document.body.classList.contains('resizing')");
    // Keyboard access must expose hidden chats without opening a chat in its provider.
    await js("document.querySelector('#hidden-sessions').focus()");
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' });
    win.webContents.sendInputEvent({ type: 'char', keyCode: 'Enter' });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' });
    await wait("document.querySelectorAll('.hidden-session').length === 2 && document.querySelector('#hidden-sessions').getAttribute('aria-expanded') === 'true'");
    await capture('restore-hidden-sessions.png');
    await clickControl('.restore-session[data-key="' + bookmarkKey + '"]');
    await wait(`document.querySelector('.session-button').dataset.key === ${JSON.stringify(bookmarkKey)} && document.querySelectorAll('.hidden-session').length === 1 && document.querySelector('#hidden-sessions').textContent === '1 session hidden'`);
    assert.equal(await js("document.querySelector('.pin').getAttribute('aria-pressed')"), 'true');
    await clickControl('.restore-all');
    await wait("document.querySelectorAll('.session').length === 7 && document.querySelector('#hidden-sessions').hidden && document.querySelectorAll('.hidden-session').length === 0");
    await capture('sessions-restored.png');
    // The count must stay reachable when every chat is hidden.
    const sessionKeys: string[] = await js("[...document.querySelectorAll('.session-button')].map(button => button.dataset.key)");
    for (const key of sessionKeys) {
      await clickControl('.hide-session[data-key="' + key + '"]');
      await wait(`document.querySelector('.hide-session[data-key="${key}"]') === null`);
    }
    await wait("document.querySelector('#hidden-sessions').textContent === '7 sessions hidden' && document.querySelector('#empty .wide').textContent === 'All sessions are hidden.'");
    await capture('all-sessions-hidden.png');
    await clickControl('#hidden-sessions');
    await wait("document.querySelectorAll('.hidden-session').length === 7");
    await clickControl('.restore-all');
    await wait("document.querySelectorAll('.session').length === 7 && document.querySelector('#hidden-sessions').hidden");
    await selectSort('project');
    await capture('bookmarks-restored-project.png');
    assert.deepEqual(errors, [], 'Renderer errors after hiding and restoring.');
    const report = { result: 'passed', checks: ['always on top', 'half-width compact bar', 'compact center alignment', 'equal top and bottom spacing', 'compact and expanded panels touch screen edge', 'small plain lights', 'no compact icons or grip', 'no hover highlight', 'grab and grabbing cursors', 'panel follows held drag', 'reverse drag without overshoot', 'drag position survives refresh and is saved on release', 'click light to show names', 'no panel title', 'only activity and project sorting', 'no legend or extra text', 'no recent-only or quit button', 'workspace in tooltip', 'short list needs no scrollbar', 'compact divider and two gauges', 'green gauges and limit tooltips', 'click gauge to expand', 'red yellow and green follow amount left', 'unavailable gauge clears pointer', 'compact gauges fit with no chats', 'remaining percentages and reset tooltip', 'usage bars fit expanded panel', 'usage failure clears figures and keeps sessions', 'usage connection recovers', 'Codex bucket and window duration selection', 'empty and missing usage windows', 'reset clears expired figures until new data arrives', 'usage fits with no local chats', 'live approval', 'pin', 'old chats visible with old show-all setting', 'panel has no close or quit control', 'live completion', 'reload and persistence', 'horizontal fit', 'no renderer errors'] };
    report.checks.push('bookmarks stay above all project groups', 'bookmarks stay above activity sessions', 'hide control removes a session', 'hidden count stays at the bottom', 'hidden sessions stay hidden after refresh and reload', 'compact lights exclude hidden sessions', 'keyboard opens hidden sessions', 'individual restore preserves a bookmark', 'restore all returns every session', 'all sessions can be hidden and restored');
    report.checks.push('long lists keep compact lights centered', 'long lists keep usage and controls visible', 'background updates preserve scroll position');
    report.checks.push('last activity ages fit on the right', 'row timestamp matches adapter activity', 'row ages update without changed data', 'second provider supplies last activity', 'unavailable activity shows a dash');
    report.checks.push('expand through intermediate widths', 'collapse through intermediate widths', 'screen edge stays fixed during animation', 'refresh does not interrupt animation', 'quick reversal reaches the requested state', 'reduced motion skips animation');
    report.checks.push('styled session tooltip outside compact window', 'tooltip does not take focus', 'tooltip hides before dragging', 'usage tooltip shows scope and countdown',
      'search and state filter removed', 'sort buttons fit one row above chats', 'only one sort button selected', 'keyboard activates sorting',
      'Escape collapses at once', 'sort survives collapse and expansion', 'second provider supplies arbitrary usage limits', 'usage without reset time remains available',
      'second provider tooltip uses its name and scope', 'chat opening routes to its adapter', 'usage failure is isolated by provider', 'provider usage recovers', 'tooltip dismisses after its row is replaced',
      'unsupported provider usage does not stop other providers and recovers');
    report.checks.push('project shown in each session row', 'legacy invalid sort setting falls back to activity', 'latest activity sort', 'project sort', 'sort choice survives reload and saved preferences',
      'pins stay first in activity order', 'same workspace groups across providers and Windows path spellings', 'same folder name at different paths stays separate', 'missing workspace has a useful label',
      'project groups keep usage and footer visible', 'project heading tooltip shows full path and providers', 'compact project order has no headings or controls',
      'project grouping survives reload with pins and position intact', 'shared project ID groups chats with different labels', 'different project IDs with equal labels stay separate', 'project ID supplies a label when its name is missing');
    // Simulate OS setting reads without changing the user's Windows settings.
    for (const percent of [125, 150, 225, 100]) {
      const scale = percent / 100;
      await fs.writeFile(path.join(testDir, 'system-text-percent.json'), String(percent));
      await refresh();
      await wait(`window.sessionLights.read().then(value => value.textScale === ${scale})`);
      // Native Windows DPI conversion can round the requested width by one pixel.
      assert.ok(Math.abs(win.getBounds().width - Math.round(328 * scale)) <= 1, 'Expanded width exceeds DPI rounding tolerance.'); checkScreenEdge();
      assert.ok(Math.abs(await js("document.querySelector('.session').getBoundingClientRect().height") - 40 * scale) < 0.5);
      assert.equal(await js("Math.abs(document.querySelector('#panel').getBoundingClientRect().right - innerWidth) <= 1 && Math.abs(document.querySelector('#panel').getBoundingClientRect().width - innerWidth) <= 1 && document.querySelector('footer').getBoundingClientRect().bottom <= innerHeight + 1"), true);
      await capture(`system-text-${percent}.png`);
      if (percent === 225) {
        await clickControl('.hide-session[data-key="atlas:other"]');
        await wait("document.querySelector('#hidden-sessions').textContent === '1 session hidden'");
        await clickControl('#hidden-sessions');
        await wait("document.querySelectorAll('.hidden-session').length === 1");
        assert.equal(await js("['#hidden-sessions', '.restore-session', '.restore-all', '#usage', 'footer'].every(selector => { const box = document.querySelector(selector).getBoundingClientRect(); return box.width > 0 && box.right <= innerWidth + 1 && box.bottom <= innerHeight + 1; })"), true);
        await capture('hidden-system-text-225.png');
        await clickControl('.restore-all');
        await wait("document.querySelectorAll('.session').length === 7 && document.querySelector('#hidden-sessions').hidden");
      }
      await js("document.querySelector('header [data-settings]').click()");
      await waitNative(() => settingsWin.isVisible());
      await waitSettings(`document.body.style.getPropertyValue('--text-scale') === '${scale}'`);
      assert.equal(await settingsJs("[...document.querySelectorAll('.adapter-row, footer')].every(row => row.getBoundingClientRect().bottom <= innerHeight + 1)"), true);
      await settingsJs('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
      await fs.writeFile(path.join(testDir, `adapter-controls-text-${percent}.png`), (await settingsWin.webContents.capturePage()).toPNG());
      await closeSettings();
      const key = await js("document.querySelector('.session-button').dataset.key");
      await js(`window.sessionLights.tooltip({ kind: 'session', key: ${JSON.stringify(key)}, y: 40 })`);
      await waitTooltip("document.body.style.zoom === '" + scale + "'");
      assert.ok(Math.abs(tooltipWin.getBounds().width - Math.round(280 * scale)) <= 1, 'Tooltip width exceeds DPI rounding tolerance.');
      await js('window.sessionLights.tooltip(null)');
      assert.equal(await js("document.querySelector('select, #text-size') === null"), true);
      assert.equal(await js("window.sessionLights.read().then(value => 'textSize' in value.preferences)"), false);
      await js('window.sessionLights.action({ type: "expand", reducedMotion: true })');
      await wait("!document.querySelector('#panel').classList.contains('expanded')");
      assert.ok(Math.abs(win.getBounds().width - nativeWidth) <= 1);
      assert.equal(await js("document.querySelector('#panel').getBoundingClientRect().width"), 26);
      await js('window.sessionLights.action({ type: "expand", reducedMotion: true })');
      await wait("document.querySelector('#panel').classList.contains('expanded')");
    }
    assert.deepEqual(errors, [], 'Renderer errors after system text changes.');
    report.checks.push('system text changes update the panel automatically', 'large system text fits long lists and controls up to 225 percent', 'hover cards follow system text size', 'no text selector or saved text override', 'compact panel stays narrow at every text size', 'compact gear opens settings to the left', 'development updates are disabled', 'Escape closes Settings');
    report.checks.push(...await checkThemes({ win, settingsWin, tooltipWin, testDir, refresh }));
    assert.deepEqual(errors, [], 'Renderer errors after theme changes.');
    // Catch hidden-session rows leaking from a hidden adapter or lost session choices when it returns.
    await clickControl('.hide-session[data-key="atlas:other"]');
    await wait("document.querySelector('#hidden-sessions').textContent === '1 session hidden'");
    await js("document.querySelector('header [data-settings]').click()");
    await waitNative(() => settingsWin.isVisible());
    await toggleAdapter('atlas');
    await wait("document.querySelectorAll('.session').length === 2 && document.querySelector('#hidden-sessions').hidden");
    await toggleAdapter('atlas');
    await wait("document.querySelectorAll('.session').length === 6 && document.querySelector('#hidden-sessions').textContent === '1 session hidden'");
    await closeSettings();
    await clickControl('#hidden-sessions');
    await wait("document.querySelectorAll('.hidden-session').length === 1");
    await clickControl('.restore-all');
    await wait("document.querySelectorAll('.session').length === 7 && document.querySelector('#hidden-sessions').hidden");
    report.checks.push('session hiding survives adapter hiding and hidden counts exclude hidden adapters');
    // Catch missing CLI lights, duplicate usage, and a CLI switch that hides desktop sessions.
    const cliId = '33333333-3333-4333-8333-333333333333';
    const cliDb = new DatabaseSync(path.join(data.root, 'state_5.sqlite'));
    const cliRollout = path.join(data.root, cliId + '.jsonl');
    cliDb.prepare('INSERT INTO threads VALUES (?, ?, NULL, ?, ?, ?, ?, ?, 0)').run(cliId, 'CLI panel check', testDir, 'cli', 'codex-tui', cliRollout, Math.floor(Date.now() / 1000));
    cliDb.close();
    await rolloutLine(data, cliId, Date.now(), 'event_msg', { type: 'task_started', turn_id: 'cli-ui' });
    await refresh();
    await wait("document.querySelectorAll('.session').length === 8 && document.querySelector('[data-key=\"codex-cli:" + cliId + "\"] .dot').classList.contains('working')");
    assert.equal(await js("document.querySelectorAll('[data-provider=codex]').length"), 2);
    await js("document.querySelector('header [data-settings]').click()");
    await waitNative(() => settingsWin.isVisible());
    await toggleAdapter('codex-cli');
    await wait("document.querySelectorAll('.session').length === 7 && !document.querySelector('[data-key=\"codex-cli:" + cliId + "\"]')");
    await rolloutLine(data, cliId, Date.now() + 1, 'event_msg', { type: 'task_complete', turn_id: 'cli-ui' });
    await refresh(); await toggleAdapter('codex-cli');
    await wait("Boolean(document.querySelector('[data-key=\"codex-cli:" + cliId + "\"] .dot.idle'))");
    await fs.writeFile(path.join(testDir, 'cli-adapter-settings.png'), (await settingsWin.webContents.capturePage()).toPNG());
    await closeSettings(); await capture('cli-sessions.png');
    const archiveCli = new DatabaseSync(path.join(data.root, 'state_5.sqlite'));
    archiveCli.prepare('UPDATE threads SET archived = 1 WHERE id = ?').run(cliId); archiveCli.close();
    await refresh(); await wait("document.querySelectorAll('.session').length === 7");
    report.checks.push('CLI sessions appear beside desktop sessions with one set of account limits', 'CLI switch hides only CLI sessions and restores their latest state', 'archived CLI sessions leave the panel');
    // Catch hidden sessions or gauges that remain visible, lost pins, stopped reads, and unsaved switches.
    await js("document.querySelector('header [data-settings]').click()");
    await waitNative(() => settingsWin.isVisible());
    await waitSettings("document.querySelectorAll('input[role=switch]').length === 3 && [...document.querySelectorAll('input[role=switch]')].every(input => input.checked)");
    assert.deepEqual(await settingsJs("[...document.querySelectorAll('.adapter-row')].map(row => row.textContent)"), ['Codex', 'Codex CLI', 'Atlas']);
    assert.equal(await settingsJs("[...document.querySelectorAll('.adapter-row, footer')].every(row => row.getBoundingClientRect().bottom <= innerHeight)"), true);
    await fs.writeFile(path.join(testDir, 'adapter-controls.png'), (await settingsWin.webContents.capturePage()).toPNG());
    await settingsJs("document.querySelector('#quit').focus()");
    settingsWin.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Tab' });
    settingsWin.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Tab' });
    await waitSettings("document.activeElement.name === 'theme' && document.activeElement.matches(':focus-visible')");
    settingsWin.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Tab' });
    settingsWin.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Tab' });
    await waitSettings("document.activeElement.dataset.adapter === 'codex' && document.activeElement.matches(':focus-visible')");
    await toggleAdapter('codex');
    await wait("document.querySelectorAll('.session').length === 5 && document.querySelectorAll('[data-provider=codex]').length === 0");
    assert.equal(await js("window.sessionLights.read().then(value => value.sources.every(source => source.id !== 'codex') && value.sessions.every(session => session.providerId !== 'codex'))"), true);
    assert.equal(await settingsJs("document.activeElement.dataset.adapter"), 'codex');
    await closeSettings();
    await capture('adapter-one-hidden.png');
    await js('window.sessionLights.action({ type: "expand", reducedMotion: true })');
    await wait("!document.querySelector('#panel').classList.contains('expanded') && document.querySelectorAll('.session').length === 5");
    assert.equal(await js("document.querySelectorAll('[data-provider=codex]').length"), 0);
    await capture('adapter-one-hidden-compact.png');
    const hiddenDb = new DatabaseSync(path.join(data.root, 'state_5.sqlite'));
    hiddenDb.prepare('UPDATE threads SET title = ? WHERE id = ?').run('Hidden Codex update', id); hiddenDb.close();
    setStatus(data, id, 'failed');
    await refresh();
    const hiddenUsage = { result: { rateLimitsByLimitId: { codex: {
      primary: { usedPercent: 40, windowDurationMins: 300, resetsAt: Math.floor(Date.now() / 1000) + 7200 },
      secondary: { usedPercent: 16, windowDurationMins: 10080, resetsAt: Math.floor(Date.now() / 1000) + 345600 }
    } } } };
    await fs.writeFile(path.join(testDir, 'usage.json'), JSON.stringify(hiddenUsage)); await refreshUsage();
    await js("document.querySelector('footer [data-settings]').click()");
    await waitNative(() => settingsWin.isVisible());
    await toggleAdapter('codex');
    await wait("document.querySelectorAll('.session').length === 7 && document.querySelector('[data-provider=codex][data-limit=fiveHour] .usage-value').textContent === '60% left'");
    await closeSettings();
    await js('window.sessionLights.action({ type: "expand", reducedMotion: true })');
    await wait("document.querySelector('#panel').classList.contains('expanded') && document.querySelector('#sessions').textContent.includes('Hidden Codex update')");
    assert.equal(await js(`document.querySelector('[data-key="codex:${id}"] .dot').classList.contains('error')`), true);
    assert.equal(await js("document.querySelectorAll('.pin[aria-pressed=true]').length"), 1);
    // A failed preference write must restore the switch and keep the displayed adapter visible.
    await fs.mkdir(`${preferences.file}.tmp`);
    await js("document.querySelector('header [data-settings]').click()");
    await waitNative(() => settingsWin.isVisible());
    await toggleAdapter('codex');
    await waitSettings("!document.querySelector('#error').hidden && document.querySelector('[data-adapter=codex]').checked");
    assert.equal(await js("document.querySelectorAll('.session').length"), 7);
    await fs.rename(`${preferences.file}.tmp`, path.join(testDir, 'failed-write-temp'));
    await toggleAdapter('codex');
    await wait("document.querySelectorAll('.session').length === 5");
    await toggleAdapter('atlas');
    await toggleAdapter('codex-cli');
    await wait("!document.querySelector('#adapters-hidden').hidden && document.querySelectorAll('.session, .usage-row, .project-heading').length === 0");
    await closeSettings();
    assert.equal(await js("['#adapters-hidden', 'footer'].every(selector => { const box = document.querySelector(selector).getBoundingClientRect(); return box.height > 0 && box.bottom <= innerHeight; })"), true);
    await capture('adapter-all-hidden.png');
    await js("document.querySelector('#empty-settings').click()");
    await waitNative(() => settingsWin.isVisible());
    await closeSettings();
    await js('window.sessionLights.action({ type: "expand", reducedMotion: true })');
    await wait("!document.querySelector('#panel').classList.contains('expanded')");
    await capture('adapter-all-hidden-compact.png');
    await js("document.querySelector('#empty-settings').click()");
    await waitNative(() => settingsWin.isVisible());
    await closeSettings();
    await js('window.sessionLights.action({ type: "expand", reducedMotion: true })');
    await wait("document.querySelector('#panel').classList.contains('expanded')");
    assert.deepEqual(errors, []);
    report.checks.push('all registered adapters have labelled switches and start visible with legacy settings', 'Tab reaches the adapter switch with a visible focus outline',
      'Space hides the adapter immediately and keeps switch focus', 'hidden adapters have no sessions, usage, sources, or project headings',
      'visibility applies to compact and expanded views', 'hidden adapters keep reading session and usage changes', 'showing an adapter restores pins and current readings',
      'failed preference write restores the switch and keeps sessions visible', 'all-hidden state explains the result and links to Settings', 'empty state fits compact and expanded panels');
    await fs.writeFile(path.join(testDir, 'report.json'), JSON.stringify(report, null, 2));
    console.log(`Desktop checks passed: ${report.checks.length}.`);
    // Catch Quit that leaves the app or its automatic usage runtime running.
    await js("document.querySelector('header [data-settings]').click()");
    await waitNative(() => settingsWin.isVisible());
    void settingsJs("document.querySelector('#quit').click()").catch(() => { /* Quit can close the renderer before the click reply. */ });
  } catch (error) {
    try { await capture('failure.png'); } catch (captureError) { console.error('Screenshot failed:', errorMessage(captureError)); }
    console.error(error); app.exit(1);
  }
}
export { run };
