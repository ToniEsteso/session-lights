import type { PanelPayload, PanelAction, TooltipTarget } from '../shared/contracts.js';
import { panelText } from './text.js';
import { updateView } from '../shared/updates.js';
import { element as $, svgElement, usageRow } from './dom.js';
import { errorMessage } from '../shared/validation.js';
const { labels, available, countdown, age } = panelText;
let snapshot: PanelPayload | undefined;
let renderSignature: string | undefined;
let dragging: { pointerId: number; screenY: number } | undefined;
let dragFrame: number | undefined;
let motionId: number | undefined;
let collapseTimer: ReturnType<typeof setTimeout> | undefined;
let pendingRender: PanelPayload | undefined;
let effects: Animation[] = [];
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
let tooltipTimer: ReturnType<typeof setTimeout> | undefined;
let tooltipElement: HTMLElement | undefined;
const tooltipSelector = '.session-button, .usage-row, .project-heading, #empty';

function hideTooltip() {
  clearTimeout(tooltipTimer); tooltipTimer = undefined; tooltipElement = undefined;
  window.sessionLights.tooltip(null);
}
function showTooltip(element: HTMLElement) {
  if (element === tooltipElement || dragging || snapshot?.motion) return;
  hideTooltip(); tooltipElement = element;
  tooltipTimer = setTimeout(() => {
    if (!element.isConnected) return;
    const y = element.getBoundingClientRect().top;
    let target: TooltipTarget;
    if (element.classList.contains('session-button') && element.dataset.key) target = { kind: 'session', key: element.dataset.key, y };
    else if (element.classList.contains('usage-row') && element.dataset.provider && element.dataset.limit) target = { kind: 'usage', providerId: element.dataset.provider, id: element.dataset.limit, y };
    else if (element.classList.contains('project-heading') && element.dataset.projectKey) target = { kind: 'project', key: element.dataset.projectKey, y };
    else target = { kind: 'empty', y };
    window.sessionLights.tooltip(target);
  }, 220);
}
document.addEventListener('pointerover', event => {
  const element = event.target instanceof Element ? event.target.closest<HTMLElement>(tooltipSelector) : null;
  if (element) showTooltip(element); else hideTooltip();
});
document.addEventListener('pointerout', event => {
  const element = event.target instanceof Element ? event.target.closest<HTMLElement>(tooltipSelector) : null;
  if (element && !(event.relatedTarget instanceof Node && element.contains(event.relatedTarget))) hideTooltip();
});
document.documentElement.addEventListener('pointerleave', hideTooltip);
document.addEventListener('focusin', event => {
  const element = event.target instanceof Element ? event.target.closest<HTMLElement>(tooltipSelector) : null;
  if (element) showTooltip(element); else hideTooltip();
});
window.addEventListener('blur', hideTooltip);
document.addEventListener('pointerdown', hideTooltip);
$('#sessions').addEventListener('scroll', hideTooltip);

function renderUsage(value: PanelPayload) {
  const fragment = document.createDocumentFragment();
  const multiple = (value.usage || []).filter(source => source.windows.length).length > 1;
  for (const source of value.usage || []) for (const limit of source.windows) {
    const row = usageRow();
    row.dataset.limit = limit.id; row.dataset.provider = source.providerId;
    $('.usage-label', row).textContent = [multiple && source.provider, limit.label || limit.id].filter(Boolean).join(' · ');
    const label = `${source.provider} · ${limit.title || limit.label || limit.id}`;
    const track = $('.usage-track', row);
    const ready = available(limit), percentage = ready ? Math.round(limit.remainingPercent) : null;
    $('.usage-value', row).textContent = ready ? `${percentage}% left` : 'Unavailable';
    $('.usage-fill', row).style.width = `${ready ? limit.remainingPercent : 0}%`;
    row.classList.toggle('low', ready && limit.remainingPercent <= 20);
    row.classList.toggle('empty', ready && limit.remainingPercent <= 5);
    row.classList.toggle('unavailable', !ready);
    svgElement('.gauge-fill', row).style.strokeDasharray = `${ready ? limit.remainingPercent : 0} 100`;
    svgElement('.gauge-needle', row).setAttribute('transform', `rotate(${ready ? limit.remainingPercent * 1.8 : 0} 10 11)`);
    if (ready) track.setAttribute('aria-valuenow', String(limit.remainingPercent));
    track.setAttribute('aria-label', `${label} remaining`);
    track.setAttribute('aria-valuetext', ready ? `${percentage}% remaining` : 'Unavailable');
    const gauge = $('.usage-gauge', row);
    gauge.setAttribute('aria-label', `${label}: ${ready ? `${percentage}% remaining` : 'Unavailable'}`);
    gauge.setAttribute('aria-description', [source.scope, countdown(limit.resetsAt), source.message].filter(Boolean).join('. '));
    gauge.addEventListener('click', () => act({ type: 'expand' }));
    $('.usage-reset', row).textContent = ready || limit.resetsAt ? countdown(limit.resetsAt) : source.message || 'Waiting for a new reading.';
    fragment.append(row);
  }
  $('#usage').replaceChildren(fragment); $('#usage').hidden = !$('#usage').children.length;
}

async function act(value: PanelAction) {
  hideTooltip();
  try {
    await window.sessionLights.action(value.type === 'expand' ? { ...value, reducedMotion: reducedMotion.matches } : value);
    $('#error').hidden = true;
  }
  catch (error) { $('#error').textContent = errorMessage(error); $('#error').hidden = false; }
}
function render(value: PanelPayload) {
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
        if (next) renderNow(next);
      }, value.motion.delay);
      return;
    }
  }
  renderNow(value);
}
function renderNow(value: PanelPayload) {
  const changing = snapshot && snapshot.preferences.expanded !== value.preferences.expanded;
  const previousList = changing ? $('#sessions').getBoundingClientRect() : null;
  const previousDots = new Map(changing ? [...document.querySelectorAll<HTMLButtonElement>('.session-button')].map(button =>
    [button.dataset.key, $('.dot', button).getBoundingClientRect()]) : []);
  snapshot = value;
  const update = updateView(value.update);
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-settings]')) {
    button.setAttribute('aria-label', update.badge ? 'Settings. Update available.' : 'Settings');
    button.title = update.badge ? update.label : 'Settings';
    $('.update-badge', button).hidden = !update.badge;
  }
  // Do not rebuild focused buttons during the two-second update.
  // Refresh the usage display when a reset passes, even if no source data changed.
  const signature = JSON.stringify([value,
    value.preferences.expanded && value.sessions.map(session => age(session.updatedAt)),
    value.usage?.flatMap(source => source.windows.map(limit => [available(limit), countdown(limit.resetsAt)]))]);
  if (signature === renderSignature) return;
  renderSignature = signature;
  const expanded = value.preferences.expanded;
  document.body.style.setProperty('--text-scale', String(value.textScale));
  document.body.classList.toggle('resizing', Boolean(value.motion));
  document.body.style.setProperty('--compact-inset', `${value.compactInset || 0}px`);
  $('#panel').classList.toggle('expanded', expanded);
  $('#expand').setAttribute('aria-expanded', String(expanded));
  $('#expand').setAttribute('aria-label', expanded ? 'Hide session names' : 'Show session names');
  $('#expand').title = expanded ? 'Hide session names' : 'Show session names';
  $('#empty').hidden = value.sessions.length > 0;
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-sort]')) {
    button.setAttribute('aria-pressed', String(button.dataset.sort === (value.preferences.sortOrder || 'activity')));
  }
  renderUsage(value);
  const sessions = value.sessions;
  const focused = document.activeElement instanceof HTMLElement ? document.activeElement.dataset : undefined;
  const fragment = document.createDocumentFragment();
  let projectKey;
  for (const session of sessions) {
    if (expanded && value.preferences.sortOrder === 'project' && session.projectKey !== projectKey) {
      projectKey = session.projectKey;
      const heading = document.createElement('div'); heading.className = 'wide project-heading';
      heading.dataset.projectKey = projectKey; heading.setAttribute('role', 'presentation');
      const name = document.createElement('span'); name.className = 'project-name'; name.textContent = session.projectGroup;
      heading.append(name); fragment.append(heading);
    }
    const row = document.createElement('div'); row.className = 'session'; row.setAttribute('role', 'listitem');
    const button = document.createElement('button'); button.className = 'session-button';
    button.dataset.key = session.key; button.dataset.action = 'session';
    const activityAge = age(session.updatedAt);
    button.setAttribute('aria-label', `${session.title}: ${labels[session.state]}`);
    button.setAttribute('aria-description', [session.provider, session.workspace || session.project, session.detail,
      `Last activity: ${activityAge}`].filter(Boolean).join('. '));
    const dot = document.createElement('span'); dot.className = `dot ${session.state}`;
    dot.setAttribute('aria-hidden', 'true');
    const text = document.createElement('span'); text.className = 'wide session-text';
    const title = document.createElement('span'); title.className = 'session-title'; title.textContent = session.title;
    const detail = document.createElement('span'); detail.className = 'session-detail';
    const project = document.createElement('span'); project.className = 'session-project'; project.textContent = session.project;
    const meta = document.createElement('span'); meta.className = 'session-meta'; meta.textContent = `· ${session.provider} · ${labels[session.state]}`;
    detail.append(project, meta);
    const activity = document.createElement('time'); activity.className = 'wide session-activity';
    const timestamp = session.updatedAt > 0 ? new Date(session.updatedAt).toJSON() : null;
    activity.textContent = timestamp ? activityAge : '–';
    activity.setAttribute('aria-label', `Last activity: ${timestamp ? activityAge : 'Time unavailable'}`);
    if (timestamp) activity.dateTime = timestamp;
    text.append(title, detail); button.append(dot, text, activity);
    button.addEventListener('click', () => act(expanded ? { type: 'open', key: session.key } : { type: 'expand' }));
    const pin = document.createElement('button'); pin.className = 'wide pin'; pin.dataset.key = session.key; pin.dataset.action = 'pin';
    const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    icon.setAttribute('viewBox', '0 0 16 16'); icon.setAttribute('aria-hidden', 'true');
    const bookmark = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    bookmark.setAttribute('d', 'M4.5 2.5h7a1 1 0 0 1 1 1v10l-4.5-3-4.5 3v-10a1 1 0 0 1 1-1z');
    icon.append(bookmark); pin.append(icon);
    const pinned = value.preferences.pinned.includes(session.key);
    pin.title = pinned ? 'Unpin session' : 'Pin session';
    pin.setAttribute('aria-label', `${pinned ? 'Unpin' : 'Pin'} ${session.title}`); pin.setAttribute('aria-pressed', String(pinned));
    pin.addEventListener('click', () => act({ type: 'pin', key: session.key }));
    row.append(button, pin); fragment.append(row);
  }
  $('#sessions').replaceChildren(fragment);
  if (focused?.key) [...document.querySelectorAll<HTMLButtonElement>('button[data-key]')].find(button => button.dataset.key === focused.key && button.dataset.action === focused.action)?.focus({ preventScroll: true });
  if (changing && previousList && value.motion) {
    const timing = { duration: value.motion.duration, easing: 'cubic-bezier(.333, 1, .667, 1)' };
    const listOffset = previousList.top - $('#sessions').getBoundingClientRect().top;
    for (const button of document.querySelectorAll<HTMLButtonElement>('.session-button')) {
      const before = previousDots.get(button.dataset.key);
      const dot = $('.dot', button);
      const after = dot.getBoundingClientRect();
      if (before) effects.push(dot.animate([{ transform: `translate(${before.x - after.x}px, ${before.y - after.y - listOffset}px)` },
        { transform: 'translate(0, 0)' }], timing));
    }
    const usageHeight = value.usage.reduce((sum, source) => sum + source.windows.length * (expanded ? 36 : 24), 0);
    const groupHeight = expanded && value.preferences.sortOrder === 'project' ? new Set(sessions.map(session => session.projectKey)).size * 24 : 0;
    const scale = expanded ? value.textScale : 1;
    const listHeight = Math.min(sessions.length * (expanded ? 40 : 24) + groupHeight, Math.max(0, value.motion.height / scale - (expanded ? 104 : 62) - usageHeight));
    effects.push($('#sessions').animate([{ height: `${previousList.height}px`, transform: `translateY(${listOffset}px)` },
      { height: `${listHeight}px`, transform: 'translateY(0)' }], { ...timing, fill: 'both' }));
    for (const element of document.querySelectorAll(expanded ? '.wide' : '.usage-gauge')) {
      effects.push(element.animate([{ opacity: 0, transform: 'translateX(6px)' }, { opacity: 1, transform: 'translateX(0)' }],
        { ...timing, delay: expanded ? 80 : 0, duration: expanded ? timing.duration - 80 : timing.duration, fill: 'backwards' }));
    }
  }
}
$('#expand').addEventListener('click', () => act({ type: 'expand' }));
for (const button of document.querySelectorAll<HTMLButtonElement>('[data-settings]')) {
  button.addEventListener('click', () => act({ type: 'settings', y: button.getBoundingClientRect().top }));
}
$('#empty').addEventListener('click', () => { if (!snapshot?.preferences.expanded) act({ type: 'expand' }); });
$('#hide').addEventListener('click', () => act({ type: 'hide' }));
for (const button of document.querySelectorAll<HTMLButtonElement>('[data-sort]')) {
  button.addEventListener('click', () => {
    const order = button.dataset.sort;
    if (order === 'activity' || order === 'project') act({ type: 'sort', order });
  });
}
$('#handle').addEventListener('pointerdown', event => {
  if (event.button !== 0 || dragging || (event.target instanceof Element && event.target.closest('button'))) return;
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
function finishDrag(event: PointerEvent) {
  if (!dragging || event.pointerId !== dragging.pointerId) return;
  const { pointerId, screenY } = dragging;
  dragging = undefined;
  if (dragFrame !== undefined) cancelAnimationFrame(dragFrame); dragFrame = undefined;
  document.body.classList.remove('dragging');
  act({ type: 'move', phase: 'end', screenY: event.type === 'pointerup' ? event.screenY : screenY });
  if ($('#handle').hasPointerCapture(pointerId)) $('#handle').releasePointerCapture(pointerId);
}
$('#handle').addEventListener('pointerup', finishDrag);
$('#handle').addEventListener('pointercancel', finishDrag);
$('#handle').addEventListener('lostpointercapture', finishDrag);
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') {
    hideTooltip();
    if (snapshot?.preferences.expanded) {
      event.preventDefault();
      act({ type: 'expand' });
    }
  }
});
setInterval(() => { if (snapshot && !snapshot.motion && !collapseTimer && document.visibilityState === 'visible') renderNow(snapshot); }, 1000);
window.sessionLights.subscribe(render);
window.sessionLights.read().then(render).catch(error => { $('#error').textContent = errorMessage(error); $('#error').hidden = false; });
