declare const millisecondsBrand: unique symbol;
declare const secondsBrand: unique symbol;
export type EpochMilliseconds = number & { readonly [millisecondsBrand]: true };
export type UnixSeconds = number & { readonly [secondsBrand]: true };

// These are the only numeric type assertions. Validate before assigning the unit.
export function epochMilliseconds(value: number): EpochMilliseconds {
  if (!Number.isFinite(value) || value < 0) throw Error('Invalid time in milliseconds.');
  return value as EpochMilliseconds;
}
export function unixSeconds(value: number): UnixSeconds {
  if (!Number.isFinite(value) || value <= 0) throw Error('Invalid Unix time in seconds.');
  return value as UnixSeconds;
}
