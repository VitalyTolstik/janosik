/**
 * Millisecond durations shared across the app.
 *
 * Keeping the arithmetic in one place means a rolling window (a due-date
 * "soon" threshold, a creation-date filter, a backup timestamp) is defined
 * once instead of being re-derived from raw multipliers at every call site.
 */

/** Milliseconds in one minute. */
export const MINUTE_MS = 60 * 1000;

/** Milliseconds in one hour. */
export const HOUR_MS = 60 * MINUTE_MS;

/** Milliseconds in one day. */
export const DAY_MS = 24 * HOUR_MS;
