import type { PanelAction, TooltipTarget, SettingsAction } from './contracts.js';

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
    case 'settings':
      if (typeof value.y === 'number' && Number.isFinite(value.y)) return { type: 'settings', y: value.y };
      return;
    case 'sort':
      if (value.order === 'activity' || value.order === 'project') return { type: 'sort', order: value.order };
      return;
    case 'expand': return { type: 'expand', reducedMotion: value.reducedMotion === true };
    case 'pin': case 'open': case 'hide-session': case 'restore-session':
      if (typeof value.key === 'string') return { type: value.type, key: value.key };
      return;
    case 'move':
      if ((value.phase === 'start' || value.phase === 'update' || value.phase === 'end') &&
          typeof value.screenY === 'number' && Number.isFinite(value.screenY)) {
        return { type: 'move', phase: value.phase, screenY: value.screenY };
      }
      return;
    case 'hide': case 'quit': case 'show-hidden': case 'restore-all': return { type: value.type };
    default: return;
  }
}
export function parseSettingsAction(value: unknown): SettingsAction | undefined {
  if (!isRecord(value)) return;
  switch (value.type) {
    case 'theme':
      if (value.theme === 'system' || value.theme === 'light' || value.theme === 'dark') return { type: 'theme', theme: value.theme };
      return;
    case 'adapter':
      if (typeof value.id === 'string' && typeof value.visible === 'boolean') return { type: 'adapter', id: value.id, visible: value.visible };
      return;
    case 'update':
      if (value.command === 'check' || value.command === 'download' || value.command === 'install') return { type: 'update', command: value.command };
      return;
    case 'close': case 'quit': return { type: value.type };
    default: return;
  }
}
export function parseTooltipTarget(value: unknown): TooltipTarget | undefined {
  if (!isRecord(value) || typeof value.y !== 'number' || !Number.isFinite(value.y)) return;
  switch (value.kind) {
    case 'session': case 'project':
      if (typeof value.key === 'string') return { kind: value.kind, key: value.key, y: value.y };
      return;
    case 'usage':
      if (typeof value.providerId === 'string' && typeof value.id === 'string') {
        return { kind: 'usage', providerId: value.providerId, id: value.id, y: value.y };
      }
      return;
    case 'empty': return { kind: 'empty', y: value.y };
    default: return;
  }
}
