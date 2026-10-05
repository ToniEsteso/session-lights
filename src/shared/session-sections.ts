import type { PanelPayload, Session } from './contracts.js';

export type SessionSection = {
  kind: 'bookmarked' | 'sessions' | 'hidden'; title: string; sessions: Session[];
} | {
  kind: 'project'; title: string; projectKey: string; sessions: Session[];
};

// The renderer and native window use the same sections to size the panel.
export function sessionSections(value: Pick<PanelPayload, 'sessions' | 'preferences' | 'hiddenSessions' | 'showHidden'>): SessionSection[] {
  const pinned = new Set(value.preferences.pinned);
  const bookmarks = value.sessions.filter(session => pinned.has(session.key));
  const remaining = value.sessions.filter(session => !pinned.has(session.key));
  const sections: SessionSection[] = [];
  if (bookmarks.length) sections.push({ kind: 'bookmarked', title: 'Bookmarked', sessions: bookmarks });
  if (value.preferences.sortOrder === 'project') {
    for (const session of remaining) {
      const previous = sections.at(-1);
      if (previous?.kind === 'project' && previous.projectKey === session.projectKey) previous.sessions.push(session);
      else sections.push({ kind: 'project', title: session.projectGroup, projectKey: session.projectKey, sessions: [session] });
    }
  } else if (remaining.length) sections.push({ kind: 'sessions', title: bookmarks.length ? 'Sessions' : '', sessions: remaining });
  if (value.showHidden && value.hiddenSessions.length) sections.push({ kind: 'hidden', title: 'Hidden sessions', sessions: value.hiddenSessions });
  return sections;
}
