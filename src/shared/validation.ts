import type { PanelAction, SettingsAction } from './contracts.js';
import { PANEL_EDGES } from './contracts.js';

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'An unexpected error occurred.';
}
export function hasErrorCode(error: unknown, code: string): boolean {
  return isRecord(error) && error.code === code;
}
export function parseAction(value: unknown): PanelAction | undefined {
  if (!isRecord(value)) return;
  switch (value.type) {
    case 'settings': return { type: 'settings', reducedMotion: value.reducedMotion === true };
    case 'sort':
      if (value.order === 'activity' || value.order === 'project') return { type: 'sort', order: value.order };
      return;
    case 'expand': return { type: 'expand', reducedMotion: value.reducedMotion === true };
    case 'set-expanded':
      if (typeof value.expanded === 'boolean') return { type: 'set-expanded', expanded: value.expanded, reducedMotion: value.reducedMotion === true };
      return;
    case 'pin': case 'open': case 'hide-session': case 'restore-session':
      if (typeof value.key === 'string') return { type: value.type, key: value.key };
      return;
    case 'move':
      if ((value.phase === 'start' || value.phase === 'update' || value.phase === 'end') &&
          typeof value.screenX === 'number' && Number.isFinite(value.screenX) &&
          typeof value.screenY === 'number' && Number.isFinite(value.screenY)) {
        return { type: 'move', phase: value.phase, screenX: value.screenX, screenY: value.screenY };
      }
      return;
    case 'show-hidden': case 'restore-all': return { type: value.type };
    default: return;
  }
}
export function parseSettingsAction(value: unknown): SettingsAction | undefined {
  if (!isRecord(value)) return;
  switch (value.type) {
    case 'theme':
      if (value.theme === 'system' || value.theme === 'light' || value.theme === 'dark') return { type: 'theme', theme: value.theme };
      return;
    case 'edge': {
      const edge = PANEL_EDGES.find(edge => edge === value.edge);
      return edge && { type: 'edge', edge };
    }
    case 'adapter':
      if (typeof value.id === 'string' && typeof value.visible === 'boolean') return { type: 'adapter', id: value.id, visible: value.visible };
      return;
    case 'launch-at-login':
      if (typeof value.enabled === 'boolean') return { type: 'launch-at-login', enabled: value.enabled };
      return;
    case 'update':
      if (value.command === 'check' || value.command === 'download' || value.command === 'install') return { type: 'update', command: value.command };
      return;
    case 'close': case 'hide': case 'quit': return { type: value.type };
    default: return;
  }
}
