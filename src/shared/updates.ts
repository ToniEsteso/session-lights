export type UpdateState =
  | { kind: 'disabled'; reason: string }
  | { kind: 'idle' }
  | { kind: 'no-feed' }
  | { kind: 'checking' }
  | { kind: 'current' }
  | { kind: 'available'; version: string }
  | { kind: 'downloading'; version: string; percent: number }
  | { kind: 'ready'; version: string }
  | { kind: 'installing'; version: string }
  | { kind: 'check-error'; message: string }
  | { kind: 'download-error'; version: string; message: string };

export type UpdateCommand = 'check' | 'download' | 'install';
export function updateView(state: UpdateState): { label: string; detail: string; command: UpdateCommand | null; badge: boolean } {
  switch (state.kind) {
    case 'disabled': return { label: 'Updates unavailable', detail: state.reason, command: null, badge: false };
    case 'idle': return { label: 'Check for updates', detail: '', command: 'check', badge: false };
    case 'no-feed': return { label: 'Check for updates', detail: 'No public update feed is available.', command: 'check', badge: false };
    case 'checking': return { label: 'Checking…', detail: '', command: null, badge: false };
    case 'current': return { label: 'Up to date', detail: '', command: 'check', badge: false };
    case 'available': return { label: 'Download update', detail: `Version ${state.version}`, command: 'download', badge: true };
    case 'downloading': return { label: `Downloading · ${Math.round(state.percent)}%`, detail: `Version ${state.version}`, command: null, badge: true };
    case 'ready': return { label: 'Restart to update', detail: `Version ${state.version}`, command: 'install', badge: true };
    case 'installing': return { label: 'Restarting…', detail: '', command: null, badge: true };
    case 'check-error': return { label: 'Check for updates', detail: state.message, command: 'check', badge: false };
    case 'download-error': return { label: 'Retry download', detail: state.message, command: 'download', badge: true };
    default: { const exhaustive: never = state; return exhaustive; }
  }
}
