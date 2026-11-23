/**
 * Cadence of the SSE keep-alive tick (board and public-share streams). The
 * tick sends a `ping` comment for proxies and idle connections and, since
 * B-6, re-validates the stream's authorization and its log position.
 *
 * A mutable object rather than a constant so e2e specs can shorten the tick
 * for the one test that needs it (stream re-auth) without slowing the rest.
 *
 * TASK-200.5:
 * - a PAT stream is an agent's stream and ticks every 60 s; a human/browser
 *   stream keeps the 25 s cadence;
 * - both carry jitter so thousands of streams opened by a burst do not fire
 *   their validation queries in one wave;
 * - a spec that writes `keepAliveMs` explicitly gets that value for every
 *   stream, with jitter off, so its timing assertions stay deterministic.
 */
export const SSE_KEEP_ALIVE_DEFAULT_MS = 25_000;

/** The effective tick for one stream. */
export interface KeepAliveProfile {
  baseMs: number;
  jitterMs: number;
}

export const sseTiming = {
  keepAliveMs: SSE_KEEP_ALIVE_DEFAULT_MS,
  /** PAT/agent streams: 60 s between authorization checks. */
  patKeepAliveMs: 60_000,
  /** Spread for human streams: up to +2.5 s on a 25 s cadence. */
  keepAliveJitterMs: 2_500,
  /** Spread for PAT streams: up to +6 s on a 60 s cadence. */
  patKeepAliveJitterMs: 6_000,
};

export function keepAliveProfile(viaPat: boolean): KeepAliveProfile {
  // A spec override (anything other than the built-in 25 s) applies to every
  // stream and disables jitter, preserving the pre-200.5 test contract.
  if (sseTiming.keepAliveMs !== SSE_KEEP_ALIVE_DEFAULT_MS) {
    return { baseMs: sseTiming.keepAliveMs, jitterMs: 0 };
  }
  return viaPat
    ? {
        baseMs: sseTiming.patKeepAliveMs,
        jitterMs: sseTiming.patKeepAliveJitterMs,
      }
    : {
        baseMs: sseTiming.keepAliveMs,
        jitterMs: sseTiming.keepAliveJitterMs,
      };
}
