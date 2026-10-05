const $ = selector => document.querySelector(selector);
let current;
function render(value) {
  current = value;
  const text = window.panelText;
  $('#meter').hidden = value.kind !== 'usage';
  if (value.kind === 'session') {
    $('#meta').textContent = [value.provider, value.project].filter(Boolean).join(' · ');
    $('#title').textContent = value.title;
    $('#status').textContent = text.labels[value.state];
    $('#detail').textContent = value.detail;
    $('#time').textContent = `Last recorded activity: ${text.age(value.updatedAt)}`;
    $('#card').style.setProperty('--accent', { idle: '#8cce6b', waiting: '#ffd45e', working: '#f5f5ef', error: '#ff807c' }[value.state] || '#8a9099');
  } else if (value.kind === 'usage') {
    const available = text.available(value);
    $('#meta').textContent = [value.provider, value.scope].filter(Boolean).join(' · ');
    $('#title').textContent = value.title || value.label;
    $('#status').textContent = available ? `${Math.round(value.remainingPercent)}% remaining` : 'Unavailable';
    $('#detail').textContent = available || value.resetsAt ? text.countdown(value.resetsAt) : value.message || 'Waiting for a new reading.';
    $('#time').textContent = [Number.isFinite(value.resetsAt) && `Reset: ${new Date(value.resetsAt * 1000).toLocaleString()}`,
      value.updatedAt && `Read ${text.age(value.updatedAt)}`].filter(Boolean).join(' · ');
    $('#meter span').style.width = `${available ? value.remainingPercent : 0}%`;
    $('#card').style.setProperty('--accent', !available ? '#8a9099' : value.remainingPercent <= 5 ? '#ff807c' : value.remainingPercent <= 20 ? '#ffd45e' : '#8cce6b');
  } else {
    $('#meta').textContent = value.meta || 'Sources'; $('#title').textContent = value.title;
    $('#status').textContent = ''; $('#detail').textContent = value.detail; $('#time').textContent = '';
    $('#card').style.setProperty('--accent', '#8a9099');
  }
}
window.tooltip.subscribe(render);
setInterval(() => { if (current && document.visibilityState === 'visible') render(current); }, 1000);
