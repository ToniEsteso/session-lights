const { app, BrowserWindow, ipcMain, screen, Tray, Menu, nativeImage, shell } = require('electron');
const path = require('node:path');
const { SessionMonitor, visibleSessions } = require('./core.cjs');
const { CodexDesktopAdapter } = require('./adapters/codex-desktop.cjs');
const { CodexUsage } = require('./adapters/codex-usage.cjs');
const { Preferences } = require('./preferences.cjs');

const testDir = process.argv.find(arg => arg.startsWith('--desktop-test='))?.split('=').slice(1).join('=');
if (testDir) app.setPath('userData', path.join(testDir, 'profile'));
app.setName('Session Lights');
const demo = process.argv.includes('--demo');
let win, tray, preferences, monitor, snapshot = { sessions: [], sources: [] }, timer, quitting = false;
let actionQueue = Promise.resolve();
let panelDrag;
let panelResize, resizeTimer, resizeId = 0;
let usageReader, usageTimer, usage = { windows: [], message: 'Reading usage limits.', updatedAt: null };
// The floating level clears Windows topmost state in the tested Electron runtime.
const panelLevel = process.platform === 'win32' ? 'normal' : 'floating';
// Windows imposes a 30-pixel window minimum. The visible bar stays 26 pixels wide.
const compactWidth = process.platform === 'win32' ? 30 : 26;

function payload() {
  // All sessions stay visible, including when older settings enabled the recent filter.
  return { ...snapshot, sessions: visibleSessions(snapshot.sessions, { ...preferences.value, showAll: true }),
    total: snapshot.sessions.length, preferences: preferences.value, usage, demo,
    motion: panelResize, compactInset: compactWidth - 26 };
}
function notify() {
  if (win && !win.isDestroyed()) win.webContents.send('sessions:update', payload());
}
function stopResize() { clearTimeout(resizeTimer); resizeTimer = undefined; panelResize = undefined; }
function positionPanel({ animate = false, reducedMotion = false } = {}) {
  if (!win || win.isDestroyed() || (panelResize && !animate)) return;
  const display = screen.getAllDisplays().find(d => d.id === (panelDrag?.displayId ?? preferences.value.displayId)) || screen.getPrimaryDisplay();
  const area = display.workArea;
  const width = preferences.value.expanded ? 328 : compactWidth;
  const rows = Math.max(1, Math.min(payload().sessions.length, 14));
  const height = Math.min(area.height - 24, Math.max(preferences.value.expanded ? 128 : 101,
    rows * (preferences.value.expanded ? 40 : 24) + (preferences.value.expanded ? 146 : 77)));
  const y = Math.round(Math.max(area.y + 12, Math.min(panelDrag?.y ?? preferences.value.y ?? area.y + (area.height - height) / 2, area.y + area.height - height - 12)));
  const bounds = { x: display.bounds.x + display.bounds.width - width, y, width, height };
  const current = win.getBounds();
  stopResize();
  if (animate && !reducedMotion && win.isVisible()) {
    const motion = panelResize = { id: ++resizeId, duration: 280, delay: preferences.value.expanded ? 0 : 70, height: bounds.height };
    const started = performance.now() + motion.delay;
    const edge = bounds.x + bounds.width;
    const step = () => {
      if (quitting || win.isDestroyed() || panelResize !== motion) return;
      const frameStarted = performance.now();
      const progress = Math.max(0, Math.min(1, (performance.now() - started) / motion.duration));
      const eased = 1 - (1 - progress) ** 3;
      const width = Math.round(current.width + (bounds.width - current.width) * eased);
      win.setBounds({ x: edge - width, width,
        y: Math.round(current.y + (bounds.y - current.y) * eased),
        height: Math.round(current.height + (bounds.height - current.height) * eased) });
      if (progress < 1) resizeTimer = setTimeout(step, Math.max(1, 16 - (performance.now() - frameStarted)));
      else { stopResize(); positionPanel(); notify(); }
    };
    resizeTimer = setTimeout(step, motion.delay || 16);
    return;
  }
  if (Object.keys(bounds).some(key => Math.abs(bounds[key] - current[key]) > 1)) win.setBounds(bounds);
  win.setAlwaysOnTop(true, panelLevel);
}
async function refresh() {
  snapshot = await monitor.read();
  positionPanel(); notify();
}
async function refreshUsage() {
  const value = await usageReader.read();
  if (!quitting) { usage = value; notify(); }
}
function showPanel() { positionPanel(); win.showInactive(); win.setAlwaysOnTop(true, panelLevel); }

async function action(event, value) {
  if (event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame) throw Error('Unknown sender.');
  const prefs = preferences.value;
  switch (value?.type) {
    case 'expand':
      await preferences.save({ ...prefs, expanded: !prefs.expanded });
      positionPanel({ animate: true, reducedMotion: value.reducedMotion === true }); notify(); return;
    case 'pin': {
      if (!snapshot.sessions.some(s => s.key === value.key)) return;
      const pinned = prefs.pinned.includes(value.key) ? prefs.pinned.filter(k => k !== value.key) : [...prefs.pinned, value.key];
      await preferences.save({ ...prefs, pinned }); break;
    }
    case 'move': {
      if (!Number.isFinite(value.screenY)) return;
      if (value.phase === 'start') {
        if (panelResize) { stopResize(); positionPanel(); notify(); }
        const bounds = win.getBounds();
        panelDrag = { displayId: screen.getDisplayMatching(bounds).id,
          startY: bounds.y, pointerY: value.screenY, y: bounds.y };
        return;
      }
      if (!panelDrag || !['update', 'end'].includes(value.phase)) return;
      // Use the pointer's total distance from the start, not the moving window's position.
      panelDrag.y = panelDrag.startY + value.screenY - panelDrag.pointerY;
      positionPanel();
      if (value.phase === 'end') {
        const displayId = panelDrag.displayId;
        const y = win.getBounds().y;
        try { await preferences.save({ ...prefs, displayId, y }); }
        finally { panelDrag = undefined; }
        notify();
      }
      return;
    }
    case 'open': {
      const session = snapshot.sessions.find(s => s.key === value.key);
      if (session?.provider === 'Codex' && /^[0-9a-f-]{36}$/i.test(session.id)) {
        try { await shell.openExternal(`codex://threads/${session.id}`); }
        catch { throw Error('Cannot open Codex. Check that the desktop app is installed.'); }
      }
      return;
    }
    case 'hide': win.hide(); return;
    case 'quit': app.quit(); return;
    default: return;
  }
  positionPanel(); notify();
}

async function main() {
  preferences = new Preferences(path.join(app.getPath('userData'), 'preferences.json'));
  await preferences.load();
  usageReader = demo ? { async read() { return { windows: [
    { id: 'fiveHour', label: '5h', remainingPercent: 65, resetsAt: Math.floor(Date.now() / 1000) + 7200 },
    { id: 'weekly', label: 'Weekly', remainingPercent: 83, resetsAt: Math.floor(Date.now() / 1000) + 345600 }
  ], message: 'Preview data.', updatedAt: Date.now() }; }, close() {} } : new CodexUsage(testDir ? {
    command: process.execPath, args: [path.join(__dirname, '..', 'test', 'usage-server.cjs')],
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', SESSION_LIGHTS_USAGE_FIXTURE: path.join(testDir, 'usage.json') }
  } : {});
  monitor = new SessionMonitor(demo ? [{ id: 'demo', name: 'Preview', async read() {
    return { health: 'Preview data. Run without --demo to read Codex.', sessions: [
      { id: '1', title: 'Fix the sign-in form', project: 'website', state: 'waiting', detail: 'Codex requested approval.', updatedAt: Date.now() },
      { id: '2', title: 'Build the API', project: 'service', state: 'working', detail: 'The turn is in progress.', updatedAt: Date.now() },
      { id: '3', title: 'Review the tests', project: 'tools', state: 'idle', detail: 'The last turn finished.', updatedAt: Date.now() },
      { id: '4', title: 'Update the app', project: 'desktop', state: 'error', detail: 'The last turn failed.', updatedAt: Date.now() },
      { id: '5', title: 'Check a long task', project: 'research', state: 'unknown', detail: 'No recent activity.', updatedAt: Date.now() }
    ] };
  } }] : [new CodexDesktopAdapter(testDir ? { root: path.join(testDir, 'codex'), logs: path.join(testDir, 'logs') } : {})]);
  win = new BrowserWindow({ width: compactWidth, height: 100, show: false, frame: false, transparent: true,
    resizable: false, maximizable: false, minimizable: false, fullscreenable: false, skipTaskbar: true,
    alwaysOnTop: true, hasShadow: false, title: 'Session Lights',
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), nodeIntegration: false,
      contextIsolation: true, sandbox: true, backgroundThrottling: false } });
  win.setAlwaysOnTop(true, panelLevel);
  if (process.platform === 'darwin') {
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    if (!testDir) app.dock.hide();
  }
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', event => event.preventDefault());
  win.on('close', event => { if (!quitting) { event.preventDefault(); win.hide(); } });
  ipcMain.handle('sessions:read', event => {
    if (event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame) throw Error('Unknown sender.');
    return payload();
  });
  ipcMain.handle('panel:action', (event, value) => {
    const result = actionQueue.then(() => action(event, value));
    actionQueue = result.catch(() => {});
    return result;
  });
  await refresh();
  await win.loadFile(path.join(__dirname, 'ui', 'index.html'));
  if (testDir) {
    await refreshUsage();
    return require('../scripts/desktop-smoke.cjs').run({ app, win, refresh, refreshUsage, showPanel, testDir, preferences });
  }

  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><rect x="6" y="1" width="12" height="22" rx="6" fill="#25292d"/><circle cx="12" cy="6" r="3" fill="#8cce6b"/><circle cx="12" cy="12" r="3" fill="#ffd45e"/><circle cx="12" cy="18" r="3" fill="#f5f5ef"/></svg>';
  const icon = nativeImage.createFromDataURL(`data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`);
  // Electron's native tray needs a bitmap on Windows. Chromium renders the SVG first.
  const image = await win.webContents.executeJavaScript(`new Promise(resolve => {
    const image = new Image(); image.onload = () => { const c = document.createElement('canvas');
    c.width = 24; c.height = 24; c.getContext('2d').drawImage(image, 0, 0); resolve(c.toDataURL()); };
    image.src = ${JSON.stringify(icon.isEmpty() ? `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}` : icon.toDataURL())}; })`);
  tray = new Tray(nativeImage.createFromDataURL(image));
  tray.setToolTip('Session Lights');
  const menu = Menu.buildFromTemplate([
    { label: 'Show panel', click: showPanel },
    { label: 'Move to this screen', click: () => {
      actionQueue = actionQueue.then(async () => {
        await preferences.save({ ...preferences.value, displayId: screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).id, y: null }); showPanel();
      }).catch(console.error);
    } },
    { type: 'separator' }, { label: 'Quit', click: () => app.quit() }
  ]);
  tray.setContextMenu(menu); tray.on('click', () => win.isVisible() ? win.hide() : showPanel());
  showPanel();
  console.log(`Session Lights is running. Local sessions: ${snapshot.sessions.length}. Panel above other windows: ${win.isAlwaysOnTop()}.`);
  if (process.argv.includes('--launch-check')) {
    await refreshUsage(); console.log(`Codex usage windows: ${usage.windows.length}.`);
    app.quit(); return;
  }
  const pollUsage = async () => {
    await refreshUsage();
    if (!quitting) usageTimer = setTimeout(pollUsage, 60000);
  };
  pollUsage().catch(error => console.error(error.message));
  const poll = async () => {
    try { await refresh(); } catch (error) { console.error(error.message); }
    if (!quitting) timer = setTimeout(poll, 2000);
  };
  timer = setTimeout(poll, 2000);
  const displayChanged = () => { stopResize(); positionPanel(); notify(); };
  screen.on('display-removed', displayChanged); screen.on('display-metrics-changed', displayChanged);
  app.on('activate', showPanel);
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (win) showPanel(); });
  app.on('before-quit', () => { quitting = true; stopResize(); clearTimeout(timer); clearTimeout(usageTimer); usageReader?.close(); tray?.destroy(); });
  app.whenReady().then(main).catch(error => { console.error(error); app.exit(1); });
}
