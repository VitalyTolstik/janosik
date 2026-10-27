/**
 * Cadence of the SSE keep-alive tick (board and public-share streams). The
 * tick sends a `ping` comment for proxies and idle connections and, since
 * B-6, re-validates the stream's authorization and its log position.
 *
 * A mutable object rather than a constant so e2e specs can shorten the tick
 * for the one test that needs it (stream re-auth) without slowing the rest.
 */
export const sseTiming = {
  keepAliveMs: 25_000,
};
