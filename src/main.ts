import type { IpcMainInvokeEvent, Rectangle } from 'electron';
import type { MonitorSnapshot, ProviderUsage, PanelEdge, PanelMotion, PanelPayload, SettingsPayload } from './shared/contracts.js';
import { parseAction, parseSettingsAction, errorMessage, hasErrorCode } from './shared/validation.js';
import { app, BrowserWindow, ipcMain, screen, Tray, Menu, nativeImage, shell, nativeTheme, autoUpdater } from 'electron';
import * as path from 'node:path';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { SessionMonitor, visibleSessions } from './core.js';
import { sessionSections } from './shared/session-sections.js';
import { createAdapters } from './adapters/index.js';
import { Preferences } from './preferences.js';
import { Updates } from './updates.js';
import { updateView } from './shared/updates.js';
import { readSystemTextScale } from './system-text.js';

app.setName('Session Lights');
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
// Drag positions follow the edge: Y on a left or right edge, X on a top or bottom edge.
let panelDrag: { displayId: number; start: number; pointer: number; position: number } | undefined;
let placedEdge: PanelEdge | undefined;
let panelResize: PanelMotion | undefined;
let resizeId = 0;
let usageTimer: NodeJS.Timeout | undefined;
let usage: ProviderUsage[] = [];
let updates: Updates;
let systemTextScale = 1;
let lastTextScaleRead = 0;
// The floating level clears Windows topmost state in the tested Electron runtime.
const panelLevel = process.platform === 'win32' ? 'normal' : 'floating';
// Start with the usual platform minimum, then measure the native window.
// Windows can impose a larger minimum on some displays. The visible bar stays 26 pixels wide.
let compactWidth = process.platform === 'win32' ? 30 : 26;
// A top or bottom bar uses the same thickness, unless the native minimum height is larger.
let compactHeight = compactWidth;

function panelDisplay() {
  return screen.getAllDisplays().find(d => d.id === (panelDrag?.displayId ?? preferences.value.displayId)) || screen.getPrimaryDisplay();
}
async function refreshTextScale(force = false) {
  if (!force && Date.now() - lastTextScaleRead < 10000) return;
  lastTextScaleRead = Date.now();
  const scale = await readSystemTextScale();
  if (scale !== systemTextScale) {
    systemTextScale = scale;
    stopResize(); positionPanel(); notify();
  }
}

function payload(): PanelPayload {
  const hidden = new Set(preferences.value.hidden);
  const hiddenSessions = visibleSessions(snapshot.sessions.filter(session => hidden.has(session.key)), { ...preferences.value, hidden: [] });
  const sessions = visibleSessions(snapshot.sessions, preferences.value);
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
}
function settingsPayload(): SettingsPayload {
  return { version: app.getVersion(), update: updates.state, theme: preferences.value.theme, edge: preferences.value.edge, textScale: systemTextScale,
    adapters: monitor.adapters.map(adapter => ({ id: adapter.id, name: adapter.name,
      visible: !preferences.value.hiddenAdapters.includes(adapter.id) })) };
}
async function showSettings(reducedMotion = false) {
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
  const updateItem = ['disabled', 'idle', 'no-feed', 'current'].includes(updates.state.kind) ? [] : [
    { label: updateView(updates.state).label, click: openSettings },
  ];
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Show panel', click: showPanel },
    { label: 'Settings', click: openSettings },
    ...updateItem,
    { label: 'Move to this screen', click: () => {
      actionQueue = actionQueue.then(async () => {
        await preferences.save({ ...preferences.value, displayId: screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).id, y: null, x: null }); showPanel();
      }).catch(console.error);
    } },
  ]));
}
function stopResize() { panelResize = undefined; }
function positionPanel({ animate = false, reducedMotion = false } = {}) {
  if (!win || win.isDestroyed() || (panelResize && !animate)) return;
  const current = win.getBounds();
  const edge = preferences.value.edge;
  const vertical = edge === 'left' || edge === 'right';
  const visible = win.isVisible();
  // Reuse the current position only while the panel stays on the same edge.
  const placed = visible && placedEdge === edge;
  const display = panelDisplay();
  const area = display.workArea;
  const scale = expanded ? systemTextScale : 1;
  const view = payload();
  const sessions = view.showHidden ? [...view.sessions, ...view.hiddenSessions] : view.sessions;
  const rows = Math.max(1, Math.min(sessions.length, 14));
  const groupHeight = sessionSections(view).reduce((height, section) => height + (section.kind === 'sessions' && section.divider ? 13 : section.title ? 30 : 0), 0);
  const limits = view.usage.reduce((sum, source) => sum + source.windows.length, 0);
  // Padding and header 60, usage border 16, and the hidden-session footer and undo bar 78.
  const expandedContentHeight = Math.max(160, rows * 31 + groupHeight + 60 + (limits ? 16 + limits * 24 : 0) + (view.hiddenSessions.length ? 78 : 0));
  // The compact bar lists one light per row along the edge.
  const compactLength = rows * 24 + (limits ? 28 : 17) + limits * 24;
  const contentHeight = panelView === 'settings' ? 400 + monitor.adapters.length * 40 : expandedContentHeight;
  const expandedWidth = Math.round(Math.min(360 * systemTextScale, area.width));
  const width = expanded ? Math.round(Math.min(360 * scale, area.width)) : vertical ? compactWidth : Math.round(Math.min(area.width - 24, compactLength));
  const height = expanded ? Math.round(Math.min(area.height - 24, scale * contentHeight)) : vertical ? Math.round(Math.min(area.height - 24, compactLength)) : compactHeight;
  let x: number, y: number;
  if (vertical) {
    // Leave room for the readable list before showing the compact bar. Opening
    // the panel can then keep its top edge still on shorter displays.
    const expandedHeight = Math.min(area.height - 24, systemTextScale * expandedContentHeight);
    const defaultY = placed ? current.y : area.y + Math.min((area.height - height) / 2, area.height - expandedHeight - 12);
    const preferredY = panelDrag?.position ?? preferences.value.y ?? defaultY;
    y = Math.round(Math.max(area.y + 12, Math.min(preferredY, area.y + area.height - height - 12)));
    x = edge === 'right' ? area.x + area.width - width : area.x;
  } else {
    // Keep the left edge still when the panel opens along a top or bottom edge.
    const defaultX = placed ? current.x : area.x + Math.min((area.width - width) / 2, area.width - expandedWidth - 12);
    const preferredX = panelDrag?.position ?? preferences.value.x ?? defaultX;
    x = Math.round(Math.max(area.x + 12, Math.min(preferredX, area.x + area.width - width - 12)));
    y = edge === 'top' ? area.y : area.y + area.height - height;
  }
  const bounds = { x, y, width, height };
  placedEdge = edge;
  stopResize();
  if (animate && !reducedMotion && visible) {
    panelResize = { id: ++resizeId, duration: 280, delay: expanded ? 0 : 70 };
    // Keep the visible panel still. The renderer animates its surface inside these bounds.
    // On collapse, keep the larger native window until the surface reaches the compact edge.
    if (expanded) win.setBounds(bounds);
    win.setAlwaysOnTop(true, panelLevel);
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
      const vertical = prefs.edge === 'left' || prefs.edge === 'right';
      const pointer = vertical ? value.screenY : value.screenX;
      if (!Number.isFinite(pointer)) return;
      if (value.phase === 'start') {
        if (panelResize) { stopResize(); positionPanel(); notify(); }
        const bounds = win.getBounds();
        const start = vertical ? bounds.y : bounds.x;
        panelDrag = { displayId: screen.getDisplayMatching(bounds).id, start, pointer, position: start };
        return;
      }
      if (!panelDrag || !['update', 'end'].includes(value.phase)) return;
      // Use the pointer's total distance from the start, not the moving window's position.
      panelDrag.position = panelDrag.start + pointer - panelDrag.pointer;
      positionPanel();
      if (value.phase === 'end') {
        const displayId = panelDrag.displayId;
        const bounds = win.getBounds();
        try { await preferences.save(vertical ? { ...prefs, displayId, y: bounds.y } : { ...prefs, displayId, x: bounds.x }); }
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
  const enabled = app.isPackaged && !demo && existsSync(path.join(process.resourcesPath, 'app-update.yml'));
  const engine = enabled ? (await import('electron-updater')).default.autoUpdater : undefined;
  updates = new Updates(engine, 'Use an installed release to check for updates.', () => {
    notify(); updateTrayMenu();
  });
  preferences = new Preferences(path.join(app.getPath('userData'), 'preferences.json'));
  await preferences.load();
  // Set Chromium and native menus before any window can paint.
  nativeTheme.themeSource = preferences.value.theme;
  await refreshTextScale(true);
  monitor = new SessionMonitor(await createAdapters({ demo }));
  usage = monitor.usageSnapshot();
  win = new BrowserWindow({ width: compactWidth, height: 100, show: false, frame: false, transparent: true,
    resizable: false, maximizable: false, minimizable: false, fullscreenable: false, skipTaskbar: true,
    alwaysOnTop: true, hasShadow: false, title: 'Session Lights',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), nodeIntegration: false,
      contextIsolation: true, sandbox: true, backgroundThrottling: false } });
  compactWidth = Math.max(compactWidth, win.getBounds().width);
  win.setSize(compactWidth, 1);
  compactHeight = Math.max(compactWidth, win.getBounds().height);
  win.setAlwaysOnTop(true, panelLevel);
  if (process.platform === 'darwin') {
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    app.dock?.hide();
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
  ipcMain.on('panel:motion-finished', (event, id: unknown) => {
    if (event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame ||
        !Number.isSafeInteger(id) || panelResize?.id !== id) return;
    stopResize();
    positionPanel();
    notify();
  });
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
      case 'edge':
        if (preferences.value.edge === value.edge) return;
        await preferences.save({ ...preferences.value, edge: value.edge });
        stopResize(); positionPanel(); notify(); return;
      case 'adapter': {
        if (!monitor.adapters.some(adapter => adapter.id === value.id)) return;
        const hiddenAdapters = preferences.value.hiddenAdapters.filter(id => id !== value.id);
        if (!value.visible) hiddenAdapters.push(value.id);
        await preferences.save({ ...preferences.value, hiddenAdapters });
        stopResize(); positionPanel(); notify(); return;
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
  await win.loadFile(path.join(__dirname, 'ui', 'index.html'));
  // The tray uses the small app icon. The build copies it from assets/.
  const svg = readFileSync(path.join(__dirname, 'ui', 'icon-small.svg'), 'utf8');
  // Electron's native tray needs bitmaps on Windows. Chromium renders the SVG once per display scale.
  const trayImage = nativeImage.createEmpty();
  for (const scaleFactor of [1, 1.5, 2]) {
    const size = 16 * scaleFactor;
    const dataURL: unknown = await win.webContents.executeJavaScript(`new Promise(resolve => {
      const image = new Image(); image.onload = () => { const c = document.createElement('canvas');
      c.width = ${size}; c.height = ${size}; c.getContext('2d').drawImage(image, 0, 0, ${size}, ${size}); resolve(c.toDataURL()); };
      image.src = ${JSON.stringify(`data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`)}; })`);
    if (typeof dataURL !== 'string') throw Error('Cannot render the tray icon.');
    trayImage.addRepresentation({ scaleFactor, dataURL });
  }
  tray = new Tray(trayImage);
  tray.setToolTip('Session Lights');
  updateTrayMenu(); tray.on('click', () => win.isVisible() ? win.hide() : showPanel());
  showPanel();
  console.log(`Session Lights is running. Local sessions: ${snapshot.sessions.length}. Panel above other windows: ${win.isAlwaysOnTop()}.`);
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
  const displayChanged = () => { stopResize(); positionPanel(); notify(); };
  screen.on('display-removed', displayChanged); screen.on('display-metrics-changed', displayChanged);
  app.on('activate', showPanel);
}

if (!app.requestSingleInstanceLock()) {
  if (demo) {
    console.error('Session Lights is already running from this checkout. Quit it before starting a demo.');
    app.exit(1);
  } else app.quit();
} else {
  // Source launches restore their normal or isolated data profile.
  if (demo) {
    const temporaryRoot = app.isPackaged ? app.getPath('temp') : path.join(app.getAppPath(), '.tmp');
    mkdirSync(temporaryRoot, { recursive: true });
    const profile = path.join(temporaryRoot, `${app.isPackaged ? 'session-lights-preview' : 'demo-profile'}-${process.pid}`);
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
  app.on('before-quit', () => { quitting = true; updates?.close(); stopResize(); clearTimeout(timer); clearTimeout(usageTimer); monitor?.close(); tray?.destroy(); });
  app.whenReady().then(main).catch(error => { console.error(error); app.exit(1); });
}
