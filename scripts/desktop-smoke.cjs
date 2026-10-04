const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { screen } = require('electron');
const { logLine, setStatus } = require('../test/fixtures.cjs');

async function run({ app, win, refresh, refreshUsage, showPanel, testDir, preferences }) {
  const errors = [];
  win.webContents.on('console-message', event => { if (event.level === 'error') errors.push(event.message); });
  const js = code => win.webContents.executeJavaScript(code);
  const wait = async condition => {
    const deadline = Date.now() + 5000;
    while (!await js(condition)) { if (Date.now() > deadline) throw Error(`UI did not reach: ${condition}`); await new Promise(resolve => setTimeout(resolve, 30)); }
  };
  const capture = async name => {
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
    const nativeWidth = process.platform === 'win32' ? 30 : 26;
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
    assert.match(await js("document.querySelector('[data-limit=fiveHour] .usage-gauge').title"), /5-hour limit: 76% remaining. Resets/);
    assert.match(await js("document.querySelector('[data-limit=weekly] .usage-gauge').title"), /Weekly limit: 84% remaining. Resets/);
    await capture('compact.png');
    const light = await js(`(() => { const box = document.querySelector('.session-button').getBoundingClientRect(); return { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) }; })()`);
    win.webContents.sendInputEvent({ type: 'mouseMove', ...light, globalX: win.getBounds().x + light.x, globalY: win.getBounds().y + light.y });
    await wait("document.querySelector('.session-button').matches(':hover')");
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
    assert.equal(await js("getComputedStyle(document.querySelector('#handle')).cursor"), 'grab');
    win.webContents.sendInputEvent({ type: 'mouseDown', ...pointerStart, button: 'left', clickCount: 1 });
    await wait("document.body.classList.contains('dragging')");
    assert.equal(await js("getComputedStyle(document.querySelector('#handle')).cursor"), 'grabbing');
    const dragTo = delta => win.webContents.sendInputEvent({ type: 'mouseMove', x: handle.x,
      y: dragStart.y + handle.y + delta - win.getBounds().y,
      globalX: pointerStart.globalX, globalY: pointerStart.globalY + delta, modifiers: ['leftbuttondown'] });
    const waitPosition = async target => {
      const deadline = Date.now() + 5000;
      while (Math.abs(win.getBounds().y - target) > 1) {
        if (Date.now() > deadline) throw Error(`Panel did not follow the held drag: wanted ${target}, got ${win.getBounds().y}. Events: ${JSON.stringify(await js('window.dragEvidence'))}`);
        await new Promise(resolve => setTimeout(resolve, 30));
      }
    };
    dragTo(40); await waitPosition(dragStart.y + 40);
    dragTo(-20); await waitPosition(dragStart.y - 20);
    await refresh(); await waitPosition(dragStart.y - 20);
    win.webContents.sendInputEvent({ type: 'mouseUp', x: handle.x, y: handle.y,
      globalX: pointerStart.globalX, globalY: pointerStart.globalY - 20, button: 'left', clickCount: 1 });
    await wait("!document.body.classList.contains('dragging')");
    assert.equal(await js("getComputedStyle(document.querySelector('#handle')).cursor"), 'grab');
    await wait(`window.sessionLights.read().then(value => Math.abs(value.preferences.y - ${dragStart.y - 20}) <= 1)`);
    await refresh(); await waitPosition(dragStart.y - 20);
    // Catch an instant resize, a moving screen edge, and refreshes that interrupt motion.
    const frames = [];
    const recordFrame = () => frames.push({ ...win.getBounds(), at: Date.now(), aboveOtherWindows: win.isAlwaysOnTop() });
    win.on('resize', recordFrame);
    await js("document.querySelector('.usage-gauge').click()");
    await wait("innerWidth > 50 && innerWidth < 320");
    checkScreenEdge(); await capture('expanding.png');
    const duringMotion = new (require('node:sqlite').DatabaseSync)(path.join(data.root, 'state_5.sqlite'));
    duringMotion.prepare('UPDATE threads SET title = ? WHERE id = ?').run('Updated while opening', id); duringMotion.close();
    await refresh();
    await wait("document.querySelector('#panel').classList.contains('expanded') && !document.body.classList.contains('resizing')");
    assert.match(await js("document.querySelector('#sessions').textContent"), /Updated while opening/);
    const restoreTitle = new (require('node:sqlite').DatabaseSync)(path.join(data.root, 'state_5.sqlite'));
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
    assert.equal(await js("document.querySelector('.session-detail').textContent.includes('project')"), false);
    assert.match(await js("document.querySelector('.session-button').title"), /Workspace: project/);
    assert.equal(await js("document.querySelector('#sessions').scrollHeight <= document.querySelector('#sessions').clientHeight"), true);
    // Catch used/remaining inversion, the wrong bucket, and old figures after a failed read.
    await wait("document.querySelector('[data-limit=fiveHour] .usage-value').textContent === '76% left' && document.querySelector('[data-limit=weekly] .usage-value').textContent === '84% left'");
    assert.match(await js("document.querySelector('[data-limit=fiveHour]').title"), /Resets .+Account-wide usage/s);
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
    assert.equal(await js("getComputedStyle(document.querySelector('[data-limit=fiveHour] .gauge-needle')).stroke"), 'rgb(255, 128, 124)');
    assert.equal(await js("getComputedStyle(document.querySelector('[data-limit=weekly] .gauge-needle')).stroke"), 'rgb(140, 206, 107)');
    await fs.writeFile(usageFile, JSON.stringify({ result: { rateLimits: {
      primary: { usedPercent: 85, windowDurationMins: 300, resetsAt: Math.floor(Date.now() / 1000) + 5000 },
      secondary: { usedPercent: 96, windowDurationMins: 10080, resetsAt: Math.floor(Date.now() / 1000) + 10000 }
    } } }));
    await refreshUsage();
    await wait("document.querySelector('[data-limit=fiveHour] .usage-value').textContent === '15% left'");
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
    const many = new (require('node:sqlite').DatabaseSync)(path.join(data.root, 'state_5.sqlite'));
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
    const changed = new (require('node:sqlite').DatabaseSync)(path.join(data.root, 'state_5.sqlite'));
    changed.prepare('UPDATE threads SET title = ? WHERE id = ?').run('Updated service title', id); changed.close();
    await refresh(); await wait("document.querySelector('#sessions').textContent.includes('Updated service title')");
    assert.ok(Math.abs(await js("document.querySelector('#sessions').scrollTop") - scrollBefore) < 1, 'A session refresh lost the scroll position.');
    assert.equal(errors.length, 0, errors.join('\n'));
    // Usage must remain accessible when there are no local chats.
    const db = new (require('node:sqlite').DatabaseSync)(path.join(data.root, 'state_5.sqlite'));
    db.exec('UPDATE threads SET archived = 1'); db.close();
    await refresh();
    await wait("document.querySelectorAll('.session').length === 0 && !document.querySelector('#empty').hidden");
    assert.equal(await js("['#empty', '#usage', 'footer'].every(selector => { const box = document.querySelector(selector).getBoundingClientRect(); return box.height > 0 && box.bottom <= innerHeight + 0.5; })"), true);
    await capture('empty.png');
    await js("document.querySelector('#expand').click()");
    await wait("!document.querySelector('#panel').classList.contains('expanded') && !document.body.classList.contains('resizing')");
    assert.equal(await js("['#empty', '#usage'].every(selector => { const box = document.querySelector(selector).getBoundingClientRect(); return box.height > 0 && box.bottom <= innerHeight + 0.5; })"), true);
    await capture('compact-no-chats.png');
    const report = { result: 'passed', checks: ['always on top', 'half-width compact bar', 'compact center alignment', 'equal top and bottom spacing', 'compact and expanded panels touch screen edge', 'small plain lights', 'no compact icons or grip', 'no hover highlight', 'grab and grabbing cursors', 'panel follows held drag', 'reverse drag without overshoot', 'drag position survives refresh and is saved on release', 'click light to show names', 'no legend or extra text', 'no filter or quit button', 'workspace in hover text', 'short list needs no scrollbar', 'compact divider and two gauges', 'green gauges and limit tooltips', 'click gauge to expand', 'red yellow and green follow amount left', 'unavailable gauge clears pointer', 'compact gauges fit with no chats', 'remaining percentages and reset tooltip', 'usage bars fit expanded panel', 'usage failure clears figures and keeps sessions', 'usage connection recovers', 'Codex bucket and window duration selection', 'empty and missing usage windows', 'reset clears expired figures until new data arrives', 'usage fits with no local chats', 'live approval', 'pin', 'old chats visible with old filter setting', 'cross hides panel and show restores it', 'live completion', 'reload and persistence', 'horizontal fit', 'no renderer errors'] };
    report.checks.push('long lists keep compact lights centered', 'long lists keep usage and controls visible', 'background updates preserve scroll position');
    report.checks.push('expand through intermediate widths', 'collapse through intermediate widths', 'screen edge stays fixed during animation', 'refresh does not interrupt animation', 'quick reversal reaches the requested state', 'reduced motion skips animation');
    await fs.writeFile(path.join(testDir, 'report.json'), JSON.stringify(report, null, 2));
    console.log(`Desktop checks passed: ${report.checks.length}.`);
    app.exit(0);
  } catch (error) {
    try { await capture('failure.png'); } catch (captureError) { console.error('Screenshot failed:', captureError.message); }
    console.error(error); app.exit(1);
  }
}
module.exports = { run };
