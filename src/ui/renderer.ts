import type { PanelPayload, PanelAction } from '../shared/contracts.js';
import { panelText } from './text.js';
import { sessionSections } from '../shared/session-sections.js';
import { updateView } from '../shared/updates.js';
import { element as $, svgElement, usageRow } from './dom.js';
import { errorMessage } from '../shared/validation.js';
import { closeSettings } from './settings.js';
const { labels, available, countdown, until, age } = panelText;
let snapshot: PanelPayload | undefined;
let requestedExpanded: boolean | undefined;
let renderSignature: string | undefined;
let dragging: { pointerId: number; screenY: number; handle: HTMLElement } | undefined;
let threadsScrollTop = 0;
let dragFrame: number | undefined;
let motionId: number | undefined;
let collapseTimer: ReturnType<typeof setTimeout> | undefined;
let expandTimer: ReturnType<typeof setTimeout> | undefined;
let hoverCloseTimer: ReturnType<typeof setTimeout> | undefined;
let pendingRender: PanelPayload | undefined;
let effects: Animation[] = [];
let undoSession: { key: string; title: string } | undefined;
let pendingLeave: { x: number; y: number } | undefined;
function refreshList() {
  renderSignature = undefined;
  if (snapshot) renderNow(snapshot);
}
type PanelRect = { width: number; height: number };
let pendingPanelRect: PanelRect | undefined;
function panelRect(): PanelRect {
  const rect = $('#panel').getBoundingClientRect();
  return { width: rect.width, height: rect.height };
}
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
function renderUsage(value: PanelPayload) {
  const fragment = document.createDocumentFragment();
  const multiple = (value.usage || []).filter(source => source.windows.length).length > 1;
  for (const source of value.usage || []) for (const limit of source.windows) {
    const row = usageRow();
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
    reset.textContent = ready ? until(limit.resetsAt) : '';
    reset.setAttribute('aria-label', countdown(limit.resetsAt));
    reset.hidden = !ready;
    fragment.append(row);
  }
  const hasUsage = fragment.childElementCount > 0;
  $('#usage').replaceChildren(fragment); $('#usage').hidden = !hasUsage;
}

async function act(value: PanelAction) {
  if (value.type === 'settings' || value.type === 'expand' || value.type === 'set-expanded') {
    clearTimeout(expandTimer); expandTimer = undefined;
    clearTimeout(hoverCloseTimer); hoverCloseTimer = undefined;
  }
  try {
    await window.sessionLights.action(value.type === 'expand' || value.type === 'set-expanded' || value.type === 'settings'
      ? { ...value, reducedMotion: reducedMotion.matches } : value);
    $('#error').hidden = true;
    return true;
  }
  catch (error) {
    if (value.type === 'set-expanded' && requestedExpanded === value.expanded) requestedExpanded = undefined;
    $('#error').textContent = errorMessage(error); $('#error').hidden = false;
    return false;
  }
}
function requestExpanded(expanded: boolean) {
  if (requestedExpanded === expanded || (requestedExpanded === undefined && snapshot?.expanded === expanded)) return;
  requestedExpanded = expanded;
  void act({ type: 'set-expanded', expanded });
}
function panelIsExpanded() {
  return $('#panel').classList.contains('expanded');
}
function render(value: PanelPayload) {
  if (collapseTimer && value.motion?.id === motionId) { pendingRender = value; return; }
  // Ignore monitor updates until the active surface animation has finished.
  if (value.motion && value.motion.id === motionId && snapshot?.motion?.id === motionId) return;
  const motionChanged = value.motion?.id !== motionId;
  const previousPanel = motionChanged && snapshot ? panelRect() : undefined;
  if (motionChanged) {
    clearTimeout(collapseTimer); collapseTimer = undefined; pendingRender = undefined;
    effects.forEach(effect => effect.cancel()); effects = [];
    motionId = value.motion?.id;
    if (value.motion?.delay && snapshot?.expanded && !value.expanded) {
      pendingRender = value;
      pendingPanelRect = previousPanel;
      document.body.classList.add('resizing');
      for (const element of document.querySelectorAll('.wide')) {
        effects.push(element.animate([{ opacity: 1 }, { opacity: 0 }], { duration: value.motion.delay, fill: 'forwards' }));
      }
      collapseTimer = setTimeout(() => {
        collapseTimer = undefined;
        const next = pendingRender; pendingRender = undefined;
        const from = pendingPanelRect; pendingPanelRect = undefined;
        if (next) renderNow(next, from);
      }, value.motion.delay);
      return;
    }
  }
  pendingPanelRect = undefined;
  renderNow(value, previousPanel);
}
function renderNow(value: PanelPayload, previousPanel?: PanelRect) {
  if (requestedExpanded === value.expanded) requestedExpanded = undefined;
  const viewChanged = snapshot !== undefined && snapshot.view !== value.view;
  if (viewChanged && snapshot?.view === 'threads') threadsScrollTop = $('#sessions').scrollTop;
  const changing = snapshot && (snapshot.expanded !== value.expanded || snapshot.view !== value.view);
  const openingHidden = value.showHidden && !snapshot?.showHidden;
  snapshot = value;
  const update = updateView(value.update);
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-settings]')) {
    button.setAttribute('aria-label', update.badge ? 'Settings. Update available.' : 'Settings');
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
  if (pendingLeave) {
    const point = pendingLeave; pendingLeave = undefined;
    const rect = $('#panel').getBoundingClientRect(), x = point.x - window.screenX, y = point.y - window.screenY;
    if (expanded && (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom)) scheduleClose();
  }
  $('#panel').dataset.view = value.view;
  $('#threads-view').hidden = value.view !== 'threads';
  $('#settings-view').hidden = value.view !== 'settings';
  const allHidden = value.sources.length === 0;
  $('#empty').hidden = value.sessions.length > 0 || value.showHidden || allHidden;
  $('#empty .wide').textContent = value.hiddenSessions.length ? 'All sessions are hidden' : 'No sessions';
  $('#empty').setAttribute('aria-label', value.hiddenSessions.length ? 'All sessions are hidden. Show session list.' : 'No sessions. Show session list.');
  $('#empty-help').hidden = $('#empty').hidden || value.hiddenSessions.length > 0;
  $('#demo-label').hidden = !value.demo;
  if (undoSession && !value.hiddenSessions.some(session => session.key === undoSession?.key)) undoSession = undefined;
  $('#hide-feedback').hidden = !undoSession;
  $('#hide-message').textContent = undoSession ? `Hidden: ${undoSession.title}` : '';
  const hiddenToggle = $('#hidden-sessions');
  hiddenToggle.hidden = value.hiddenSessions.length === 0;
  hiddenToggle.textContent = `${value.hiddenSessions.length} hidden`;
  hiddenToggle.setAttribute('aria-label', `${value.hiddenSessions.length} ${value.hiddenSessions.length === 1 ? 'session' : 'sessions'} hidden`);
  hiddenToggle.setAttribute('aria-expanded', String(value.showHidden));
  $('#threads-view > footer').hidden = expanded && value.hiddenSessions.length === 0;
  $('#adapters-hidden').hidden = !allHidden;
  $('[data-group]').setAttribute('aria-pressed', String(value.preferences.sortOrder === 'project'));
  renderUsage(value);
  const sections = sessionSections(value);
  const focused = document.activeElement instanceof HTMLElement ? document.activeElement.dataset : undefined;
  const fragment = document.createDocumentFragment();
  for (const section of sections) {
    if (expanded && (section.title || (section.kind === 'sessions' && section.divider))) {
      const heading = document.createElement('div');
      heading.className = section.kind === 'project' ? 'wide project-heading' : `wide section-heading ${section.kind}-heading`;
      heading.setAttribute('role', 'presentation');
      if (section.title) {
        const name = document.createElement('span'); name.className = 'project-name'; name.textContent = section.title;
        heading.append(name);
      }
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
      row.dataset.state = session.state;
      const button = document.createElement('button'); button.className = 'session-button';
      button.dataset.key = session.key; button.dataset.action = 'session';
      const activityAge = age(session.updatedAt);
      button.setAttribute('aria-label', `${session.title}: ${labels[session.state]}`);
      button.setAttribute('aria-description', [panelText.provider(session), session.model && `Model: ${session.model}`, session.workspace || session.project, session.detail,
        `Last activity: ${activityAge}`].filter(Boolean).join('. '));
      const dot = document.createElement('span'); dot.className = `dot ${session.state}`;
      dot.setAttribute('aria-hidden', 'true');
      // Keep the orbit in phase when a monitor update rebuilds the row.
      if (session.state === 'working') dot.style.setProperty('--orbit-phase', `${-(Number(document.timeline.currentTime) % 1200)}ms`);
      const text = document.createElement('span'); text.className = 'wide session-text';
      const title = document.createElement('span'); title.className = 'session-title'; title.textContent = session.title;
      const activity = document.createElement('time'); activity.className = 'wide session-activity';
      const timestamp = session.updatedAt > 0 ? new Date(session.updatedAt).toJSON() : null;
      activity.textContent = timestamp ? activityAge : '–';
      activity.setAttribute('aria-label', `Last activity: ${timestamp ? activityAge : 'Time unavailable'}`);
      if (timestamp) activity.dateTime = timestamp;
      // One line per row. Only a session that needs the user shows its state as text.
      // The tooltip gives the full title and where and how the session runs.
      text.append(title);
      if (session.state === 'waiting' || session.state === 'error') {
        const state = document.createElement('span'); state.className = `session-state ${session.state}`;
        state.textContent = session.state === 'waiting' && session.detail ? session.detail : labels[session.state];
        text.append(state);
      }
      text.append(activity); button.append(dot, text);
      if (expanded) button.title = [session.title, [session.project, panelText.provider(session), session.model].filter(Boolean).join(' · '), session.detail].filter(Boolean).join('\n');
      // Use the rendered state: a visible session name opens its chat even if
      // a native pointer event has queued a resize that has not painted yet.
      button.addEventListener('click', () => act(expanded ? { type: 'open', key: session.key } : { type: 'set-expanded', expanded: true }));
      const pin = document.createElement('button'); pin.className = 'pin'; pin.dataset.key = session.key; pin.dataset.action = 'pin';
      const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      icon.setAttribute('viewBox', '0 0 16 16'); icon.setAttribute('aria-hidden', 'true');
      const bookmark = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      bookmark.setAttribute('d', 'M4.5 2.5h7a1 1 0 0 1 1 1v10l-4.5-3-4.5 3v-10a1 1 0 0 1 1-1z');
      icon.append(bookmark); pin.append(icon);
      const pinned = value.preferences.pinned.includes(session.key);
      pin.setAttribute('aria-label', `${pinned ? 'Unpin' : 'Pin'} ${session.title}`); pin.setAttribute('aria-pressed', String(pinned));
      pin.addEventListener('click', () => act({ type: 'pin', key: session.key }));
      const visibility = document.createElement('button');
      const hidden = section.kind === 'hidden';
      visibility.className = hidden ? 'restore-session' : 'hide-session';
      visibility.dataset.key = session.key; visibility.dataset.action = hidden ? 'restore-session' : 'hide-session';
      visibility.setAttribute('aria-label', `${hidden ? 'Restore' : 'Hide'} ${session.title}`);
      if (hidden) visibility.textContent = 'Restore';
      else {
        const eye = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        eye.setAttribute('viewBox', '0 0 16 16'); eye.setAttribute('aria-hidden', 'true');
        const outline = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        outline.setAttribute('d', 'M2 2l12 12M6.5 3.5A7 7 0 0 1 14 8a10 10 0 0 1-2 2.5M9.5 12.5A7 7 0 0 1 2 8a10 10 0 0 1 2-2.5M6.5 6.5a2.1 2.1 0 0 0 3 3');
        eye.append(outline); visibility.append(eye);
      }
      visibility.addEventListener('click', async () => {
        if (await act({ type: hidden ? 'restore-session' : 'hide-session', key: session.key })) {
          if (!hidden) undoSession = { key: session.key, title: session.title };
          refreshList();
        }
      });
      const actions = document.createElement('span'); actions.className = 'session-actions';
      if (!hidden) actions.append(pin);
      actions.append(visibility);
      row.append(button, actions); fragment.append(row);
    }
  }
  $('#sessions').replaceChildren(fragment);
  if (viewChanged) {
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
  if (changing && previousPanel && value.motion) {
    const targetPanel = panelRect();
    const panel = $('#panel');
    const easing = 'cubic-bezier(.2,.8,.2,1)';
    const animation = panel.animate([
      { width: String(previousPanel.width) + 'px', height: String(previousPanel.height) + 'px' },
      { width: String(targetPanel.width) + 'px', height: String(targetPanel.height) + 'px' },
    ], { duration: value.motion.duration, easing, fill: 'both' });
    effects.push(animation);
    const id = value.motion.id;
    void animation.finished.then(() => {
      if (motionId === id) window.sessionLights.finishMotion(id);
    }).catch(() => {});
    if (value.view === 'threads') {
      for (const element of document.querySelectorAll(expanded ? '.wide' : '.usage-gauge')) {
        effects.push(element.animate([{ opacity: 0, transform: 'translateX(6px)' }, { opacity: 1, transform: 'translateX(0)' }],
          { duration: value.motion.duration, easing, delay: expanded ? 80 : 0, fill: 'backwards' }));
      }
    }
  }
}
$('#empty-settings').addEventListener('click', () => act({ type: 'settings' }));
// Arrow keys move between rows.
$('#sessions').addEventListener('keydown', event => {
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
  const rows = [...document.querySelectorAll<HTMLButtonElement>('#sessions .session-button')];
  const index = rows.findIndex(row => row === document.activeElement?.closest('.session')?.querySelector('.session-button'));
  if (index < 0) return;
  event.preventDefault();
  rows[Math.max(0, Math.min(index + (event.key === 'ArrowDown' ? 1 : -1), rows.length - 1))]?.focus();
});
$('#undo-hide').addEventListener('click', async () => {
  if (!undoSession) return;
  const key = undoSession.key;
  if (await act({ type: 'restore-session', key })) {
    undoSession = undefined; refreshList();
    [...document.querySelectorAll<HTMLButtonElement>('.session-button')].find(button => button.dataset.key === key)?.focus({ preventScroll: true });
  }
});
// Let a compact-button click finish before hover moves its target. The short
// hover delay also keeps the panel closed when the pointer only crosses it.
$('#panel').addEventListener('pointerenter', () => {
  clearTimeout(hoverCloseTimer); hoverCloseTimer = undefined; pendingLeave = undefined;
  clearTimeout(expandTimer);
  expandTimer = setTimeout(() => { expandTimer = undefined; requestExpanded(true); }, 120);
});
function scheduleClose() {
  clearTimeout(hoverCloseTimer);
  if (!dragging) hoverCloseTimer = setTimeout(() => { hoverCloseTimer = undefined; if (!dragging) requestExpanded(false); }, 120);
}
$('#panel').addEventListener('pointerleave', event => {
  clearTimeout(expandTimer); expandTimer = undefined;
  clearTimeout(hoverCloseTimer);
  // The native window widens before the expanded layout paints. A leave from the
  // compact surface at that moment is not always a real exit. Check it after the paint.
  if (requestedExpanded === true && !panelIsExpanded()) { pendingLeave = { x: event.screenX, y: event.screenY }; return; }
  scheduleClose();
});
$('#panel').addEventListener('pointerdown', () => {
  clearTimeout(hoverCloseTimer); hoverCloseTimer = undefined;
});
for (const button of document.querySelectorAll<HTMLButtonElement>('[data-settings]')) {
  button.addEventListener('click', () => act({ type: 'settings' }));
}
$('#empty').addEventListener('click', () => requestExpanded(true));
$('#hidden-sessions').addEventListener('click', () => act({ type: 'show-hidden' }));
$('[data-group]').addEventListener('click', () => act({ type: 'sort', order: snapshot?.preferences.sortOrder === 'project' ? 'activity' : 'project' }));
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
