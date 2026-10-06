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
};

const test = base.extend({
  lights: async ({}, use, testInfo) => {
    await fs.mkdir(path.join(project, '.tmp'), { recursive: true });
    const root = await fs.mkdtemp(path.join(project, '.tmp', 'e2e-'));
    const appRoot = path.join(root, 'app');
    const codexRoot = path.join(root, 'codex-home');
    const claudeRoot = path.join(root, 'claude-home');
    const claudeProject = path.join(claudeRoot, 'projects', 'test-project');
    const logsRoot = process.platform === 'win32' ? path.join(root, 'local', 'Codex', 'Logs') :
      process.platform === 'darwin' ? path.join(root, 'Library', 'Logs', 'com.openai.codex') :
        path.join(root, '.config', 'Codex', 'logs');
    const opened = path.join(root, 'opened.jsonl');
    const failOpen = path.join(root, 'fail-open');
    let app;
    let panel;
    const errors = [];
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

      // Substitute only the OS URL handoff. Renderer, preload, IPC, monitor,
      // provider, SQLite reads, and preference writes all remain real.
      const bootstrap = path.join(appRoot, 'launch.cjs');
      await fs.writeFile(bootstrap, `
        const { app, shell } = require('electron');
        const fs = require('node:fs');
        app.setAppPath(__dirname);
        shell.openExternal = async url => {
          if (fs.existsSync(${JSON.stringify(failOpen)})) throw Error('Test OS handoff failure');
          fs.appendFileSync(${JSON.stringify(opened)}, JSON.stringify({ url }) + '\\n');
        };
        require('./build/src/main.js');
      `);
      const env = { ...process.env, CODEX_HOME: codexRoot,
        CLAUDE_CONFIG_DIR: claudeRoot,
        HOME: root, USERPROFILE: root, APPDATA: path.join(root, 'roaming'),
        LOCALAPPDATA: path.join(root, 'local'),
        // Exercise the real unavailable-runtime path. Never use an account.
        SESSION_LIGHTS_CODEX_BINARY: path.join(root, 'absent-runtime'),
        SESSION_LIGHTS_CLAUDE_BINARY: path.join(root, 'absent-claude.exe'),
      };
      delete env.ELECTRON_RUN_AS_NODE;
      const start = async () => {
        app = await _electron.launch({ args: [bootstrap, ...(process.platform === 'linux' ? ['--no-sandbox'] : [])], env,
          colorScheme: null,
          ...(testInfo.file.endsWith('claude-code.spec.cjs') || testInfo.file.endsWith('releases.spec.cjs') ? {
            recordVideo: { dir: testInfo.outputPath('video'), size: { width: 600, height: 800 } },
          } : {}),
        });
        await expect.poll(() => app.windows().some(page => page.url().endsWith('/index.html')),
          { message: 'The app must open its thread panel' }).toBe(true);
        panel = app.windows().find(page => page.url().endsWith('/index.html'));
        await panel.waitForLoadState();
        panel.on('pageerror', error => errors.push(error.message));
        panel.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
        // Keep Electron's native theme. Playwright otherwise defaults to Light.
        await panel.emulateMedia({ colorScheme: null, reducedMotion: 'reduce' });
        // An empty panel has no visible list. Wait for its main surface instead.
        await expect(panel.getByRole('main', { name: 'Session Lights', exact: true })).toBeVisible();
        await app.context().tracing.start({ screenshots: true, snapshots: true });
        return panel;
      };
      const stop = async () => {
        if (!app) return;
        await app.context().tracing.stop({ path: testInfo.outputPath(`trace-${Date.now()}.zip`) });
        await app.close();
        app = undefined;
      };
      await start();
      await use({
        get page() { return panel; }, ids,
        async expand() {
          await panel.getByRole('list', { name: 'Sessions', exact: true }).hover();
          await expect(panel.getByRole('button', { name: 'Settings', exact: true })).toBeVisible();
        },
        async restart() { await stop(); await start(); },
        async record(id, type, payload) {
          await fs.appendFile(path.join(codexRoot, `${id}.jsonl`), `${JSON.stringify({
            timestamp: new Date().toISOString(), type, payload,
          })}\n`);
        },
        async desktopQuestion() {
          const at = new Date();
          const folder = path.join(logsRoot, ...at.toISOString().slice(0, 10).split('-'));
          await fs.mkdir(folder, { recursive: true });
          await fs.writeFile(path.join(folder, 'session.log'),
            `${at.toISOString()} info [electron-message-handler] [desktop-notifications] show notification conversationId=${ids.desktop} kind=question\n`);
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
      expect(errors, 'The panel must not raise uncaught renderer errors').toEqual([]);
      await panel.screenshot({ path: testInfo.outputPath('result.png') });
    } finally {
      if (panel && !panel.isClosed() && testInfo.status !== testInfo.expectedStatus) {
        await panel.screenshot({ path: testInfo.outputPath('failure.png') }).catch(() => {});
      }
      if (app) {
        await app.context().tracing.stop({ path: testInfo.outputPath('trace.zip') }).catch(() => {});
        await app.close();
      }
      // Delete only this fixture, which mkdtemp created under the checkout.
      if (path.dirname(root) !== path.join(project, '.tmp')) throw Error('Invalid fixture path');
      await fs.rm(root, { recursive: true, force: true });
    }
  },
});

module.exports = { test, expect };
