import type { IpcMainEvent, IpcMainInvokeEvent, Rectangle } from 'electron';
import type { MonitorSnapshot, ProviderUsage, PanelMotion, PanelPayload, TooltipTarget, TooltipData, SettingsPayload } from './shared/contracts.js';
import { parseAction, parseTooltipTarget, parseSettingsAction, errorMessage, hasErrorCode } from './shared/validation.js';
import { app, BrowserWindow, ipcMain, screen, Tray, Menu, nativeImage, shell, nativeTheme, autoUpdater } from 'electron';
import * as path from 'node:path';
import { existsSync, mkdirSync } from 'node:fs';
import { SessionMonitor, visibleSessions } from './core.js';
import { sessionSections } from './shared/session-sections.js';
import { createAdapters } from './adapters/index.js';
import { Preferences } from './preferences.js';
import { Updates } from './updates.js';
import { updateView } from './shared/updates.js';
import { readSystemTextScale, readTestTextScale } from './system-text.js';

const testDir = process.argv.find(arg => arg.startsWith('--desktop-test='))?.split('=').slice(1).join('=');
app.setName('Session Lights');
const preview = process.argv.includes('--launch-check') || process.argv.includes('--demo');
const standardUserData = app.isPackaged ? app.getPath('userData') : path.join(app.getAppPath(), '.tmp', 'dev-profile');
const standardSessionData = app.isPackaged ? app.getPath('sessionData') : standardUserData;
let lockProfile = standardUserData;
try { mkdirSync(lockProfile, { recursive: true }); }
catch (error) {
  if (app.isPackaged || !['EACCES', 'EPERM', 'EROFS'].some(code => hasErrorCode(error, code))) throw error;
  lockProfile = path.join(path.resolve(__dirname, '..', '..'), '.tmp', 'session-lights-dev-lock');
  mkdirSync(lockProfile, { recursive: true });
}
app.setPath('userData', lockProfile);
const demo = process.argv.includes('--demo');
let win: BrowserWindow;
let tray: Tray | undefined;
let preferences: Preferences;
let monitor: SessionMonitor;
let snapshot: MonitorSnapshot = { sessions: [], sources: [] };
let showHidden = false;
let expanded = false;
let panelView: PanelPayload['view'] = 'threads';
let timer: NodeJS.Timeout | undefined;
let quitting = false;
let actionQueue = Promise.resolve();
let panelDrag: { displayId: number; startY: number; pointerY: number; y: number } | undefined;
let panelResize: PanelMotion | undefined;
let resizeTimer: NodeJS.Timeout | undefined;
let resizeId = 0;
let usageTimer: NodeJS.Timeout | undefined;
let usage: ProviderUsage[] = [];
let tooltipWin: BrowserWindow;
let tooltipTarget: TooltipTarget | undefined;
let updates: Updates;
let systemTextScale = 1;
let lastTextScaleRead = 0;
// The floating level clears Windows topmost state in the tested Electron runtime.
const panelLevel = process.platform === 'win32' ? 'normal' : 'floating';
// Start with the usual platform minimum, then measure the native window.
// Windows can impose a larger minimum on some displays. The visible bar stays 26 pixels wide.
let compactWidth = process.platform === 'win32' ? 30 : 26;

function panelDisplay() {
  return screen.getAllDisplays().find(d => d.id === (panelDrag?.displayId ?? preferences.value.displayId)) || screen.getPrimaryDisplay();
}
async function refreshTextScale(force = false) {
  if (!force && !testDir && Date.now() - lastTextScaleRead < 10000) return;
  lastTextScaleRead = Date.now();
  const scale = testDir ? await readTestTextScale(path.join(testDir, 'system-text-percent.json')) : await readSystemTextScale();
  if (scale !== systemTextScale) {
    systemTextScale = scale;
    hideTooltip(); stopResize(); positionPanel(); notify();
  }
}

function payload(): PanelPayload {
  const hidden = new Set(preferences.value.hidden);
  const hiddenSessions = visibleSessions(snapshot.sessions.filter(session => hidden.has(session.key)), { ...preferences.value, showAll: true, hidden: [] });
  // Ignore the old recent filter. Explicit session and adapter hiding still apply.
  const sessions = visibleSessions(snapshot.sessions, { ...preferences.value, showAll: true });
  const sources = snapshot.sources.filter(source => !preferences.value.hiddenAdapters.includes(source.id));
  const visibleUsage = usage.filter(source => !preferences.value.hiddenAdapters.includes(source.providerId));
  return { sources, sessions, expanded, view: panelView,
    update: updates.state,
    hiddenSessions,
    showHidden: expanded && showHidden && hiddenSessions.length > 0,
    total: sessions.length, preferences: preferences.value, usage: visibleUsage, demo,
    motion: panelResize, compactInset: compactWidth - 26, textScale: systemTextScale };
}
function notify() {
  if (win && !win.isDestroyed()) {
    win.webContents.send('sessions:update', payload());
    win.webContents.send('settings:update', settingsPayload());
  }
  updateTooltip();
}
function settingsPayload(): SettingsPayload {
  return { version: app.getVersion(), update: updates.state, theme: preferences.value.theme, textScale: systemTextScale,
    adapters: monitor.adapters.map(adapter => ({ id: adapter.id, name: adapter.name,
      visible: !preferences.value.hiddenAdapters.includes(adapter.id) })) };
}
async function showSettings(reducedMotion = false) {
  hideTooltip();
  expanded = true;
  panelView = 'settings';
  positionPanel({ animate: true, reducedMotion }); notify();
  win.show(); win.setAlwaysOnTop(true, panelLevel);
}
function updateTrayMenu() {
  if (!tray) return;
  const openSettings = () => {
    actionQueue = actionQueue.then(() => showSettings()).catch(console.error);
  };
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Show panel', click: showPanel },
    { label: 'Settings', click: openSettings },
    { label: updateView(updates.state).label, click: openSettings },
    { label: 'Move to this screen', click: () => {
      actionQueue = actionQueue.then(async () => {
        await preferences.save({ ...preferences.value, displayId: screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).id, y: null }); showPanel();
      }).catch(console.error);
    } },
  ]));
}
function hideTooltip() { tooltipTarget = undefined; tooltipWin?.hide(); }
function tooltipData(target: TooltipTarget | undefined): TooltipData | undefined {
  if (panelView === 'settings') return;
  const view = payload();
  if (target?.kind === 'session') {
    const session = [...view.sessions, ...(view.showHidden ? view.hiddenSessions : [])].find(session => session.key === target.key);
    return session && { kind: 'session', ...session };
  }
  if (target?.kind === 'usage') {
    const source = view.usage.find(source => source.providerId === target.providerId);
    const limit = source?.windows.find(limit => limit.id === target.id);
    return source && limit && { kind: 'usage', ...limit, provider: source.provider, scope: source.scope,
      message: source.message, updatedAt: source.updatedAt };
  }
  if (target?.kind === 'project') {
    const sessions = view.sessions.filter(session => session.projectKey === target.key);
    const first = sessions[0];
    if (first) return { kind: 'health', title: first.projectGroup,
      meta: [...new Set(sessions.map(session => session.provider))].join(' · '),
      detail: first.workspace || (first.projectId ? `Project ID: ${first.projectId}` : 'No working path was supplied.') };
  }
  if (target?.kind === 'empty') return view.sources.length ?
    { kind: 'health', title: 'No local sessions', detail: view.sources.map(source => source.health).join(' ') } :
    { kind: 'health', title: 'All adapters are hidden', detail: 'Open Settings to show an adapter. Monitoring continues.' };
}
function updateTooltip() {
  if (!tooltipTarget || !tooltipWin || tooltipWin.isDestroyed()) return;
  const data = tooltipData(tooltipTarget);
  if (!data) { hideTooltip(); return; }
  tooltipWin.webContents.send('tooltip:update', { data, textScale: systemTextScale });
}
function showTooltip(event: IpcMainEvent, input: unknown) {
  const value = parseTooltipTarget(input);
  if (event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame) return;
  if (!value) { hideTooltip(); return; }
  if (!win.isVisible() || panelDrag || panelResize || !Number.isFinite(value.y) || !tooltipData(value)) return;
  tooltipTarget = value;
  const bounds = win.getBounds();
  const area = screen.getDisplayMatching(bounds).workArea;
  const scale = systemTextScale;
  const width = Math.round(Math.min(280 * scale, area.width - 16)), height = Math.round(Math.min(188 * scale, area.height - 16));
  tooltipWin.setBounds({ x: Math.round(Math.max(area.x + 8, bounds.x - width - 8)),
    y: Math.round(Math.max(area.y + 8, Math.min(bounds.y + value.y - 18, area.y + area.height - height - 8))), width, height });
  updateTooltip(); tooltipWin.showInactive(); tooltipWin.setAlwaysOnTop(true, panelLevel);
}
function stopResize() { clearTimeout(resizeTimer); resizeTimer = undefined; panelResize = undefined; }
function positionPanel({ animate = false, reducedMotion = false } = {}) {
  if (!win || win.isDestroyed() || (panelResize && !animate)) return;
  const display = panelDisplay();
  const area = display.workArea;
  const scale = expanded ? systemTextScale : 1;
  const width = expanded ? Math.round(Math.min(328 * scale, area.width)) : compactWidth;
  const view = payload();
  const sessions = view.showHidden ? [...view.sessions, ...view.hiddenSessions] : view.sessions;
  const rows = Math.max(1, Math.min(sessions.length, 14));
  const groupHeight = expanded ? sessionSections(view).filter(section => section.title).length * 24 : 0;
  const limits = view.usage.reduce((sum, source) => sum + source.windows.length, 0);
  const overhead = expanded ? 104 : limits ? 62 : 51;
  const minimum = expanded ? (view.sources.length ? 128 : 184) : 41;
  const contentHeight = panelView === 'settings' ? 260 + monitor.adapters.length * 32 : Math.max(minimum,
    rows * (expanded ? 40 : 24) + groupHeight + overhead + limits * (expanded ? 36 : 24));
  const height = Math.round(Math.min(area.height - 24, scale * contentHeight));
  const y = Math.round(Math.max(area.y + 12, Math.min(panelDrag?.y ?? preferences.value.y ?? area.y + (area.height - height) / 2, area.y + area.height - height - 12)));
  const bounds = { x: display.bounds.x + display.bounds.width - width, y, width, height };
  const current = win.getBounds();
  stopResize();
  if (animate && !reducedMotion && win.isVisible()) {
    const motion = panelResize = { id: ++resizeId, duration: 280, delay: expanded ? 0 : 70, height: bounds.height };
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
  if ((['x', 'y', 'width', 'height'] satisfies (keyof Rectangle)[]).some(key => Math.abs(bounds[key] - current[key]) > 1)) win.setBounds(bounds);
  win.setAlwaysOnTop(true, panelLevel);
}
async function refresh() {
  await refreshTextScale();
  snapshot = await monitor.read();
  positionPanel(); notify();
}
async function refreshUsage() {
  const value = await monitor.readUsage();
  if (!quitting) { usage = value; positionPanel(); notify(); }
}
function showPanel() { positionPanel(); win.showInactive(); win.setAlwaysOnTop(true, panelLevel); }

async function action(event: IpcMainInvokeEvent, input: unknown) {
  if (event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame) throw Error('Unknown sender.');
  const value = parseAction(input);
  if (!value) return;
  const prefs = preferences.value;
  hideTooltip();
  switch (value?.type) {
    case 'settings': await showSettings(value.reducedMotion === true); return;
    case 'sort':
      await preferences.save({ ...prefs, sortOrder: value.order }); break;
    case 'expand':
      expanded = !expanded;
      panelView = 'threads';
      positionPanel({ animate: true, reducedMotion: value.reducedMotion === true }); notify(); return;
    case 'set-expanded':
      if (expanded === value.expanded) return;
      expanded = value.expanded;
      if (!expanded) panelView = 'threads';
      positionPanel({ animate: true, reducedMotion: value.reducedMotion === true }); notify(); return;
    case 'pin': {
      if (!snapshot.sessions.some(s => s.key === value.key)) return;
      const pinned = prefs.pinned.includes(value.key) ? prefs.pinned.filter(k => k !== value.key) : [...prefs.pinned, value.key];
      await preferences.save({ ...prefs, pinned }); break;
    }
    case 'hide-session': {
      if (!snapshot.sessions.some(session => session.key === value.key) || prefs.hidden.includes(value.key)) return;
      await preferences.save({ ...prefs, hidden: [...prefs.hidden, value.key] }); break;
    }
    case 'restore-session':
      await preferences.save({ ...prefs, hidden: prefs.hidden.filter(key => key !== value.key) }); break;
    case 'restore-all':
      await preferences.save({ ...prefs, hidden: [] }); showHidden = false; break;
    case 'show-hidden':
      showHidden = !showHidden; break;
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
    default: { const exhaustive: never = value; return exhaustive; }
  }
  positionPanel(); notify();
}

async function main() {
  const enabled = app.isPackaged && !demo && !testDir && existsSync(path.join(process.resourcesPath, 'app-update.yml'));
  const engine = enabled ? (await import('electron-updater')).default.autoUpdater : undefined;
  updates = new Updates(engine, 'Use an installed release to check for updates.', () => {
    notify(); updateTrayMenu();
  });
  preferences = new Preferences(path.join(app.getPath('userData'), 'preferences.json'));
  await preferences.load();
  // Set Chromium and native menus before any window can paint.
  nativeTheme.themeSource = preferences.value.theme;
  await refreshTextScale(true);
  monitor = new SessionMonitor(await createAdapters({ demo, testDir }));
  usage = monitor.usageSnapshot();
  win = new BrowserWindow({ width: compactWidth, height: 100, show: false, frame: false, transparent: true,
    resizable: false, maximizable: false, minimizable: false, fullscreenable: false, skipTaskbar: true,
    alwaysOnTop: true, hasShadow: false, title: 'Session Lights',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), nodeIntegration: false,
      contextIsolation: true, sandbox: true, backgroundThrottling: false } });
  compactWidth = Math.max(compactWidth, win.getBounds().width);
  win.setAlwaysOnTop(true, panelLevel);
  if (process.platform === 'darwin') {
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    if (!testDir) app.dock?.hide();
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
  const checkSettingsSender = (event: IpcMainInvokeEvent) => {
    if (event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame) throw Error('Unknown sender.');
  };
  ipcMain.handle('settings:read', event => { checkSettingsSender(event); return settingsPayload(); });
  const settingsAction = async (event: IpcMainInvokeEvent, input: unknown) => {
    checkSettingsSender(event);
    const value = parseSettingsAction(input);
    if (!value) return;
    switch (value.type) {
      case 'theme':
        await preferences.save({ ...preferences.value, theme: value.theme });
        nativeTheme.themeSource = value.theme;
        notify(); return;
      case 'adapter': {
        if (!monitor.adapters.some(adapter => adapter.id === value.id)) return;
        const hiddenAdapters = preferences.value.hiddenAdapters.filter(id => id !== value.id);
        if (!value.visible) hiddenAdapters.push(value.id);
        await preferences.save({ ...preferences.value, hiddenAdapters });
        hideTooltip(); stopResize(); positionPanel(); notify(); return;
      }
      case 'close': panelView = 'threads'; stopResize(); positionPanel(); notify(); return;
      case 'quit': app.quit(); return;
      case 'update':
        void updates.run(value.command); return;
      default: { const exhaustive: never = value; return exhaustive; }
    }
  };
  ipcMain.handle('settings:action', (event, input: unknown) => {
    const result = actionQueue.then(() => settingsAction(event, input));
    actionQueue = result.catch(() => {});
    return result;
  });
  await refresh();
  tooltipWin = new BrowserWindow({ width: 280, height: 188, show: false, frame: false, transparent: true,
    focusable: false, resizable: false, skipTaskbar: true, alwaysOnTop: true, hasShadow: false,
    webPreferences: { preload: path.join(__dirname, 'tooltip-preload.js'), nodeIntegration: false,
      contextIsolation: true, sandbox: true, backgroundThrottling: false } });
  tooltipWin.setIgnoreMouseEvents(true);
  tooltipWin.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  tooltipWin.webContents.on('will-navigate', event => event.preventDefault());
  if (process.platform === 'darwin') tooltipWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  await tooltipWin.loadFile(path.join(__dirname, 'ui', 'tooltip.html'));
  await win.loadFile(path.join(__dirname, 'ui', 'index.html'));
  if (testDir) {
    await refreshUsage();
    const startupTheme = process.argv.find(arg => arg.startsWith('--theme-startup='))?.slice('--theme-startup='.length);
    if (startupTheme === 'light' || startupTheme === 'dark' || startupTheme === 'system') {
      const { checkThemeStartup } = await import('../scripts/theme-smoke.js');
      await checkThemeStartup({ win, tooltipWin, testDir, refresh }, startupTheme);
      app.quit(); return;
    }
    if (process.argv.includes('--theme-only')) {
      const { checkThemes } = await import('../scripts/theme-smoke.js');
      showPanel();
      const checks = await checkThemes({ win, tooltipWin, testDir, refresh });
      const { writeFile } = await import('node:fs/promises');
      await writeFile(path.join(testDir, 'theme-report.json'), JSON.stringify({ checks }, null, 2));
      console.log(`Theme checks passed: ${checks.length}.`);
      app.quit(); return;
    }
    const { run } = await import('../scripts/desktop-smoke.js');
    return run({ app, win, tooltipWin, refresh, refreshUsage, showPanel, testDir, preferences });
  }

  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><rect x="6" y="1" width="12" height="22" rx="6" fill="#25292d"/><circle cx="12" cy="6" r="3" fill="#8cce6b"/><circle cx="12" cy="12" r="3" fill="#ffd45e"/><circle cx="12" cy="18" r="3" fill="#f5f5ef"/></svg>';
  const icon = nativeImage.createFromDataURL(`data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`);
  // Electron's native tray needs a bitmap on Windows. Chromium renders the SVG first.
  const image: unknown = await win.webContents.executeJavaScript(`new Promise(resolve => {
    const image = new Image(); image.onload = () => { const c = document.createElement('canvas');
    c.width = 24; c.height = 24; c.getContext('2d').drawImage(image, 0, 0); resolve(c.toDataURL()); };
    image.src = ${JSON.stringify(icon.isEmpty() ? `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}` : icon.toDataURL())}; })`);
  if (typeof image !== 'string') throw Error('Cannot render the tray icon.');
  tray = new Tray(nativeImage.createFromDataURL(image));
  tray.setToolTip('Session Lights');
  updateTrayMenu(); tray.on('click', () => win.isVisible() ? win.hide() : showPanel());
  showPanel();
  console.log(`Session Lights is running. Local sessions: ${snapshot.sessions.length}. Panel above other windows: ${win.isAlwaysOnTop()}.`);
  if (process.argv.includes('--launch-check')) {
    console.log(`Version: ${app.getVersion()}.`);
    console.log(`Update mode: ${updates.state.kind}.`);
    await refreshUsage(); console.log(`Usage windows: ${usage.reduce((sum, source) => sum + source.windows.filter(limit => Number.isFinite(limit.remainingPercent)).length, 0)}.`);
    app.quit(); return;
  }
  updates.start();
  const pollUsage = async () => {
    await refreshUsage();
    if (!quitting) usageTimer = setTimeout(pollUsage, 60000);
  };
  pollUsage().catch(error => console.error(errorMessage(error)));
  const poll = async () => {
    try { await refresh(); } catch (error) { console.error(errorMessage(error)); }
    if (!quitting) timer = setTimeout(poll, 2000);
  };
  timer = setTimeout(poll, 2000);
  const displayChanged = () => { hideTooltip(); stopResize(); positionPanel(); notify(); };
  screen.on('display-removed', displayChanged); screen.on('display-metrics-changed', displayChanged);
  app.on('activate', showPanel);
}

if (!app.requestSingleInstanceLock()) {
  if (testDir) {
    console.error('Another Session Lights instance is already running; desktop tests did not start.');
    app.exit(1);
  } else app.quit();
} else {
  // Source launches restore their normal or isolated data profile.
  if (testDir) {
    const profile = path.join(testDir, 'profile');
    mkdirSync(profile, { recursive: true });
    app.setPath('userData', profile);
    app.setPath('sessionData', profile);
  } else if (preview) {
    const profile = path.join(app.getPath('temp'), `session-lights-preview-${process.pid}`);
    mkdirSync(profile, { recursive: true });
    app.setPath('userData', profile);
    app.setPath('sessionData', profile);
  } else if (!app.isPackaged) {
    app.setPath('userData', standardUserData);
    app.setPath('sessionData', standardSessionData);
  }
  app.on('second-instance', () => { if (win) showPanel(); });
  // Native updates can close windows before the normal before-quit event.
  autoUpdater.on('before-quit-for-update', () => { quitting = true; });
  app.on('before-quit', () => { quitting = true; updates?.close(); stopResize(); hideTooltip(); clearTimeout(timer); clearTimeout(usageTimer); monitor?.close(); tray?.destroy(); });
  app.whenReady().then(main).catch(error => { console.error(error); app.exit(1); });
}
