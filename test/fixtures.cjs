const fs = require('node:fs/promises');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const ids = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222'];
async function fixture(root, now = Date.now()) {
  const codex = path.join(root, 'codex');
  const logs = path.join(root, 'logs');
  await fs.mkdir(codex, { recursive: true });
  const logDir = path.join(logs, ...new Date(now).toISOString().slice(0, 10).split('-'));
  await fs.mkdir(logDir, { recursive: true });
  const stateFile = path.join(codex, 'state_5.sqlite');
  const db = new DatabaseSync(stateFile);
  db.exec('CREATE TABLE threads (id TEXT PRIMARY KEY, title TEXT, name TEXT, cwd TEXT, source TEXT, originator TEXT, rollout_path TEXT, updated_at INTEGER, archived INTEGER);');
  const insert = db.prepare('INSERT INTO threads VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?)');
  for (const [index, id] of ids.entries()) {
    const rollout = path.join(codex, `${id}.jsonl`);
    await fs.writeFile(rollout, `${JSON.stringify({ timestamp: new Date(now - 60_000).toISOString(), type: 'event_msg', payload: { type: 'task_started' } })}\n`);
    insert.run(id, index ? 'Review tests' : 'Build the service', 'C:/work/project', 'vscode', 'Codex Desktop', rollout, Math.floor(now / 1000), 0);
  }
  insert.run('cli', 'CLI session', 'C:/work', 'cli', 'Codex CLI', '', Math.floor(now / 1000), 0);
  insert.run('helper', 'Internal helper', 'C:/work', '{"subagent":{}}', 'Codex Desktop', '', Math.floor(now / 1000), 0);
  insert.run('archived', 'Archived', 'C:/work', 'vscode', 'Codex Desktop', '', Math.floor(now / 1000), 1);
  db.close();
  const history = new DatabaseSync(path.join(codex, 'thread_history_1.sqlite'));
  history.exec('CREATE TABLE thread_turns (thread_id TEXT, turn_id TEXT, rollout_ordinal INTEGER, status TEXT);');
  const turn = history.prepare('INSERT INTO thread_turns VALUES (?, ?, ?, ?)');
  turn.run(ids[0], 'current', 1, 'inProgress'); turn.run(ids[1], 'current', 1, 'completed'); history.close();
  const log = path.join(logDir, 'desktop.log');
  await fs.writeFile(log, '');
  return { root: codex, logs, log, ids, now };
}
function setStatus(data, id, status) {
  const db = new DatabaseSync(path.join(data.root, 'thread_history_1.sqlite'));
  db.prepare('UPDATE thread_turns SET status = ? WHERE thread_id = ?').run(status, id); db.close();
}
function logLine(data, at, message) {
  const appServer = message.startsWith('[AppServerConnection] ');
  return fs.appendFile(data.log, `${new Date(at).toISOString()} info [${appServer ? 'AppServerConnection' : 'electron-message-handler'}] ${appServer ? message.slice('[AppServerConnection] '.length) : message}\n`);
}
function rolloutLine(data, id, at, type, payload) {
  return fs.appendFile(path.join(data.root, `${id}.jsonl`), `${JSON.stringify({ timestamp: new Date(at).toISOString(), type, payload })}\n`);
}
module.exports = { fixture, setStatus, logLine, rolloutLine };
