const fs = require('node:fs/promises');
// A second provider driven by task-owned files, without a service or account.
class FileAdapter {
  constructor(file) {
    this.file = file; this.id = 'atlas'; this.name = 'Atlas';
    this.usage = { scope: 'Workspace usage', windows: [] };
  }
  async data() {
    try { return JSON.parse(await fs.readFile(this.file, 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return {}; throw error; }
  }
  async read() { const data = await this.data(); return { sessions: data.sessions || [], health: 'Reading test provider.' }; }
  async readUsage() {
    const data = await this.data();
    if (data.failUsage) throw Error('Offline');
    return { windows: data.windows || [], updatedAt: Date.now() };
  }
  async open(id) { await fs.writeFile(`${this.file}.opened`, id); }
}
module.exports = { FileAdapter };
