import type { SettingsAction, SettingsPayload } from '../shared/contracts.js';
import { updateView } from '../shared/updates.js';
import { element as $ } from './dom.js';
import { errorMessage } from '../shared/validation.js';
let snapshot: SettingsPayload | undefined;
const switches = new Map<string, HTMLInputElement>();
function render(value: SettingsPayload) {
  snapshot = value;
  for (const input of document.querySelectorAll<HTMLInputElement>('input[name=theme]')) input.checked = input.value === value.theme;
  document.body.style.setProperty('--text-scale', String(value.textScale));
  for (const adapter of value.adapters) {
    let input = switches.get(adapter.id);
    if (!input) {
      const label = document.createElement('label'); label.className = 'adapter-row';
      const text = document.createElement('span'); text.textContent = adapter.name;
      input = document.createElement('input'); input.type = 'checkbox'; input.setAttribute('role', 'switch');
      input.dataset.adapter = adapter.id;
      input.addEventListener('change', event => {
        if (event.currentTarget instanceof HTMLInputElement) {
          void act({ type: 'adapter', id: adapter.id, visible: event.currentTarget.checked });
        }
      });
      label.append(text, input); $('#adapters').append(label); switches.set(adapter.id, input);
    }
    input.checked = adapter.visible;
  }
  const view = updateView(value.update);
  $('#version').textContent = `v${value.version}`;
  $('#update').textContent = view.label;
  const button = $('#update');
  if (button instanceof HTMLButtonElement) button.disabled = view.command === null;
  button.classList.toggle('available', view.badge);
  button.setAttribute('aria-description', view.detail);
  $('#update-detail').textContent = view.detail;
  $('#update-detail').hidden = !view.detail || value.update.kind === 'disabled';
  const progress = $('#progress');
  if (progress instanceof HTMLProgressElement) {
    progress.hidden = value.update.kind !== 'downloading';
    progress.value = value.update.kind === 'downloading' ? value.update.percent : 0;
  }
}
async function act(value: SettingsAction) {
  try { await window.settings.action(value); $('#settings-error').hidden = true; }
  catch (error) {
    $('#settings-error').textContent = errorMessage(error); $('#settings-error').hidden = false;
    try { render(await window.settings.read()); } catch { /* Keep the action error visible. */ }
  }
}
for (const input of document.querySelectorAll<HTMLInputElement>('input[name=theme]')) {
  input.addEventListener('change', () => {
    if (input.checked && (input.value === 'system' || input.value === 'light' || input.value === 'dark')) void act({ type: 'theme', theme: input.value });
  });
}
$('#update').addEventListener('click', () => {
  if (!snapshot) return;
  const command = updateView(snapshot.update).command;
  if (command) void act({ type: 'update', command });
});
$('#quit').addEventListener('click', () => { void act({ type: 'quit' }); });
export function closeSettings() { void act({ type: 'close' }); }
$('#settings-back').addEventListener('click', closeSettings);
window.settings.subscribe(render);
window.settings.read().then(render).catch(error => { $('#settings-error').textContent = errorMessage(error); $('#settings-error').hidden = false; });
