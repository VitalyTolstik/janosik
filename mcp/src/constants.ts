/**
 * Shared constants for the Janosik MCP server.
 */

/** API version prefix every route hangs off (see the backend `main.ts`). */
export const API_PREFIX = "/api/v1";

/**
 * Soft cap on a single tool response, in characters. List tools paginate and
 * never exceed this; a hit is reported in the text so the agent can narrow
 * the query instead of silently losing rows.
 */
export const CHARACTER_LIMIT = 25_000;

/** Default page size for the cursor-paginated feeds (comments, activity). */
export const DEFAULT_PAGE_SIZE = 20;

/** Hard upper bound on a page size an agent may request. */
export const MAX_PAGE_SIZE = 100;

/** Budget for one JSON API call before it is abandoned, in ms. */
export const REQUEST_TIMEOUT_MS = 30_000;

/** Budget for an attachment upload/download (up to 25 MB), in ms. */
export const UPLOAD_TIMEOUT_MS = 180_000;

/**
 * Extra attempts for a command that failed on the network. Safe because the
 * retry reuses the same `commandId`, which the server deduplicates.
 */
export const COMMAND_RETRIES = 2;

/** Base pause before a command retry (multiplied by the attempt number). */
export const COMMAND_RETRY_DELAY_MS = 250;

/** Server name advertised over MCP. */
export const SERVER_NAME = "janosik-mcp-server";
