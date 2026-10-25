import type {
  AttachmentDto,
  CommentPage,
  PublicBoardDto,
} from "@janosik/shared";
import { ApiError, apiBaseUrl } from "@/api/client";

/**
 * The public `/share/:token` client (TASK-58) — deliberately *not* the app's
 * `api` instance: the public page runs with no session, sends no
 * `Authorization` header and never refreshes a token. Plain `fetch` against
 * the same base URL, so a dead link surfaces as a plain status.
 */

function publicUrl(token: string, rest = ""): string {
  return `${apiBaseUrl()}/share/${encodeURIComponent(token)}${rest}`;
}

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, {
    headers: { Accept: "application/json" },
    credentials: "omit",
    ...(signal ? { signal } : {}),
  }).catch(() => {
    throw new ApiError(0, null);
  });
  const text = await response.text();
  let parsed: unknown = null;
  if (text !== "") {
    try {
      parsed = JSON.parse(text) as unknown;
    } catch {
      if (response.ok) throw new ApiError(response.status, null, "Bad JSON");
    }
  }
  if (!response.ok) throw new ApiError(response.status, parsed);
  return parsed as T;
}

/** The whole public payload (live aggregate or frozen snapshot). */
export function fetchPublicBoard(
  token: string,
  signal?: AbortSignal,
): Promise<PublicBoardDto> {
  return getJson<PublicBoardDto>(publicUrl(token), signal);
}

/**
 * The live SSE stream, read-only. Like the member stream this is a fetch
 * reader (so nothing rides a URL) — but here there is no token to attach at
 * all. The caller parses `text/event-stream` with the shared parser.
 */
export async function openPublicEvents(
  token: string,
  since: number,
  signal: AbortSignal,
): Promise<ReadableStream<Uint8Array>> {
  const response = await fetch(
    `${publicUrl(token, "/events")}?since=${since}`,
    {
      headers: { Accept: "text/event-stream" },
      credentials: "omit",
      signal,
    },
  ).catch(() => {
    throw new ApiError(0, null);
  });
  if (!response.ok || response.body === null) {
    throw new ApiError(response.status, null);
  }
  return response.body;
}

/** Card comments, when the share exposes them. */
export function fetchPublicComments(
  token: string,
  cardId: string,
  cursor?: string,
  limit?: number,
): Promise<CommentPage> {
  const params = new URLSearchParams();
  if (cursor) params.set("cursor", cursor);
  if (limit !== undefined) params.set("limit", String(limit));
  const query = params.toString();
  return getJson<CommentPage>(
    publicUrl(token, `/cards/${encodeURIComponent(cardId)}/comments`) +
      (query === "" ? "" : `?${query}`),
  );
}

/** Card attachments, when the share exposes them. */
export function fetchPublicAttachments(
  token: string,
  cardId: string,
): Promise<AttachmentDto[]> {
  return getJson<AttachmentDto[]>(
    publicUrl(token, `/cards/${encodeURIComponent(cardId)}/attachments`),
  );
}

/** Streaming URL of one attachment blob (used as an `<img>`/link href). */
export function publicAttachmentUrl(
  token: string,
  attachmentId: string,
): string {
  return publicUrl(
    token,
    `/attachments/${encodeURIComponent(attachmentId)}/content`,
  );
}

/** The OG preview image URL (meta tags on the page point here). */
export function publicOgUrl(token: string): string {
  return publicUrl(token, "/og.png");
}
