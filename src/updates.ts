import type { AppUpdater } from 'electron-updater';
import type { UpdateCommand, UpdateState } from './shared/updates.js';

// The main process owns the updater. Renderers receive state and fixed commands.
export class Updates {
  state: UpdateState;
  private timer: ReturnType<typeof setInterval> | undefined;
  private stopped = false;
  constructor(private readonly engine: AppUpdater | undefined, reason: string, private readonly changed: () => void) {
    this.state = engine ? { kind: 'idle' } : { kind: 'disabled', reason };
    if (!engine) return;
    engine.autoDownload = false;
    engine.autoInstallOnAppQuit = false;
    engine.allowPrerelease = false;
    engine.allowDowngrade = false;
    engine.disableWebInstaller = true;
    // Checks and downloads reject their promises. Installation reports errors through events.
    engine.on('error', () => {
      if (this.state.kind === 'installing') this.set({ kind: 'download-error', version: this.state.version, message: 'Could not start the installer. Download the update again.' });
    });
    engine.on('update-available', info => this.set({ kind: 'available', version: info.version }));
    engine.on('update-not-available', () => this.set({ kind: 'current' }));
    engine.on('download-progress', progress => {
      if (this.state.kind === 'downloading') this.set({ ...this.state, percent: Math.max(0, Math.min(100, progress.percent)) });
    });
    engine.on('update-downloaded', info => this.set({ kind: 'ready', version: info.version }));
  }
  private set(state: UpdateState) { if (!this.stopped) { this.state = state; this.changed(); } }
  start() {
    if (!this.engine || this.timer) return;
    void this.run('check');
    this.timer = setInterval(() => {
      if (this.state.kind === 'idle' || this.state.kind === 'current' || this.state.kind === 'check-error') void this.run('check');
    }, 6 * 60 * 60 * 1000);
    this.timer.unref();
  }
  async run(command: UpdateCommand) {
    const engine = this.engine;
    if (!engine || this.stopped) return;
    if (command === 'check' && ['idle', 'current', 'check-error'].includes(this.state.kind)) {
      this.set({ kind: 'checking' });
      try { await engine.checkForUpdates(); }
      catch { this.set({ kind: 'check-error', message: 'Cannot reach the update service. Check your connection and try again.' }); }
    } else if (command === 'download' && (this.state.kind === 'available' || this.state.kind === 'download-error')) {
      const version = this.state.version;
      this.set({ kind: 'downloading', version, percent: 0 });
      try { await engine.downloadUpdate(); }
      catch { this.set({ kind: 'download-error', version, message: 'Could not download or verify the update. Try again.' }); }
    } else if (command === 'install' && this.state.kind === 'ready') {
      const version = this.state.version;
      this.set({ kind: 'installing', version });
      try { engine.quitAndInstall(false, true); }
      catch { this.set({ kind: 'download-error', version, message: 'Could not start the installer. Download the update again.' }); }
    }
  }
  close() { this.stopped = true; clearInterval(this.timer); }
}
