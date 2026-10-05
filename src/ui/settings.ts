import type { SettingsAction, SettingsPayload } from '../shared/contracts.js';
import { updateView } from '../shared/updates.js';
import { element as $ } from './dom.js';
import { errorMessage } from '../shared/validation.js';
let snapshot: SettingsPayload | undefined;
function render(value: SettingsPayload) {
  snapshot = value;
  const usage = $('#codex-usage');
  if (usage instanceof HTMLInputElement) usage.checked = value.codexUsageEnabled;
  const view = updateView(value.update);
  $('#version').textContent = `v${value.version}`;
  $('#update').textContent = view.label;
  const button = $('#update');
  if (button instanceof HTMLButtonElement) button.disabled = view.command === null;
  button.classList.toggle('available', view.badge);
  button.title = view.detail;
  const progress = $('#progress');
  if (progress instanceof HTMLProgressElement) {
    progress.hidden = value.update.kind !== 'downloading';
    progress.value = value.update.kind === 'downloading' ? value.update.percent : 0;
  }
}
async function act(value: SettingsAction) {
  try { await window.settings.action(value); $('#error').hidden = true; }
  catch (error) { $('#error').textContent = errorMessage(error); $('#error').hidden = false; }
}
$('#codex-usage').addEventListener('change', event => {
  if (event.target instanceof HTMLInputElement) void act({ type: 'codex-usage', enabled: event.target.checked });
});
$('#update').addEventListener('click', () => {
  if (!snapshot) return;
  const command = updateView(snapshot.update).command;
  if (command) void act({ type: 'update', command });
});
for (const type of ['close', 'quit'] as const) {
  $(`#${type}`).addEventListener('click', () => { void act({ type }); });
}
document.addEventListener('keydown', event => { if (event.key === 'Escape') void act({ type: 'close' }); });
window.settings.subscribe(render);
window.settings.read().then(render).catch(error => { $('#error').textContent = errorMessage(error); $('#error').hidden = false; });
