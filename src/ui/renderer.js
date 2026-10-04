const $ = selector => document.querySelector(selector);
const labels = { idle: 'Idle', waiting: 'Needs you', working: 'Working', error: 'Failed', unknown: 'Unknown' };
let snapshot, renderSignature, dragging, dragFrame;
let motionId, collapseTimer, pendingRender;
let effects = [];
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

async function act(value) {
  try {
    await window.sessionLights.action(value.type === 'expand' ? { ...value, reducedMotion: reducedMotion.matches } : value);
    $('#error').hidden = true;
  }
  catch (error) { $('#error').textContent = error.message; $('#error').hidden = false; }
}
function render(value) {
  if (collapseTimer && value.motion?.id === motionId) { pendingRender = value; return; }
  // The final update contains fresh data. Keep the moving DOM stable until then.
  if (value.motion && value.motion.id === motionId && snapshot?.motion?.id === motionId) return;
  if (value.motion?.id !== motionId) {
    clearTimeout(collapseTimer); collapseTimer = undefined; pendingRender = undefined;
    effects.forEach(effect => effect.cancel()); effects = [];
    motionId = value.motion?.id;
    if (value.motion?.delay && snapshot?.preferences.expanded && !value.preferences.expanded) {
      pendingRender = value;
      document.body.classList.add('resizing');
      for (const element of document.querySelectorAll('.wide')) {
        effects.push(element.animate([{ opacity: 1 }, { opacity: 0 }], { duration: value.motion.delay, fill: 'forwards' }));
      }
      collapseTimer = setTimeout(() => {
        collapseTimer = undefined;
        const next = pendingRender; pendingRender = undefined;
        renderNow(next);
      }, value.motion.delay);
      return;
    }
  }
  renderNow(value);
}
function renderNow(value) {
  const changing = snapshot && snapshot.preferences.expanded !== value.preferences.expanded;
  const previousList = changing ? $('#sessions').getBoundingClientRect() : null;
  const previousDots = new Map(changing ? [...document.querySelectorAll('.session-button')].map(button =>
    [button.dataset.key, button.querySelector('.dot').getBoundingClientRect()]) : []);
  snapshot = value;
  // Do not rebuild focused buttons during the two-second update.
  // Refresh the usage display when a reset passes, even if no source data changed.
  const signature = JSON.stringify([value, value.usage?.windows.map(window => window.resetsAt * 1000 > Date.now())]);
  if (signature === renderSignature) return;
  renderSignature = signature;
  const expanded = value.preferences.expanded;
  document.body.classList.toggle('resizing', Boolean(value.motion));
  document.body.style.setProperty('--compact-inset', `${value.compactInset || 0}px`);
  $('#panel').classList.toggle('expanded', expanded);
  $('#expand').setAttribute('aria-expanded', String(expanded));
  $('#expand').setAttribute('aria-label', expanded ? 'Hide session names' : 'Show session names');
  $('#expand').title = expanded ? 'Hide session names' : 'Show session names';
  $('#panel').title = value.sources.map(s => s.health).join(' ');
  $('#empty').title = $('#panel').title;
  $('#empty').hidden = value.sessions.length > 0;
  for (const row of document.querySelectorAll('.usage-row')) {
    const limit = value.usage?.windows.find(window => window.id === row.dataset.limit);
    const available = limit && limit.resetsAt * 1000 > Date.now();
    const track = row.querySelector('.usage-track');
    const percentage = available ? Math.round(limit.remainingPercent) : null;
    row.querySelector('.usage-value').textContent = available ? `${percentage}% left` : 'Unavailable';
    row.querySelector('.usage-fill').style.width = available ? `${limit.remainingPercent}%` : '0%';
    row.classList.toggle('low', available && limit.remainingPercent <= 20);
    row.classList.toggle('empty', available && limit.remainingPercent <= 5);
    row.classList.toggle('unavailable', !available);
    row.querySelector('.gauge-fill').style.strokeDasharray = `${available ? limit.remainingPercent : 0} 100`;
    row.querySelector('.gauge-needle').setAttribute('transform', `rotate(${available ? limit.remainingPercent * 1.8 : 0} 10 11)`);
    if (available) track.setAttribute('aria-valuenow', limit.remainingPercent);
    else track.removeAttribute('aria-valuenow');
    track.setAttribute('aria-valuetext', available ? `${percentage}% remaining` : 'Unavailable');
    const label = row.dataset.limit === 'fiveHour' ? '5-hour limit' : 'Weekly limit';
    row.title = available ? `${label}: ${percentage}% remaining. Resets ${new Date(limit.resetsAt * 1000).toLocaleString()}.\nUpdated ${new Date(value.usage.updatedAt).toLocaleTimeString()}. Account-wide usage.` :
      `${label}: ${value.usage?.message || 'Waiting for a new usage reading.'}`;
    row.querySelector('.usage-gauge').title = row.title;
    row.querySelector('.usage-gauge').setAttribute('aria-label', `${label}: ${available ? `${percentage}% remaining` : 'Unavailable'}`);
  }
  const focused = document.activeElement?.dataset;
  const fragment = document.createDocumentFragment();
  for (const session of value.sessions) {
    const row = document.createElement('div'); row.className = 'session'; row.setAttribute('role', 'listitem');
    const button = document.createElement('button'); button.className = 'session-button';
    button.dataset.key = session.key; button.dataset.action = 'session';
    button.title = `${session.provider} · ${session.title}\nWorkspace: ${session.project}\n${labels[session.state]}: ${session.detail}`;
    button.setAttribute('aria-label', `${session.title}: ${labels[session.state]}`);
    const dot = document.createElement('span'); dot.className = `dot ${session.state}`;
    dot.setAttribute('aria-hidden', 'true');
    const text = document.createElement('span'); text.className = 'wide session-text';
    const title = document.createElement('span'); title.className = 'session-title'; title.textContent = session.title;
    const detail = document.createElement('span'); detail.className = 'session-detail';
    detail.textContent = `${session.provider} · ${labels[session.state]}`;
    text.append(title, detail); button.append(dot, text);
    button.addEventListener('click', () => act(expanded ? { type: 'open', key: session.key } : { type: 'expand' }));
    const pin = document.createElement('button'); pin.className = 'wide pin'; pin.dataset.key = session.key; pin.dataset.action = 'pin';
    const pinned = value.preferences.pinned.includes(session.key);
    pin.textContent = pinned ? '◆' : '◇'; pin.title = pinned ? 'Unpin session' : 'Pin session';
    pin.setAttribute('aria-label', `${pinned ? 'Unpin' : 'Pin'} ${session.title}`); pin.setAttribute('aria-pressed', String(pinned));
    pin.addEventListener('click', () => act({ type: 'pin', key: session.key }));
    row.append(button, pin); fragment.append(row);
  }
  $('#sessions').replaceChildren(fragment);
  if (focused?.key) [...document.querySelectorAll('button[data-key]')].find(button => button.dataset.key === focused.key && button.dataset.action === focused.action)?.focus({ preventScroll: true });
  if (changing && value.motion) {
    const timing = { duration: value.motion.duration, easing: 'cubic-bezier(.333, 1, .667, 1)' };
    const listOffset = previousList.top - $('#sessions').getBoundingClientRect().top;
    for (const button of document.querySelectorAll('.session-button')) {
      const before = previousDots.get(button.dataset.key);
      const dot = button.querySelector('.dot');
      const after = dot.getBoundingClientRect();
      if (before) effects.push(dot.animate([{ transform: `translate(${before.x - after.x}px, ${before.y - after.y - listOffset}px)` },
        { transform: 'translate(0, 0)' }], timing));
    }
    const listHeight = Math.min(value.sessions.length * (expanded ? 40 : 24), Math.max(0, value.motion.height - (expanded ? 146 : 77)));
    effects.push($('#sessions').animate([{ height: `${previousList.height}px`, transform: `translateY(${listOffset}px)` },
      { height: `${listHeight}px`, transform: 'translateY(0)' }], { ...timing, fill: 'both' }));
    for (const element of document.querySelectorAll(expanded ? '.wide' : '.usage-gauge')) {
      effects.push(element.animate([{ opacity: 0, transform: 'translateX(6px)' }, { opacity: 1, transform: 'translateX(0)' }],
        { ...timing, delay: expanded ? 80 : 0, duration: expanded ? timing.duration - 80 : timing.duration, fill: 'backwards' }));
    }
  }
}
$('#expand').addEventListener('click', () => act({ type: 'expand' }));
$('#empty').addEventListener('click', () => { if (!snapshot?.preferences.expanded) act({ type: 'expand' }); });
$('#hide').addEventListener('click', () => act({ type: 'hide' }));
for (const gauge of document.querySelectorAll('.usage-gauge')) gauge.addEventListener('click', () => act({ type: 'expand' }));
$('#handle').addEventListener('pointerdown', event => {
  if (event.button !== 0 || dragging || event.target.closest('button')) return;
  event.preventDefault();
  dragging = { pointerId: event.pointerId, screenY: event.screenY };
  $('#handle').setPointerCapture(event.pointerId);
  document.body.classList.add('dragging');
  act({ type: 'move', phase: 'start', screenY: event.screenY });
});
$('#handle').addEventListener('pointermove', event => {
  if (!dragging || event.pointerId !== dragging.pointerId) return;
  dragging.screenY = event.screenY;
  if (dragFrame) return;
  dragFrame = requestAnimationFrame(() => {
    dragFrame = undefined;
    if (dragging) act({ type: 'move', phase: 'update', screenY: dragging.screenY });
  });
});
function finishDrag(event) {
  if (!dragging || event.pointerId !== dragging.pointerId) return;
  const { pointerId, screenY } = dragging;
  dragging = undefined;
  cancelAnimationFrame(dragFrame); dragFrame = undefined;
  document.body.classList.remove('dragging');
  act({ type: 'move', phase: 'end', screenY: event.type === 'pointerup' ? event.screenY : screenY });
  if ($('#handle').hasPointerCapture(pointerId)) $('#handle').releasePointerCapture(pointerId);
}
$('#handle').addEventListener('pointerup', finishDrag);
$('#handle').addEventListener('pointercancel', finishDrag);
$('#handle').addEventListener('lostpointercapture', finishDrag);
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && snapshot?.preferences.expanded) act({ type: 'expand' });
});
window.sessionLights.subscribe(render);
window.sessionLights.read().then(render).catch(error => { $('#error').textContent = error.message; $('#error').hidden = false; });
