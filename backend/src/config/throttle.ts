import { env } from "./env";

/**
 * Live global rate limit (TASK-57). The `@nestjs/throttler` guard accepts a
 * `limit` resolver that is called on every request, so the value can change
 * at runtime — no restart. It starts at the `THROTTLE_LIMIT` env default and
 * is swapped to a saved master-panel row by `ThrottleSettingsService` on boot
 * and on every edit.
 */
let current: number = env.THROTTLE_LIMIT;

/** The limit enforced right now, in requests per minute, per client. */
export const throttleLimit = (): number => current;

/** Swap the live limit (env default → saved panel row). */
export const setThrottleLimit = (limit: number): void => {
  current = limit;
};
