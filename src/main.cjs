const { app, BrowserWindow, ipcMain, screen, Tray, Menu, nativeImage, shell } = require('electron');
const path = require('node:path');
const { SessionMonitor, visibleSessions } = require('./core.cjs');
const { createAdapters } = require('./adapters/index.cjs');
const { Preferences, SORT_ORDERS } = require('./preferences.cjs');

const testDir = process.argv.find(arg => arg.startsWith('--desktop-test='))?.split('=').slice(1).join('=');
if (testDir) app.setPath('userData', path.join(testDir, 'profile'));
app.setName('Session Lights');
const demo = process.argv.includes('--demo');
let win, tray, preferences, monitor, snapshot = { sessions: [], sources: [] }, timer, quitting = false;
let actionQueue = Promise.resolve();
let panelDrag;
let panelResize, resizeTimer, resizeId = 0;
let usageTimer, usage = [];
let tooltipWin, tooltipTarget;
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
  updateTooltip();
}
function hideTooltip() { tooltipTarget = undefined; tooltipWin?.hide(); }
function tooltipData(target) {
  if (target?.kind === 'session') {
    const session = snapshot.sessions.find(session => session.key === target.key);
    return session && { kind: 'session', ...session };
  }
  if (target?.kind === 'usage') {
    const source = usage.find(source => source.providerId === target.providerId);
    const limit = source?.windows.find(limit => limit.id === target.id);
    return limit && { kind: 'usage', ...limit, provider: source.provider, scope: source.scope,
      message: source.message, updatedAt: source.updatedAt };
  }
  if (target?.kind === 'project') {
    const sessions = snapshot.sessions.filter(session => session.projectKey === target.key);
    if (sessions.length) return { kind: 'health', title: sessions[0].projectGroup,
      meta: [...new Set(sessions.map(session => session.provider))].join(' · '),
      detail: sessions[0].workspace || (sessions[0].projectId ? `Project ID: ${sessions[0].projectId}` : 'No working path was supplied.') };
  }
  if (target?.kind === 'empty') return { kind: 'health', title: 'No local sessions', detail: snapshot.sources.map(source => source.health).join(' ') };
}
function updateTooltip() {
  if (!tooltipTarget || !tooltipWin || tooltipWin.isDestroyed()) return;
  const data = tooltipData(tooltipTarget);
  if (!data) { hideTooltip(); return; }
  tooltipWin.webContents.send('tooltip:update', data);
}
function showTooltip(event, value) {
  if (event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame) return;
  if (!value) { hideTooltip(); return; }
  if (!win.isVisible() || panelDrag || panelResize || !Number.isFinite(value.y) || !tooltipData(value)) return;
  tooltipTarget = value;
  const bounds = win.getBounds();
  const area = screen.getDisplayMatching(bounds).workArea;
  const width = Math.min(280, area.width - 16), height = 188;
  tooltipWin.setBounds({ x: Math.round(Math.max(area.x + 8, bounds.x - width - 8)),
    y: Math.round(Math.max(area.y + 8, Math.min(bounds.y + value.y - 18, area.y + area.height - height - 8))), width, height });
  updateTooltip(); tooltipWin.showInactive(); tooltipWin.setAlwaysOnTop(true, panelLevel);
}
function stopResize() { clearTimeout(resizeTimer); resizeTimer = undefined; panelResize = undefined; }
function positionPanel({ animate = false, reducedMotion = false } = {}) {
  if (!win || win.isDestroyed() || (panelResize && !animate)) return;
  const display = screen.getAllDisplays().find(d => d.id === (panelDrag?.displayId ?? preferences.value.displayId)) || screen.getPrimaryDisplay();
  const area = display.workArea;
  const width = preferences.value.expanded ? 328 : compactWidth;
  const sessions = payload().sessions;
  const rows = Math.max(1, Math.min(sessions.length, 14));
  const groupHeight = preferences.value.expanded && preferences.value.sortOrder === 'project' ? new Set(sessions.map(session => session.projectKey)).size * 24 : 0;
  const limits = usage.reduce((sum, source) => sum + source.windows.length, 0);
  const overhead = preferences.value.expanded ? 104 : limits ? 29 : 17;
  const height = Math.min(area.height - 24, Math.max(preferences.value.expanded ? 128 : 41,
    rows * (preferences.value.expanded ? 40 : 24) + groupHeight + overhead + limits * (preferences.value.expanded ? 36 : 24)));
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
  const value = await monitor.readUsage();
  if (!quitting) { usage = value; positionPanel(); notify(); }
}
function showPanel() { positionPanel(); win.showInactive(); win.setAlwaysOnTop(true, panelLevel); }

async function action(event, value) {
  if (event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame) throw Error('Unknown sender.');
  const prefs = preferences.value;
  hideTooltip();
  switch (value?.type) {
    case 'sort':
      if (!SORT_ORDERS.includes(value.order)) return;
      await preferences.save({ ...prefs, sortOrder: value.order }); break;
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
      if (session) await monitor.open(session, url => shell.openExternal(url));
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
  monitor = new SessionMonitor(createAdapters({ demo, testDir }));
  usage = monitor.usageSnapshot();
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
  win.on('hide', hideTooltip); win.on('blur', hideTooltip);
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
  ipcMain.on('panel:tooltip', showTooltip);
  await refresh();
  tooltipWin = new BrowserWindow({ width: 280, height: 188, show: false, frame: false, transparent: true,
    focusable: false, resizable: false, skipTaskbar: true, alwaysOnTop: true, hasShadow: false,
    webPreferences: { preload: path.join(__dirname, 'tooltip-preload.cjs'), nodeIntegration: false,
      contextIsolation: true, sandbox: true, backgroundThrottling: false } });
  tooltipWin.setIgnoreMouseEvents(true);
  tooltipWin.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  tooltipWin.webContents.on('will-navigate', event => event.preventDefault());
  if (process.platform === 'darwin') tooltipWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  await tooltipWin.loadFile(path.join(__dirname, 'ui', 'tooltip.html'));
  await win.loadFile(path.join(__dirname, 'ui', 'index.html'));
  if (testDir) {
    await refreshUsage();
    return require('../scripts/desktop-smoke.cjs').run({ app, win, tooltipWin, refresh, refreshUsage, showPanel, testDir, preferences });
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
    await refreshUsage(); console.log(`Usage windows: ${usage.reduce((sum, source) => sum + source.windows.filter(limit => Number.isFinite(limit.remainingPercent)).length, 0)}.`);
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
  const displayChanged = () => { hideTooltip(); stopResize(); positionPanel(); notify(); };
  screen.on('display-removed', displayChanged); screen.on('display-metrics-changed', displayChanged);
  app.on('activate', showPanel);
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (win) showPanel(); });
  app.on('before-quit', () => { quitting = true; stopResize(); hideTooltip(); clearTimeout(timer); clearTimeout(usageTimer); monitor?.close(); tray?.destroy(); });
  app.whenReady().then(main).catch(error => { console.error(error); app.exit(1); });
}
