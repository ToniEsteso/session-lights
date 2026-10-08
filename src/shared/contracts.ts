import type { EpochMilliseconds, UnixSeconds } from './time.js';
import type { UpdateCommand, UpdateState } from './updates.js';
// This module has no Node or Electron dependencies. Adapters and renderers share it.
export const STATES = Object.freeze({
  idle: { label: 'Idle', color: '#8cce6b', symbol: '✓' },
  waiting: { label: 'Needs you', color: '#ffd45e', symbol: '?' },
  working: { label: 'Working', color: '#f5f5ef', symbol: '·' },
  error: { label: 'Failed', color: '#ff807c', symbol: '!' },
  unknown: { label: 'Unknown', color: '#8a9099', symbol: '–' }
} as const);
export type SessionState = keyof typeof STATES;
export const SORT_ORDERS = ['activity', 'project'] as const;
export type SortOrder = typeof SORT_ORDERS[number];

export interface AdapterSession {
  id: string;
  title: string;
  /** Optional interface label within the provider, such as CLI or Desktop. */
  source?: string;
  /** Model saved for this session. Omit when the records do not identify one. */
  model?: string;
  state: SessionState;
  detail: string;
  /** Last recorded session activity in epoch milliseconds, not the adapter read time.
   * Use 0 when unavailable. Drives activity sorting and row ages. */
  updatedAt: EpochMilliseconds;
  /** Start of the current turn in epoch milliseconds. Set only while the session is working. */
  startedAt?: EpochMilliseconds;
  project?: string;
  workspace?: string;
  /** Folder shared by every worktree of one project. Groups sessions whose workspaces differ. */
  projectRoot?: string;
  projectId?: string;
}
export interface Session extends AdapterSession {
  key: string;
  providerId: string;
  provider: string;
  project: string;
  workspace: string;
  projectKey: string;
  projectGroup: string;
}
export interface SessionReading { sessions: AdapterSession[]; health: string }
export interface UsageWindow {
  id: string;
  label?: string;
  title?: string;
  remainingPercent?: number;
  /** Unix time in seconds. Session activity and reading times use milliseconds. */
  resetsAt?: UnixSeconds;
}
export type UsageWindowDefinition = Pick<UsageWindow, 'id' | 'label' | 'title'>;
export interface UsageDefinition { scope: string; windows: UsageWindowDefinition[] }
export interface UsageReading { windows: UsageWindow[]; message?: string; updatedAt: EpochMilliseconds | null }
export interface ProviderUsage extends UsageReading {
  providerId: string;
  provider: string;
  scope?: string;
}
export type OpenExternal = (url: string) => Promise<unknown>;
export interface SessionAdapter {
  readonly id: string;
  readonly name: string;
  readonly usage?: UsageDefinition;
  read(): Promise<SessionReading>;
  readUsage?(): Promise<UsageReading>;
  open?(id: string, openExternal: OpenExternal): Promise<void>;
  close?(): void;
}
export type ThemeChoice = 'system' | 'light' | 'dark';
export const PANEL_EDGES = ['right', 'left', 'top', 'bottom'] as const;
/** Screen edge that holds the panel. Left and right edges show a vertical bar. */
export type PanelEdge = typeof PANEL_EDGES[number];
export interface PanelPreferences {
  theme: ThemeChoice;
  pinned: string[];
  hidden: string[];
  hiddenAdapters: string[];
  displayId: number | null;
  edge: PanelEdge;
  /** Saved position along a left or right edge. */
  y: number | null;
  /** Saved position along a top or bottom edge. */
  x: number | null;
  sortOrder: SortOrder;
}
export interface MonitorSnapshot {
  sessions: Session[];
  sources: { id: string; name: string; health: string }[];
}
export interface PanelMotion { id: number; duration: number; delay: number }
export interface PanelPayload extends MonitorSnapshot {
  expanded: boolean;
  view: 'threads' | 'settings';
  update: UpdateState;
  total: number;
  hiddenSessions: Session[];
  showHidden: boolean;
  preferences: PanelPreferences;
  usage: ProviderUsage[];
  demo: boolean;
  motion: PanelMotion | undefined;
  compactInset: number;
  textScale: number;
}
export type PanelAction =
  | { type: 'settings'; reducedMotion?: boolean }
  | { type: 'sort'; order: SortOrder }
  | { type: 'expand'; reducedMotion?: boolean }
  | { type: 'set-expanded'; expanded: boolean; reducedMotion?: boolean }
  | { type: 'pin'; key: string }
  | { type: 'hide-session'; key: string }
  | { type: 'restore-session'; key: string }
  | { type: 'show-hidden' }
  | { type: 'restore-all' }
  | { type: 'open'; key: string }
  | { type: 'move'; phase: 'start' | 'update' | 'end'; screenX: number; screenY: number };
export interface SessionLightsBridge {
  read(): Promise<PanelPayload>;
  action(value: PanelAction): Promise<void>;
  finishMotion(id: number): void;
  subscribe(callback: (value: PanelPayload) => void): () => void;
}
export interface SettingsPayload {
  theme: ThemeChoice;
  edge: PanelEdge;
  version: string;
  update: UpdateState;
  adapters: { id: string; name: string; visible: boolean }[];
  textScale: number;
}
export type SettingsAction =
  | { type: 'theme'; theme: ThemeChoice }
  | { type: 'edge'; edge: PanelEdge }
  | { type: 'adapter'; id: string; visible: boolean }
  | { type: 'update'; command: UpdateCommand }
  | { type: 'close' | 'quit' };
export interface SettingsBridge {
  read(): Promise<SettingsPayload>;
  action(value: SettingsAction): Promise<void>;
  subscribe(callback: (value: SettingsPayload) => void): () => void;
}
