import type { EpochMilliseconds, UnixSeconds } from '../shared/time.js';
import type { UsageWindow } from '../shared/contracts.js';
import { STATES } from '../shared/contracts.js';
export const panelText = {
  provider(session: { provider: string; source?: string }) {
    return [session.provider, session.source].filter(Boolean).join(' ');
  },
  labels: { idle: STATES.idle.label, waiting: STATES.waiting.label, working: STATES.working.label, error: STATES.error.label, unknown: STATES.unknown.label },
  available(limit: UsageWindow): limit is UsageWindow & { remainingPercent: number } {
    return typeof limit.remainingPercent === 'number' && Number.isFinite(limit.remainingPercent) && limit.remainingPercent >= 0 && limit.remainingPercent <= 100 &&
      (limit.resetsAt == null || (Number.isFinite(limit.resetsAt) && limit.resetsAt * 1000 > Date.now()));
  },
  /** Time until a reset, such as `2h` or `4d 3h`. Empty when unknown or past. */
  until(resetsAt: UnixSeconds | undefined) {
    if (resetsAt === undefined || !Number.isFinite(resetsAt)) return '';
    const minutes = Math.ceil((resetsAt * 1000 - Date.now()) / 60000);
    if (minutes <= 0) return '';
    const days = Math.floor(minutes / 1440), hours = Math.floor(minutes % 1440 / 60), rest = minutes % 60;
    return [days && `${days}d`, hours && `${hours}h`, (!days || !hours) && rest && `${rest}m`].filter(Boolean).join(' ');
  },
  countdown(resetsAt: UnixSeconds | undefined) {
    if (resetsAt === undefined || !Number.isFinite(resetsAt)) return 'Reset time unavailable';
    const left = panelText.until(resetsAt);
    return left ? `Resets in ${left}` : 'Updating…';
  },
  age(at: EpochMilliseconds | null) {
    if (at === null || !Number.isFinite(at) || at <= 0) return 'Time unavailable';
    const minutes = Math.floor(Math.max(0, Date.now() - at) / 60000);
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes}m ago`;
    if (minutes < 1440) return `${Math.floor(minutes / 60)}h ago`;
    return `${Math.floor(minutes / 1440)}d ago`;
  }
};
