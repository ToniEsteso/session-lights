import type { SettingsAction, SettingsPayload } from '../shared/contracts.js';
import { element as $ } from './dom.js';
import { errorMessage } from '../shared/validation.js';
const switches = new Map<string, HTMLInputElement>();
function render(value: SettingsPayload) {
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
  $('#version').textContent = `v${value.version}`;
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
$('#releases').addEventListener('click', () => { void act({ type: 'releases' }); });
$('#quit').addEventListener('click', () => { void act({ type: 'quit' }); });
export function closeSettings() { void act({ type: 'close' }); }
$('#settings-back').addEventListener('click', closeSettings);
window.settings.subscribe(render);
window.settings.read().then(render).catch(error => { $('#settings-error').textContent = errorMessage(error); $('#settings-error').hidden = false; });
