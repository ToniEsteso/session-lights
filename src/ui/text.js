window.panelText = {
  labels: { idle: 'Idle', waiting: 'Needs you', working: 'Working', error: 'Failed', unknown: 'Unknown' },
  available(limit) {
    return Number.isFinite(limit?.remainingPercent) && limit.remainingPercent >= 0 && limit.remainingPercent <= 100 &&
      (limit.resetsAt == null || (Number.isFinite(limit.resetsAt) && limit.resetsAt * 1000 > Date.now()));
  },
  countdown(resetsAt) {
    if (!Number.isFinite(resetsAt)) return 'Reset time unavailable';
    const minutes = Math.ceil((resetsAt * 1000 - Date.now()) / 60000);
    if (minutes <= 0) return 'Reset passed · waiting for a new reading';
    const days = Math.floor(minutes / 1440), hours = Math.floor(minutes % 1440 / 60), rest = minutes % 60;
    return `Resets in ${[days && `${days}d`, hours && `${hours}h`, (!days || !hours) && rest && `${rest}m`].filter(Boolean).join(' ')}`;
  },
  age(at) {
    if (!Number.isFinite(at) || at <= 0) return 'Time unavailable';
    const minutes = Math.floor(Math.max(0, Date.now() - at) / 60000);
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes}m ago`;
    if (minutes < 1440) return `${Math.floor(minutes / 60)}h ago`;
    return `${Math.floor(minutes / 1440)}d ago`;
  }
};
