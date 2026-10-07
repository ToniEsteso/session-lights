import type { TooltipData } from '../shared/contracts.js';
import { panelText } from './text.js';
import { element as $ } from './dom.js';
let current: TooltipData | undefined;
function render(value: TooltipData) {
  current = value;
  const text = panelText;
  $('#meter').hidden = value.kind !== 'usage';
  $('#model').hidden = value.kind !== 'session' || !value.model;
  $('#model').textContent = value.kind === 'session' && value.model ? value.model : '';
  if (value.kind === 'session') {
    $('#meta').textContent = [text.provider(value), value.project].filter(Boolean).join(' · ');
    $('#title').textContent = value.title;
    $('#status').textContent = text.labels[value.state];
    $('#detail').textContent = value.detail;
    $('#time').textContent = value.updatedAt > 0 ? `Active ${text.age(value.updatedAt)}` : 'Time unavailable';
    $('#card').style.setProperty('--accent', `var(--status-${value.state})`);
  } else if (value.kind === 'usage') {
    const available = text.available(value);
    $('#meta').textContent = [value.provider, value.scope].filter(Boolean).join(' · ');
    $('#title').textContent = value.title || value.label || value.id;
    $('#status').textContent = available ? `${Math.round(value.remainingPercent)}% remaining` : 'Unavailable';
    $('#detail').textContent = available || value.resetsAt ? text.countdown(value.resetsAt) : value.message || 'Waiting for a new reading.';
    $('#time').textContent = [typeof value.resetsAt === 'number' && Number.isFinite(value.resetsAt) && `Reset: ${new Date(value.resetsAt * 1000).toLocaleString()}`,
      value.updatedAt && `Read ${text.age(value.updatedAt)}`].filter(Boolean).join(' · ');
    $('#meter span').style.width = `${available ? value.remainingPercent : 0}%`;
    $('#card').style.setProperty('--accent', !available ? 'var(--status-unknown)' : value.remainingPercent <= 5 ? 'var(--status-error)' : value.remainingPercent <= 20 ? 'var(--status-waiting)' : 'var(--status-idle)');
  } else {
    $('#meta').textContent = value.meta || ''; $('#title').textContent = value.title;
    $('#status').textContent = ''; $('#detail').textContent = value.detail; $('#time').textContent = '';
    $('#card').style.setProperty('--accent', 'var(--status-unknown)');
  }
  $('#meta').hidden = !$('#meta').textContent;
  $('#status').hidden = !$('#status').textContent;
  $('#detail').hidden = !$('#detail').textContent;
  $('#time').hidden = !$('#time').textContent;
}
window.tooltip.subscribe(value => {
  document.body.style.zoom = String(value.textScale);
  render(value.data);
});
setInterval(() => { if (current && document.visibilityState === 'visible') render(current); }, 1000);
