import { required } from '../test/assertions.js';
import type { App, BrowserWindow, Rectangle } from 'electron';
import { DatabaseSync } from 'node:sqlite';
import { Preferences } from '../src/preferences.js';
import type { SortOrder } from '../src/shared/contracts.js';
import { errorMessage } from '../src/shared/validation.js';
interface DesktopCheckOptions { app: App; win: BrowserWindow; tooltipWin: BrowserWindow; refresh: () => Promise<void>; refreshUsage: () => Promise<void>; showPanel: () => void; testDir: string; preferences: Preferences }
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as assert from 'node:assert/strict';
import { screen } from 'electron';
import { logLine, setStatus } from '../test/fixtures.js';

async function run({ app, win, tooltipWin, refresh, refreshUsage, showPanel, testDir, preferences }: DesktopCheckOptions) {
  const errors: string[] = [];
  win.webContents.on('console-message', event => { if (event.level === 'error') errors.push(event.message); });
  tooltipWin.webContents.on('console-message', event => { if (event.level === 'error') errors.push(event.message); });
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
  const js = (code: string) => win.webContents.executeJavaScript(code);
  const wait = async (condition: string) => {
    const deadline = Date.now() + 5000;
    while (!await js(condition)) { if (Date.now() > deadline) throw Error(`UI did not reach: ${condition}`); await new Promise(resolve => setTimeout(resolve, 30)); }
  };
  const capture = async (name: string) => {
    await js('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    await fs.writeFile(path.join(testDir, name), (await win.webContents.capturePage()).toPNG());
  };
  const data = { root: path.join(testDir, 'codex'), log: path.join(testDir, 'logs', ...new Date().toISOString().slice(0, 10).split('-'), 'desktop.log') };
  const id = '11111111-1111-4111-8111-111111111111';
  try {
    win.webContents.debugger.attach('1.3');
    await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
    showPanel();
    await wait("document.visibilityState === 'visible'");
    await wait("document.querySelectorAll('.session').length === 2");
    console.log('Native window:', JSON.stringify({ visible: win.isVisible(), alwaysOnTop: win.isAlwaysOnTop(), bounds: win.getBounds(), platform: process.platform }));
    assert.equal(win.isAlwaysOnTop(), true);
    const nativeWidth = await js('window.sessionLights.read().then(value => value.compactInset + 26)');
    assert.ok(nativeWidth >= 26 && nativeWidth <= 40, 'Unexpected native compact width.');
    assert.ok(Math.abs(win.getBounds().width - nativeWidth) <= 1, 'Native width exceeds DPI rounding tolerance.');
    assert.equal(await js("document.querySelector('#panel').getBoundingClientRect().width"), 26);
    assert.ok(win.getBounds().height <= 128);
    assert.equal(await js("Boolean(document.querySelector('.dot.working'))"), true);
    const centers = await js(`['#panel', '.usage-row:nth-child(1) .usage-gauge', '.usage-row:nth-child(2) .usage-gauge', ...Array.from(document.querySelectorAll('.dot'), (_, i) => '.session:nth-child(' + (i + 1) + ') .dot')].map(selector => {
      const box = document.querySelector(selector).getBoundingClientRect(); return box.x + box.width / 2;
    })`);
    assert.ok(Math.max(...centers) - Math.min(...centers) < 0.5, `Compact elements are off center: ${centers}`);
    // Catch unequal end spacing and a remaining transparent gap at the screen edge.
    const spacing = await js(`(() => {
      const panel = document.querySelector('#panel').getBoundingClientRect();
      const dots = [...document.querySelectorAll('.dot')].map(dot => dot.getBoundingClientRect());
      const lastGauge = document.querySelector('.usage-row:last-child svg').getBoundingClientRect();
      const style = getComputedStyle(document.querySelector('#panel'));
      return { top: dots[0].top - panel.top, bottom: panel.bottom - lastGauge.bottom,
        right: panel.right, viewport: innerWidth, radiusTop: style.borderTopRightRadius, radiusBottom: style.borderBottomRightRadius };
    })()`);
    assert.ok(Math.abs(spacing.top - spacing.bottom) < 0.5, `End spacing differs: ${JSON.stringify(spacing)}`);
    assert.ok(Math.abs(spacing.right - spacing.viewport) < 0.5, 'The visible bar has a gap inside the native window.');
    assert.equal(spacing.radiusTop, '0px'); assert.equal(spacing.radiusBottom, '0px');
    const checkScreenEdge = () => {
      const bounds = win.getBounds();
      const display = screen.getDisplayMatching(bounds).bounds;
      assert.ok(Math.abs(bounds.x + bounds.width - display.x - display.width) <= 1, 'The native panel has a gap at the screen edge.');
    };
    checkScreenEdge();
    assert.equal(await js("[...document.querySelectorAll('.dot')].every(dot => dot.textContent === '' && dot.getBoundingClientRect().width <= 10.5)"), true);
    assert.equal(await js("document.querySelector('.grip') === null && getComputedStyle(document.querySelector('footer')).display === 'none'"), true);
    assert.equal(await js(`(() => {
      const section = document.querySelector('#usage');
      const lastSession = document.querySelector('.session:last-child').getBoundingClientRect();
      return section.getBoundingClientRect().top > lastSession.bottom &&
        parseFloat(getComputedStyle(section).borderTopWidth) > 0 &&
        [...document.querySelectorAll('.usage-gauge')].every(gauge => gauge.getBoundingClientRect().height > 0) &&
        [...document.querySelectorAll('.usage-value')].every(value => getComputedStyle(value).display === 'none');
    })()`), true);
    assert.equal(await js("[...document.querySelectorAll('.gauge-needle')].every(needle => getComputedStyle(needle).stroke === 'rgb(140, 206, 107)')"), true);
    assert.match(await js("document.querySelector('[data-limit=fiveHour] .usage-gauge').getAttribute('aria-label')"), /5-hour limit: 76% remaining/);
    assert.match(await js("document.querySelector('[data-limit=weekly] .usage-gauge').getAttribute('aria-label')"), /Weekly limit: 84% remaining/);
    await capture('compact.png');
    const light = await js(`(() => { const box = document.querySelector('.session-button').getBoundingClientRect(); return { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) }; })()`);
    win.webContents.sendInputEvent({ type: 'mouseMove', ...light, globalX: win.getBounds().x + light.x, globalY: win.getBounds().y + light.y });
    await wait("document.querySelector('.session-button').matches(':hover')");
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
      const close = document.querySelector('#hide').getBoundingClientRect();
      const choices = [...document.querySelectorAll('[data-sort]')].map(button => button.getBoundingClientRect());
      return tools.top >= header.top && tools.bottom <= header.bottom && tools.bottom <= list.top &&
        tools.right < close.left && close.right <= header.right && choices.length === 2 &&
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
    await js("document.querySelector('#hide').click()");
    const hideDeadline = Date.now() + 5000;
    while (win.isVisible()) {
      if (Date.now() > hideDeadline) throw Error('The cross did not hide the panel.');
      await new Promise(resolve => setTimeout(resolve, 30));
    }
    showPanel();
    await wait("document.visibilityState === 'visible' && document.querySelectorAll('.session').length === 2");
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
    assert.equal(await js("document.querySelector('[data-provider=atlas][data-limit=budget] .usage-reset').textContent"), 'Reset time unavailable');
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
    await wait("document.querySelectorAll('.session').length === 7 && document.querySelectorAll('.project-heading').length === 5");
    assert.equal(await js("[...document.querySelectorAll('.session-project')].some(project => project.textContent === 'No workspace')"), true);
    assert.equal(await js(`(() => {
      const time = document.querySelector('[data-key="atlas:missing"] .session-activity');
      return time.textContent === '–' && !time.hasAttribute('datetime') && time.getAttribute('aria-label') === 'Last activity: Time unavailable';
    })()`), true);
    assert.equal(await js("[...document.querySelectorAll('.session-button')].find(button => button.dataset.key === 'atlas:remote').querySelector('.session-project').textContent"), 'repo:design');
    assert.equal(await js(`(() => {
      const groups = []; for (const child of document.querySelector('#sessions').children) {
        if (child.classList.contains('project-heading')) groups.push({ title: child.textContent, keys: [] });
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
    await wait("document.querySelector('[data-sort=project]').getAttribute('aria-pressed') === 'true' && document.querySelectorAll('.project-heading').length === 5");
    await reloadedPreferences.load(); assert.equal(reloadedPreferences.value.sortOrder, 'project');
    assert.equal(reloadedPreferences.value.pinned.length, 1);
    assert.ok(Math.abs(required(reloadedPreferences.value.y) - (dragStart.y - 20)) <= 1);
    assert.equal(errors.length, 0, errors.join('\n'));
    const report = { result: 'passed', checks: ['always on top', 'half-width compact bar', 'compact center alignment', 'equal top and bottom spacing', 'compact and expanded panels touch screen edge', 'small plain lights', 'no compact icons or grip', 'no hover highlight', 'grab and grabbing cursors', 'panel follows held drag', 'reverse drag without overshoot', 'drag position survives refresh and is saved on release', 'click light to show names', 'no panel title', 'only activity and project sorting', 'no legend or extra text', 'no recent-only or quit button', 'workspace in tooltip', 'short list needs no scrollbar', 'compact divider and two gauges', 'green gauges and limit tooltips', 'click gauge to expand', 'red yellow and green follow amount left', 'unavailable gauge clears pointer', 'compact gauges fit with no chats', 'remaining percentages and reset tooltip', 'usage bars fit expanded panel', 'usage failure clears figures and keeps sessions', 'usage connection recovers', 'Codex bucket and window duration selection', 'empty and missing usage windows', 'reset clears expired figures until new data arrives', 'usage fits with no local chats', 'live approval', 'pin', 'old chats visible with old show-all setting', 'cross hides panel and show restores it', 'live completion', 'reload and persistence', 'horizontal fit', 'no renderer errors'] };
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
    await fs.writeFile(path.join(testDir, 'report.json'), JSON.stringify(report, null, 2));
    console.log(`Desktop checks passed: ${report.checks.length}.`);
    app.exit(0);
  } catch (error) {
    try { await capture('failure.png'); } catch (captureError) { console.error('Screenshot failed:', errorMessage(captureError)); }
    console.error(error); app.exit(1);
  }
}
export { run };
