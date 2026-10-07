import type { PanelPayload, PanelAction, TooltipTarget } from '../shared/contracts.js';
import { panelText } from './text.js';
import { sessionSections } from '../shared/session-sections.js';
import { updateView } from '../shared/updates.js';
import { element as $, svgElement, usageRow } from './dom.js';
import { errorMessage } from '../shared/validation.js';
import { closeSettings } from './settings.js';
const { labels, available, countdown, age } = panelText;
let snapshot: PanelPayload | undefined;
let requestedExpanded: boolean | undefined;
let renderSignature: string | undefined;
let dragging: { pointerId: number; screenY: number; handle: HTMLElement } | undefined;
let threadsScrollTop = 0;
let dragFrame: number | undefined;
let motionId: number | undefined;
let collapseTimer: ReturnType<typeof setTimeout> | undefined;
let pendingRender: PanelPayload | undefined;
let effects: Animation[] = [];
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
let tooltipTimer: ReturnType<typeof setTimeout> | undefined;
let tooltipElement: HTMLElement | undefined;
const tooltipSelector = '.session-button, .usage-row, .project-heading, #empty, #empty-settings';

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
    gauge.addEventListener('click', () => requestExpanded(true));
    const reset = $('.usage-reset', row);
    reset.textContent = ready && limit.resetsAt ? countdown(limit.resetsAt) : '';
    reset.hidden = !reset.textContent;
    fragment.append(row);
  }
  $('#usage').replaceChildren(fragment); $('#usage').hidden = !$('#usage').children.length;
}

async function act(value: PanelAction) {
  hideTooltip();
  try {
    await window.sessionLights.action(value.type === 'expand' || value.type === 'set-expanded' || value.type === 'settings'
      ? { ...value, reducedMotion: reducedMotion.matches } : value);
    $('#error').hidden = true;
  }
  catch (error) {
    if (value.type === 'set-expanded' && requestedExpanded === value.expanded) requestedExpanded = undefined;
    $('#error').textContent = errorMessage(error); $('#error').hidden = false;
  }
}
function requestExpanded(expanded: boolean) {
  if (requestedExpanded === expanded || (requestedExpanded === undefined && snapshot?.expanded === expanded)) return;
  requestedExpanded = expanded;
  void act({ type: 'set-expanded', expanded });
}
function panelIsExpanded() {
  return requestedExpanded ?? snapshot?.expanded ?? false;
}
function render(value: PanelPayload) {
  if (collapseTimer && value.motion?.id === motionId) { pendingRender = value; return; }
  // The final update contains fresh data. Keep the moving DOM stable until then.
  if (value.motion && value.motion.id === motionId && snapshot?.motion?.id === motionId) return;
  if (value.motion?.id !== motionId) {
    clearTimeout(collapseTimer); collapseTimer = undefined; pendingRender = undefined;
    effects.forEach(effect => effect.cancel()); effects = [];
    motionId = value.motion?.id;
    if (value.motion?.delay && snapshot?.expanded && !value.expanded) {
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
  if (requestedExpanded === value.expanded) requestedExpanded = undefined;
  const viewChanged = snapshot !== undefined && snapshot.view !== value.view;
  if (viewChanged && snapshot?.view === 'threads') threadsScrollTop = $('#sessions').scrollTop;
  const changing = snapshot && snapshot.expanded !== value.expanded;
  const previousList = changing ? $('#sessions').getBoundingClientRect() : null;
  const previousDots = new Map(changing ? [...document.querySelectorAll<HTMLButtonElement>('.session-button')].map(button =>
    [button.dataset.key, $('.dot', button).getBoundingClientRect()]) : []);
  const openingHidden = value.showHidden && !snapshot?.showHidden;
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
    value.expanded && [...value.sessions, ...(value.showHidden ? value.hiddenSessions : [])].map(session => age(session.updatedAt)),
    value.usage?.flatMap(source => source.windows.map(limit => [available(limit), countdown(limit.resetsAt)]))]);
  if (signature === renderSignature) return;
  renderSignature = signature;
  const expanded = value.expanded;
  document.body.style.setProperty('--text-scale', String(value.textScale));
  document.body.classList.toggle('resizing', Boolean(value.motion));
  document.body.style.setProperty('--compact-inset', `${value.compactInset || 0}px`);
  $('#panel').classList.toggle('expanded', expanded);
  $('#panel').dataset.view = value.view;
  $('#threads-view').hidden = value.view !== 'threads';
  $('#settings-view').hidden = value.view !== 'settings';
  const allHidden = value.sources.length === 0;
  $('#empty').hidden = value.sessions.length > 0 || value.showHidden || allHidden;
  $('#empty .wide').textContent = value.hiddenSessions.length ? 'All sessions are hidden.' : 'No local sessions.';
  $('#empty').setAttribute('aria-label', value.hiddenSessions.length ? 'All sessions are hidden. Show session list.' : 'No sessions. Show session list.');
  const hiddenToggle = $('#hidden-sessions');
  hiddenToggle.hidden = value.hiddenSessions.length === 0;
  hiddenToggle.textContent = `${value.hiddenSessions.length} ${value.hiddenSessions.length === 1 ? 'session' : 'sessions'} hidden`;
  hiddenToggle.setAttribute('aria-expanded', String(value.showHidden));
  hiddenToggle.title = value.showHidden ? 'Close hidden sessions' : 'Show hidden sessions';
  $('#threads-view > footer').hidden = expanded && value.hiddenSessions.length === 0;
  $('#adapters-hidden').hidden = !allHidden;
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-sort]')) {
    button.setAttribute('aria-pressed', String(button.dataset.sort === (value.preferences.sortOrder || 'activity')));
  }
  renderUsage(value);
  const sections = sessionSections(value);
  const sessions = sections.flatMap(section => section.sessions);
  const focused = document.activeElement instanceof HTMLElement ? document.activeElement.dataset : undefined;
  const fragment = document.createDocumentFragment();
  for (const section of sections) {
    if (expanded && section.title) {
      const heading = document.createElement('div');
      heading.className = section.kind === 'project' ? 'wide project-heading' : `wide section-heading ${section.kind}-heading`;
      if (section.kind === 'project') heading.dataset.projectKey = section.projectKey;
      heading.setAttribute('role', 'presentation');
      const name = document.createElement('span'); name.className = 'project-name'; name.textContent = section.title;
      heading.append(name);
      if (section.kind === 'hidden') {
        const restoreAll = document.createElement('button'); restoreAll.className = 'restore-all';
        restoreAll.textContent = 'Restore all'; restoreAll.dataset.action = 'restore-all';
        restoreAll.addEventListener('click', () => act({ type: 'restore-all' }));
        heading.append(restoreAll);
      }
      fragment.append(heading);
    }
    for (const session of section.sessions) {
      const row = document.createElement('div'); row.className = section.kind === 'hidden' ? 'session hidden-session' : 'session'; row.setAttribute('role', 'listitem');
      const button = document.createElement('button'); button.className = 'session-button';
      button.dataset.key = session.key; button.dataset.action = 'session';
      const activityAge = age(session.updatedAt);
      button.setAttribute('aria-label', `${session.title}: ${labels[session.state]}`);
      button.setAttribute('aria-description', [panelText.provider(session), session.model && `Model: ${session.model}`, session.workspace || session.project, session.detail,
        `Last activity: ${activityAge}`].filter(Boolean).join('. '));
      const dot = document.createElement('span'); dot.className = `dot ${session.state}`;
      dot.setAttribute('aria-hidden', 'true');
      const text = document.createElement('span'); text.className = 'wide session-text';
      const title = document.createElement('span'); title.className = 'session-title'; title.textContent = session.title;
      const detail = document.createElement('span'); detail.className = 'session-detail';
      detail.classList.toggle('has-model', Boolean(session.model));
      const project = document.createElement('span'); project.className = 'session-project'; project.textContent = session.project;
      const meta = document.createElement('span'); meta.className = 'session-meta';
      const provider = document.createElement('span'); provider.className = 'session-provider'; provider.textContent = `· ${panelText.provider(session)}`;
      meta.append(provider);
      if (session.model) {
        const model = document.createElement('span'); model.className = 'session-model'; model.textContent = `· ${session.model}`;
        meta.append(model);
      }
      detail.append(project, meta);
      const activity = document.createElement('time'); activity.className = 'wide session-activity';
      const timestamp = session.updatedAt > 0 ? new Date(session.updatedAt).toJSON() : null;
      activity.textContent = timestamp ? activityAge : '–';
      activity.setAttribute('aria-label', `Last activity: ${timestamp ? activityAge : 'Time unavailable'}`);
      if (timestamp) activity.dateTime = timestamp;
      text.append(title, detail); button.append(dot, text, activity);
      button.addEventListener('click', () => act(panelIsExpanded() ? { type: 'open', key: session.key } : { type: 'set-expanded', expanded: true }));
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
      const visibility = document.createElement('button');
      const hidden = section.kind === 'hidden';
      visibility.className = hidden ? 'wide restore-session' : 'wide hide-session';
      visibility.dataset.key = session.key; visibility.dataset.action = hidden ? 'restore-session' : 'hide-session';
      visibility.title = hidden ? 'Restore session' : 'Hide session';
      visibility.setAttribute('aria-label', `${hidden ? 'Restore' : 'Hide'} ${session.title}`);
      if (hidden) visibility.textContent = 'Restore';
      else {
        const eye = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        eye.setAttribute('viewBox', '0 0 16 16'); eye.setAttribute('aria-hidden', 'true');
        const outline = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        outline.setAttribute('d', 'M2 2l12 12M6.5 3.5A7 7 0 0 1 14 8a10 10 0 0 1-2 2.5M9.5 12.5A7 7 0 0 1 2 8a10 10 0 0 1 2-2.5M6.5 6.5a2.1 2.1 0 0 0 3 3');
        eye.append(outline); visibility.append(eye);
      }
      visibility.addEventListener('click', () => act({ type: hidden ? 'restore-session' : 'hide-session', key: session.key }));
      row.append(button);
      if (!hidden) row.append(pin);
      row.append(visibility); fragment.append(row);
    }
  }
  $('#sessions').replaceChildren(fragment);
  if (viewChanged) {
    hideTooltip();
    if (value.view === 'settings') {
      $('.settings-content').scrollTop = 0;
      $('#settings-back').focus({ preventScroll: true });
    } else if (expanded) {
      $('#sessions').scrollTop = threadsScrollTop;
      $('header [data-settings]').focus({ preventScroll: true });
    }
  }
  if (focused?.key) {
    const target = [...document.querySelectorAll<HTMLButtonElement>('button[data-key]')].find(button => button.dataset.key === focused.key && button.dataset.action === focused.action);
    if (target) target.focus({ preventScroll: true });
    else if (focused.action === 'hide-session') hiddenToggle.focus({ preventScroll: true });
    else if (focused.action === 'restore-session') [...document.querySelectorAll<HTMLButtonElement>('.session-button')].find(button => button.dataset.key === focused.key)?.focus({ preventScroll: true });
  }
  if (focused?.action === 'restore-all') (document.querySelector<HTMLButtonElement>('.restore-all') ?? document.querySelector<HTMLButtonElement>('.session-button'))?.focus({ preventScroll: true });
  if (openingHidden) document.querySelector('.hidden-heading')?.scrollIntoView({ block: 'start' });
  if (changing && previousList && value.motion && value.view === 'threads') {
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
    const groupHeight = expanded ? sections.filter(section => section.title).length * 24 : 0;
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
$('#empty-settings').addEventListener('click', () => act({ type: 'settings' }));
$('#panel').addEventListener('pointerenter', () => requestExpanded(true));
$('#panel').addEventListener('pointerleave', () => { if (!dragging) requestExpanded(false); });
for (const button of document.querySelectorAll<HTMLButtonElement>('[data-settings]')) {
  button.addEventListener('click', () => act({ type: 'settings' }));
}
$('#empty').addEventListener('click', () => requestExpanded(true));
$('#hidden-sessions').addEventListener('click', () => act({ type: 'show-hidden' }));
for (const button of document.querySelectorAll<HTMLButtonElement>('[data-sort]')) {
  button.addEventListener('click', () => {
    const order = button.dataset.sort;
    if (order === 'activity' || order === 'project') act({ type: 'sort', order });
  });
}
for (const handle of document.querySelectorAll<HTMLElement>('.panel-handle')) {
  handle.addEventListener('pointerdown', event => {
    if (event.button !== 0 || dragging || (event.target instanceof Element && event.target.closest('button'))) return;
    event.preventDefault();
    dragging = { pointerId: event.pointerId, screenY: event.screenY, handle };
    handle.setPointerCapture(event.pointerId);
    document.body.classList.add('dragging');
    act({ type: 'move', phase: 'start', screenY: event.screenY });
  });
  handle.addEventListener('pointermove', event => {
    if (!dragging || event.pointerId !== dragging.pointerId) return;
    dragging.screenY = event.screenY;
    if (dragFrame) return;
    dragFrame = requestAnimationFrame(() => {
      dragFrame = undefined;
      if (dragging) act({ type: 'move', phase: 'update', screenY: dragging.screenY });
    });
  });
  handle.addEventListener('pointerup', finishDrag);
  handle.addEventListener('pointercancel', finishDrag);
  handle.addEventListener('lostpointercapture', finishDrag);
}
function finishDrag(event: PointerEvent) {
  if (!dragging || event.pointerId !== dragging.pointerId) return;
  const { pointerId, screenY, handle } = dragging;
  dragging = undefined;
  if (dragFrame !== undefined) cancelAnimationFrame(dragFrame); dragFrame = undefined;
  document.body.classList.remove('dragging');
  act({ type: 'move', phase: 'end', screenY: event.type === 'pointerup' ? event.screenY : screenY });
  if (handle.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId);
}
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') {
    hideTooltip();
    if (snapshot?.view === 'settings') {
      event.preventDefault(); closeSettings(); return;
    }
    if (panelIsExpanded()) {
      event.preventDefault();
      requestExpanded(false);
    }
  }
});
setInterval(() => { if (snapshot && !snapshot.motion && !collapseTimer && document.visibilityState === 'visible') renderNow(snapshot); }, 1000);
window.sessionLights.subscribe(render);
window.sessionLights.read().then(render).catch(error => { $('#error').textContent = errorMessage(error); $('#error').hidden = false; });
