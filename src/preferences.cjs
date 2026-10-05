const fs = require('node:fs/promises');
const path = require('node:path');
const SORT_ORDERS = Object.freeze(['activity', 'project']);
const DEFAULTS = { expanded: false, showAll: true, pinned: [], displayId: null, y: null, sortOrder: 'activity' };
function clean(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) value = {};
  return { expanded: value.expanded === true, showAll: value.showAll !== false,
    pinned: Array.isArray(value.pinned) ? [...new Set(value.pinned.filter(v => typeof v === 'string').slice(0, 500))] : [],
    displayId: Number.isInteger(value.displayId) ? value.displayId : null,
    y: Number.isFinite(value.y) ? value.y : null,
    sortOrder: SORT_ORDERS.includes(value.sortOrder) ? value.sortOrder : 'activity' };
}
class Preferences {
  constructor(file) { this.file = file; this.value = { ...DEFAULTS, pinned: [] }; }
  async load() {
    try { this.value = clean(JSON.parse(await fs.readFile(this.file, 'utf8'))); }
    catch (error) { if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error; }
    return this.value;
  }
  async save(value) {
    const next = clean(value);
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    await fs.writeFile(`${this.file}.tmp`, JSON.stringify(next, null, 2));
    await fs.rename(`${this.file}.tmp`, this.file);
    this.value = next;
    return this.value;
  }
}
module.exports = { Preferences, SORT_ORDERS };
