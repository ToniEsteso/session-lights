import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { CodexCliAdapter } from '../src/adapters/codex-cli.js';

// Compare fresh processes against the same isolated fixture. Never modify a supplied root.
async function main() {
  const supplied = process.argv.find(arg => arg.startsWith('--root='))?.slice('--root='.length);
  let root = supplied ? path.resolve(supplied) : '';
  if (!root) {
    const evidence = path.resolve(__dirname, '..', '..', 'evidence');
    await fs.mkdir(evidence, { recursive: true });
    root = await fs.mkdtemp(path.join(evidence, 'records-benchmark-'));
    const db = new DatabaseSync(path.join(root, 'state_5.sqlite'));
    try {
      db.exec('CREATE TABLE threads (id TEXT, title TEXT, cwd TEXT, source TEXT, rollout_path TEXT, updated_at INTEGER, archived INTEGER)');
      const insert = db.prepare('INSERT INTO threads VALUES (?, ?, ?, ?, ?, ?, 0)');
      const now = Date.now();
      const event = (type: string) => JSON.stringify({ timestamp: new Date(now).toISOString(), type: 'event_msg', payload: { type, turn_id: 'fixture' } }) + '\n';
      const line = JSON.stringify({ timestamp: new Date(now).toISOString(), type: 'response_item', payload: { type: 'message', role: 'assistant', content: 'x'.repeat(900) } }) + '\n';
      const text = event('task_started') + line.repeat(510) + event('task_complete');
      for (let i = 0; i < 300; i++) {
        const file = path.join(root, i + '.jsonl');
        await fs.writeFile(file, text);
        insert.run(String(i), 'Benchmark fixture', 'C:/work', 'cli', file, Math.floor(now / 1000));
      }
    } finally { db.close(); }
  }
  const adapter = new CodexCliAdapter({ root });
  const before = process.memoryUsage().rss;
  const readings = [];
  for (let i = 0; i < 3; i++) {
    const cpu = process.cpuUsage();
    const started = performance.now();
    const result = await adapter.read();
    const used = process.cpuUsage(cpu);
    readings.push({ poll: i + 1, sessions: result.sessions.length, elapsedMs: Math.round(performance.now() - started),
      cpuMs: Math.round((used.user + used.system) / 1000), rssGrowthMiB: Math.round((process.memoryUsage().rss - before) / 1048576) });
  }
  console.log(JSON.stringify({ root, readings }, null, 2));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
