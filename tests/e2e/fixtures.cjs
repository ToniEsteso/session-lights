const { test: base, expect, _electron } = require('@playwright/test');
const fs = require('node:fs/promises');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const project = path.resolve(__dirname, '../..');
const ids = {
  desktop: '11111111-1111-4111-8111-111111111111',
  review: '22222222-2222-4222-8222-222222222222',
  cli: '33333333-3333-4333-8333-333333333333',
  claude: '44444444-4444-4444-8444-444444444444',
  claudeOld: '55555555-5555-4555-8555-555555555555',
  claudeAgent: '66666666-6666-4666-8666-666666666666',
  codexT3: '77777777-7777-4777-8777-777777777777',
  claudeT3: '88888888-8888-4888-8888-888888888888',
  old: '99999999-9999-4999-8999-999999999999',
  recent: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
};

const test = base.extend({
  lights: async ({}, use, testInfo) => {
    await fs.mkdir(path.join(project, '.tmp'), { recursive: true });
    const root = await fs.mkdtemp(path.join(project, '.tmp', 'e2e-'));
    const tempDir = path.join(root, 'temp');
    await fs.mkdir(tempDir);
    const appRoot = path.join(root, 'app');
    const codexRoot = path.join(root, 'codex-home');
    const claudeRoot = path.join(root, 'claude-home');
    const claudeProject = path.join(claudeRoot, 'projects', 'test-project');
    // The launcher is absent until a test installs it, so the missing-installation path stays real.
    const claudeLauncher = path.join(root, process.platform === 'win32' ? 'claude-launcher.cmd' : 'claude-launcher');
    const logsRoot = process.platform === 'win32' ? path.join(root, 'local', 'Codex', 'Logs') :
      process.platform === 'darwin' ? path.join(root, 'Library', 'Logs', 'com.openai.codex') :
        path.join(root, '.config', 'Codex', 'logs');
    const opened = path.join(root, 'opened.jsonl');
    const failOpen = path.join(root, 'fail-open');
    const loginItemFile = path.join(root, 'login-item.json');
    const preferencesFile = path.join(appRoot, '.tmp', 'dev-profile', 'preferences.json');
    let app;
    let panel;
    let launch = 0;
    let tracing = false;
    let failed = false;
    const errors = [];
    const runtimeLog = [];
    const stop = async () => {
      if (!app) return;
      const closing = app;
      const failures = [];
      if (tracing) {
        try { await closing.context().tracing.stop({ path: testInfo.outputPath(`trace-${launch}.zip`) }); }
        catch (error) { failures.push(`Save trace: ${error.message}`); }
        tracing = false;
      }
      // A trace error must not leave the app open. Kill only our own child if close fails.
      try { await closing.close(); }
      catch (error) {
        failures.push(`Close app: ${error.message}`);
        if (closing.process().exitCode === null) closing.process().kill();
      }
      app = undefined;
      if (failures.length) throw Error(failures.join('\n'));
    };
    try {
      await fs.cp(path.join(project, 'build'), path.join(appRoot, 'build'), { recursive: true });
      await fs.writeFile(path.join(appRoot, 'package.json'), JSON.stringify({
        name: 'session-lights', version: '0.1.0', main: 'build/src/main.js',
      }));
      await fs.mkdir(codexRoot, { recursive: true });
      const db = new DatabaseSync(path.join(codexRoot, 'state_5.sqlite'));
      db.exec(`CREATE TABLE threads (
        id TEXT PRIMARY KEY, title TEXT, cwd TEXT, source TEXT, rollout_path TEXT,
        updated_at INTEGER, updated_at_ms INTEGER, archived INTEGER, originator TEXT
      )`);
      const now = Date.now();
      const sessions = [
        [ids.desktop, 'Build API', 'service', 'app', 'inProgress'],
        [ids.review, 'Review release', 'website', 'app', 'completed'],
        [ids.cli, 'Fix CLI', 'tools', 'cli', 'completed'],
      ];
      for (const [index, [id, title, workspace, source, status]] of sessions.entries()) {
        // The absent CLI workspace also permits a safe launch-failure check.
        const file = path.join(codexRoot, `${id}.jsonl`);
        const at = now - index * 60_000;
        await fs.writeFile(file, `${JSON.stringify({ timestamp: new Date(at).toISOString(),
          type: 'event_msg', payload: { type: status === 'inProgress' ? 'task_started' : 'task_complete', turn_id: 'turn-1' } })}\n`);
        await fs.utimes(file, at / 1000, at / 1000);
        db.prepare('INSERT INTO threads VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)').run(
          id, title, path.join(root, workspace), source, file, Math.floor(at / 1000), at, 'Codex Desktop');
      }
      db.close();
      await fs.mkdir(path.join(root, 'service'), { recursive: true });

      // Substitute only the OS URL handoff and the OS start-at-login registry.
      // Renderer, preload, IPC, monitor, provider, SQLite reads, and preference writes all remain real.
      // The login substitute is a file. It cannot prove that the OS starts the app at sign-in.
      const bootstrap = path.join(appRoot, 'launch.cjs');
      await fs.writeFile(bootstrap, `
        const { app, shell } = require('electron');
        const fs = require('node:fs');
        app.setAppPath(__dirname);
        shell.openExternal = async url => {
          if (fs.existsSync(${JSON.stringify(failOpen)})) throw Error('Test OS handoff failure');
          fs.appendFileSync(${JSON.stringify(opened)}, JSON.stringify({ url }) + '\\n');
        };
        const loginItem = () => { try { return JSON.parse(fs.readFileSync(${JSON.stringify(loginItemFile)}, 'utf8')); } catch { return { enabled: false }; } };
        app.setLoginItemSettings = options => fs.writeFileSync(${JSON.stringify(loginItemFile)}, JSON.stringify({ enabled: options.openAtLogin }));
        app.getLoginItemSettings = () => ({ openAtLogin: loginItem().enabled, executableWillLaunchAtLogin: loginItem().enabled });
        require('./build/src/main.js');
      `);
      const systemRoot = process.env.SystemRoot || process.env.windir;
      const env = {
        CODEX_HOME: codexRoot,
        CLAUDE_CONFIG_DIR: claudeRoot,
        HOME: root, USERPROFILE: root, APPDATA: path.join(root, 'roaming'),
        LOCALAPPDATA: path.join(root, 'local'), TEMP: tempDir, TMP: tempDir, TMPDIR: tempDir,
        // Exercise the real unavailable-runtime path. Never use an account.
        SESSION_LIGHTS_CODEX_BINARY: path.join(root, 'absent-runtime'),
        SESSION_LIGHTS_CLAUDE_BINARY: claudeLauncher,
        // A source build needs this opt-in. The bootstrap above replaces the real OS registration.
        SESSION_LIGHTS_DEV_LOGIN_ITEM: '1',
      };
      for (const name of ['SystemRoot', 'windir', 'SystemDrive', 'DISPLAY', 'WAYLAND_DISPLAY',
        'XAUTHORITY', 'DBUS_SESSION_BUS_ADDRESS', 'XDG_RUNTIME_DIR', 'XDG_SESSION_TYPE', 'LANG', 'LC_ALL']) {
        if (process.env[name]) env[name] = process.env[name];
      }
      const runtimePath = [systemRoot && path.join(systemRoot, 'System32'), path.dirname(process.execPath),
        path.dirname(require('electron'))].filter(Boolean);
      env.PATH = runtimePath.join(path.delimiter);
      if (systemRoot) env.ComSpec = path.join(systemRoot, 'System32', 'cmd.exe');
      const panelBounds = async () => panel.evaluate(() => {
        const rect = document.querySelector('#panel').getBoundingClientRect();
        return { x: window.screenX, y: window.screenY, width: window.outerWidth, height: window.outerHeight,
          surface: { x: rect.x, y: rect.y, width: rect.width, height: rect.height } };
      });
      const nativeVisible = async () => {
        const nativePanel = await app.browserWindow(panel);
        try { return await nativePanel.evaluate(window => window.isVisible()); }
        finally { await nativePanel.dispose(); }
      };
      const start = async ({ hidden = false } = {}) => {
        launch += 1;
        app = await _electron.launch({ executablePath: require('electron'), args: [bootstrap, ...(process.platform === 'linux' ? ['--no-sandbox'] : [])], env,
          colorScheme: null,
          ...(testInfo.file.endsWith('claude-code.spec.cjs') || testInfo.file.endsWith('providers.spec.cjs') ||
            testInfo.file.endsWith('session-model.spec.cjs') ||
            testInfo.title.startsWith('hover resize keeps the panel anchored') ||
            testInfo.title.startsWith('opening a desktop chat') ? {
            recordVideo: { dir: testInfo.outputPath('video'), size: { width: 600, height: 800 } },
          } : {}),
        });
        for (const stream of ['stdout', 'stderr']) {
          app.process()[stream]?.on('data', chunk => runtimeLog.push(`[launch ${launch} ${stream}] ${chunk}`));
        }
        await app.context().tracing.start({ screenshots: true, snapshots: true });
        tracing = true;
        await expect.poll(() => app.windows().some(page => page.url().endsWith('/index.html')),
          { message: 'The app must open its thread panel' }).toBe(true);
        panel = app.windows().find(page => page.url().endsWith('/index.html'));
        await panel.waitForLoadState();
        panel.on('pageerror', error => errors.push(error.message));
        panel.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
        // Keep Electron's native theme. Playwright otherwise defaults to Light.
        await panel.emulateMedia({ colorScheme: null, reducedMotion: 'reduce' });
        // Reset hover after every launch, including a persisted-profile restart.
        await panel.mouse.move(-20, -20);
        // An empty panel has no visible list. Wait for its main surface instead.
        await expect(panel.getByRole('main', { name: 'Session Lights', exact: true })).toBeVisible();
        // Wait for the native panel before pointer input expands it.
        // A panel that was hidden before the restart must stay hidden.
        if (!hidden) {
          await expect.poll(nativeVisible, { message: 'Electron must show its thread panel before hover input' }).toBe(true);
        }
        return panel;
      };
      await start();
      await use({
        get page() { return panel; },
        ids,
        async expectNoTooltips() {
          for (const window of app.windows()) await expect(window.getByRole('tooltip')).toBeHidden();
        },
        async expand() {
          await panel.getByRole('list', { name: 'Sessions', exact: true }).hover();
          await expect(panel.getByRole('button', { name: 'Settings', exact: true })).toBeVisible();
        },
        async setReducedMotion(reduce) {
          await panel.emulateMedia({ colorScheme: null, reducedMotion: reduce ? 'reduce' : 'no-preference' });
        },
        panelBounds,
        async samplePanelBoundsUntil(condition) {
          const samples = [];
          await expect.poll(async () => {
            const bounds = await panelBounds();
            samples.push(bounds);
            return condition(bounds);
          }, { timeout: 10_000, intervals: [12], message: 'The panel must reach its requested visible size' }).toBe(true);
          return samples;
        },
        async restart(options) { await stop(); await start(options); },
        nativeVisible,
        // The app prints this line once startup, including the show or hide choice, is finished.
        async waitForStartup() {
          await expect.poll(() => runtimeLog.some(line => line.startsWith(`[launch ${launch} stdout]`) && line.includes('Session Lights is running')),
            { message: 'The app must finish starting' }).toBe(true);
        },
        // A second launch of the same app. The running app must show its panel and the new process must exit.
        async launchAgain() {
          const child = require('node:child_process').spawn(require('electron'), [bootstrap, ...(process.platform === 'linux' ? ['--no-sandbox'] : [])], { env, stdio: 'ignore' });
          await new Promise((resolve, reject) => { child.once('exit', resolve); child.once('error', reject); });
        },
        async loginItem() {
          try { return JSON.parse(await fs.readFile(loginItemFile, 'utf8')).enabled; }
          catch (error) { if (error.code === 'ENOENT') return false; throw error; }
        },
        // The user turns the item off outside the app, for example in Windows Startup apps.
        async setLoginItemOutsideApp(enabled) { await fs.writeFile(loginItemFile, JSON.stringify({ enabled })); },
        async restartWithPreferences(value) {
          await stop();
          await fs.mkdir(path.dirname(preferencesFile), { recursive: true });
          await fs.writeFile(preferencesFile, JSON.stringify(value));
          await start();
        },
        async setPreferenceWriteFailure(value) {
          // A real filesystem failure at the atomic write path, within this fixture.
          if (value) await fs.mkdir(`${preferencesFile}.tmp`);
          else await fs.rmdir(`${preferencesFile}.tmp`);
        },
        async record(id, type, payload, at = Date.now()) {
          await fs.appendFile(path.join(codexRoot, `${id}.jsonl`), `${JSON.stringify({
            timestamp: new Date(at).toISOString(), type, payload,
          })}\n`);
        },
        async databaseModel(id, model) {
          const db = new DatabaseSync(path.join(codexRoot, 'state_5.sqlite'));
          try {
            if (!db.prepare('PRAGMA table_info(threads)').all().some(column => column.name === 'model')) db.exec('ALTER TABLE threads ADD COLUMN model TEXT');
            db.prepare('UPDATE threads SET model = ? WHERE id = ?').run(model, id);
          } finally { db.close(); }
        },
        async desktopQuestion() {
          const at = new Date();
          const folder = path.join(logsRoot, ...at.toISOString().slice(0, 10).split('-'));
          await fs.mkdir(folder, { recursive: true });
          await fs.writeFile(path.join(folder, 'session.log'),
            `${at.toISOString()} info [electron-message-handler] [desktop-notifications] show notification conversationId=${ids.desktop} kind=question\n`);
        },
        // A new Codex release can change the layout of its session database.
        async renameCodexColumn(from, to) {
          const db = new DatabaseSync(path.join(codexRoot, 'state_5.sqlite'));
          try { db.exec(`ALTER TABLE threads RENAME COLUMN ${from} TO ${to}`); } finally { db.close(); }
        },
        async removeRecord(id) { await fs.unlink(path.join(codexRoot, `${id}.jsonl`)); },
        async claudeRecord(entry, id = ids.claude) {
          await fs.mkdir(claudeProject, { recursive: true });
          await fs.appendFile(path.join(claudeProject, `${id}.jsonl`), `${JSON.stringify({
            sessionId: id, cwd: path.join(root, 'service'), timestamp: new Date().toISOString(), ...entry,
          })}\n`);
        },
        async claudeRaw(text) {
          await fs.appendFile(path.join(claudeProject, `${ids.claude}.jsonl`), text);
        },
        // A launcher that prints fixed `claude -p /usage` text. It cannot prove how a real Claude Code formats it.
        async installClaude(usageText) {
          await fs.writeFile(path.join(root, 'usage.txt'), usageText);
          await fs.writeFile(claudeLauncher, process.platform === 'win32'
            ? ['@echo off', 'type "%~dp0usage.txt"', ''].join('\r\n')
            : ['#!/bin/sh', 'cat "$(dirname "$0")/usage.txt"', ''].join('\n'), { mode: 0o755 });
        },
        // Claude Code keeps one status file per running process.
        async claudeProcess(pid, status, waitingFor, id = ids.claude, at = Date.now()) {
          await fs.mkdir(path.join(claudeRoot, 'sessions'), { recursive: true });
          await fs.writeFile(path.join(claudeRoot, 'sessions', `${pid}.json`), JSON.stringify({
            pid, sessionId: id, cwd: path.join(root, 'service'), kind: 'interactive', entrypoint: 'cli',
            status, ...(waitingFor ? { waitingFor } : {}), updatedAt: at, statusUpdatedAt: at,
          }));
        },
        async removeClaudeProcess(pid) { await fs.unlink(path.join(claudeRoot, 'sessions', `${pid}.json`)); },
        // A finished Codex Desktop thread whose last recorded activity is at `at`.
        async codexThread(id, title, at) {
          const file = path.join(codexRoot, `${id}.jsonl`);
          await fs.writeFile(file, `${JSON.stringify({ timestamp: new Date(at).toISOString(), type: 'event_msg', payload: { type: 'task_complete', turn_id: 'turn-1' } })}\n`);
          await fs.utimes(file, at / 1000, at / 1000);
          const db = new DatabaseSync(path.join(codexRoot, 'state_5.sqlite'));
          try {
            db.prepare('INSERT INTO threads VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)').run(
              id, title, path.join(root, 'notes'), 'app', file, Math.floor(at / 1000), at, 'Codex Desktop');
          } finally { db.close(); }
        },
        // A thread that T3 Code started in Codex. Codex records the originator and a rollout file.
        async codexT3Thread(id, title, status = 'task_complete') {
          const workspace = path.join(root, 't3-worktrees', id.slice(0, 4));
          const file = path.join(codexRoot, `${id}.jsonl`);
          const at = Date.now();
          await fs.writeFile(file, `${JSON.stringify({ timestamp: new Date(at).toISOString(), type: 'event_msg', payload: { type: status, turn_id: 'turn-t3' } })}\n`);
          const db = new DatabaseSync(path.join(codexRoot, 'state_5.sqlite'));
          try {
            db.prepare('INSERT INTO threads VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)').run(
              id, title, workspace, 'vscode', file, Math.floor(at / 1000), at, 'T3 Code');
          } finally { db.close(); }
        },
        // The parts of T3 Code's own database that Session Lights reads. `running` tells if T3 is open.
        async t3Database(threads, { running = true } = {}) {
          const folder = path.join(root, '.t3', 'userdata');
          await fs.mkdir(folder, { recursive: true });
          const db = new DatabaseSync(path.join(folder, 'state.sqlite'));
          try {
            db.exec(`
              CREATE TABLE IF NOT EXISTS projection_projects (project_id TEXT PRIMARY KEY, title TEXT NOT NULL, workspace_root TEXT NOT NULL);
              CREATE TABLE IF NOT EXISTS projection_threads (thread_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, title TEXT NOT NULL,
                worktree_path TEXT, deleted_at TEXT, archived_at TEXT, settled_override TEXT, pending_approval_count INTEGER NOT NULL DEFAULT 0,
                pending_user_input_count INTEGER NOT NULL DEFAULT 0);
              CREATE TABLE IF NOT EXISTS projection_thread_sessions (thread_id TEXT PRIMARY KEY, status TEXT NOT NULL, active_turn_id TEXT);
              CREATE TABLE IF NOT EXISTS provider_session_runtime (thread_id TEXT PRIMARY KEY, provider_name TEXT NOT NULL, resume_cursor_json TEXT);
              DELETE FROM projection_projects; DELETE FROM projection_threads; DELETE FROM projection_thread_sessions; DELETE FROM provider_session_runtime;`);
            for (const [index, thread] of threads.entries()) {
              db.prepare('INSERT OR REPLACE INTO projection_projects VALUES (?, ?, ?)').run('project-1', thread.project, thread.projectRoot);
              db.prepare('INSERT INTO projection_threads VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(`thread-${index}`, 'project-1', thread.title,
                null, thread.deleted ? new Date().toISOString() : null, null, thread.settled ? 'settled' : null, thread.approvals || 0, thread.questions || 0);
              db.prepare('INSERT INTO projection_thread_sessions VALUES (?, ?, ?)').run(`thread-${index}`, thread.status || 'ready', null);
              db.prepare('INSERT INTO provider_session_runtime VALUES (?, ?, ?)').run(`thread-${index}`, thread.provider,
                JSON.stringify(thread.provider === 'codex' ? { threadId: thread.sessionId } : { threadId: `thread-${index}`, resume: thread.sessionId }));
            }
          } finally { db.close(); }
          // T3 writes its process ID while it runs. A finished process stands for a closed T3.
          let pid = process.pid;
          if (!running) {
            const finished = require('node:child_process').spawn(process.execPath, ['-e', '']);
            await new Promise(resolve => finished.once('exit', resolve));
            pid = finished.pid;
          }
          await fs.writeFile(path.join(folder, 'server-runtime.json'), JSON.stringify({ version: 1, pid }));
        },
        async removeClaudeRecord() { await fs.unlink(path.join(claudeProject, `${ids.claude}.jsonl`)); },
        async setOpenFailure(value) {
          if (value) await fs.writeFile(failOpen, 'fail');
          else await fs.unlink(failOpen);
        },
        async openedChats() {
          try { return (await fs.readFile(opened, 'utf8')).trim().split('\n').map(line => JSON.parse(line).url); }
          catch (error) { if (error.code === 'ENOENT') return []; throw error; }
        },
      });
      if (testInfo.status === testInfo.expectedStatus) {
        expect(errors, 'The panel must not raise uncaught renderer errors').toEqual([]);
        await panel.screenshot({ path: testInfo.outputPath('result.png') });
      }
    } catch (error) {
      failed = true;
      throw error;
    } finally {
      const cleanupErrors = [];
      const preserve = async (label, operation) => {
        try { await operation(); }
        catch (error) { cleanupErrors.push(`${label}: ${error.message}`); }
      };
      failed ||= testInfo.status !== testInfo.expectedStatus;
      if (panel && !panel.isClosed() && failed) {
        await preserve('Failure screenshot', () => panel.screenshot({ path: testInfo.outputPath('failure.png') }));
      }
      await preserve('Stop fixture app', stop);
      await preserve('Runtime log', () => fs.writeFile(testInfo.outputPath('runtime.log'), runtimeLog.join('')));
      // Delete only this fixture, which mkdtemp created under the checkout.
      await preserve('Remove fixture', async () => {
        if (path.dirname(root) !== path.join(project, '.tmp')) throw Error('Invalid fixture path');
        await fs.rm(root, { recursive: true, force: true });
      });
      if (cleanupErrors.length) {
        await preserve('Attach cleanup errors', () => testInfo.attach('cleanup-errors', {
          body: cleanupErrors.join('\n'), contentType: 'text/plain',
        }));
        // Preserve the original feature failure. Cleanup alone still fails a passing test.
        if (!failed) throw Error(cleanupErrors.join('\n'));
      }
    }
  },
});

module.exports = { test, expect };
