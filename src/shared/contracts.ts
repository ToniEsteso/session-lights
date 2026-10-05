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
  state: SessionState;
  detail: string;
  /** Last recorded session activity in epoch milliseconds, not the adapter read time.
   * Use 0 when unavailable. Drives activity sorting, row ages, and session tooltips. */
  updatedAt: EpochMilliseconds;
  project?: string;
  workspace?: string;
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
export interface PanelPreferences {
  expanded: boolean;
  showAll: boolean;
  pinned: string[];
  hiddenAdapters: string[];
  displayId: number | null;
  y: number | null;
  sortOrder: SortOrder;
}
export interface MonitorSnapshot {
  sessions: Session[];
  sources: { id: string; name: string; health: string }[];
}
export interface PanelMotion { id: number; duration: number; delay: number; height: number }
export interface PanelPayload extends MonitorSnapshot {
  update: UpdateState;
  total: number;
  preferences: PanelPreferences;
  usage: ProviderUsage[];
  demo: boolean;
  motion: PanelMotion | undefined;
  compactInset: number;
  textScale: number;
}
export type PanelAction =
  | { type: 'settings'; y: number }
  | { type: 'sort'; order: SortOrder }
  | { type: 'expand'; reducedMotion?: boolean }
  | { type: 'pin'; key: string }
  | { type: 'open'; key: string }
  | { type: 'move'; phase: 'start' | 'update' | 'end'; screenY: number }
  | { type: 'hide' }
  | { type: 'quit' };
export type TooltipTarget = (
  | { kind: 'session'; key: string }
  | { kind: 'project'; key: string }
  | { kind: 'usage'; providerId: string; id: string }
  | { kind: 'empty' }
) & { y: number };
export type TooltipData =
  | ({ kind: 'session' } & Session)
  | ({ kind: 'usage'; provider: string; scope: string | undefined; message: string | undefined;
       updatedAt: EpochMilliseconds | null } & UsageWindow)
  | { kind: 'health'; title: string; detail: string; meta?: string };
export interface SessionLightsBridge {
  read(): Promise<PanelPayload>;
  action(value: PanelAction): Promise<void>;
  tooltip(value: TooltipTarget | null): void;
  subscribe(callback: (value: PanelPayload) => void): () => void;
}
export interface SettingsPayload {
  version: string;
  update: UpdateState;
  adapters: { id: string; name: string; visible: boolean }[];
  textScale: number;
}
export type SettingsAction =
  | { type: 'adapter'; id: string; visible: boolean }
  | { type: 'update'; command: UpdateCommand }
  | { type: 'close' | 'quit' };
export interface SettingsBridge {
  read(): Promise<SettingsPayload>;
  action(value: SettingsAction): Promise<void>;
  subscribe(callback: (value: SettingsPayload) => void): () => void;
}
export interface TooltipPayload { data: TooltipData; textScale: number }
export interface TooltipBridge { subscribe(callback: (value: TooltipPayload) => void): () => void }
