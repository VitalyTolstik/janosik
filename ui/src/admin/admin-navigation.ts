import type { AdminListFilters } from "./admin-list-query";

/**
 * Links and return paths for the admin panel (TASK-176.5/176.6).
 *
 * `returnTo` is the shareable counterpart of "back": a row click carries the
 * exact filtered list URL, and the detail page's back control links to it.
 * Only internal `/admin` paths are accepted, so a crafted query cannot turn
 * the back button into an open redirect.
 */

export interface AdminLocationLike {
  pathname: string;
  search: string;
}

export const RETURN_TO_PARAM = "returnTo";

export function currentAdminPath(location: AdminLocationLike): string {
  return `${location.pathname}${location.search}`;
}

/** True when the current URL carries list/detail context worth preserving. */
export function hasAdminUrlContext(location: AdminLocationLike): boolean {
  return location.search !== "";
}

export function withReturnTo(href: string, returnTo: string | null): string {
  if (returnTo === null || returnTo === "") return href;
  if (href === returnTo) return href;
  const [path, query = ""] = href.split("?");
  const params = new URLSearchParams(query);
  params.set(RETURN_TO_PARAM, returnTo);
  const value = params.toString();
  return value === "" ? path : `${path}?${value}`;
}

/**
 * Accepts only an internal admin path. Query strings are allowed; schemes,
 * protocol-relative URLs, backslashes and line breaks are not.
 */
export function readReturnTo(params: URLSearchParams): string | null {
  const raw = params.get(RETURN_TO_PARAM);
  if (raw === null) return null;
  if (!raw.startsWith("/admin")) return null;
  if (raw.startsWith("//")) return null;
  if (raw.includes("\\") || raw.includes("\n") || raw.includes("\r")) {
    return null;
  }
  if (raw.split("/").includes("..")) return null;
  return raw;
}

/** Build a hub URL with only the filters that have a value. */
export function adminListHref(
  path: string,
  params: Record<string, string | null | undefined>,
): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== null && value !== undefined && value !== "") {
      search.set(key, value);
    }
  }
  const query = search.toString();
  return query === "" ? path : `${path}?${query}`;
}

export function adminCardsHref(
  filters: Partial<AdminListFilters> = {},
): string {
  return adminListHref("/admin/boards", {
    tab: "cards",
    boardId: filters.boardId,
    columnId: filters.columnId,
    labelId: filters.labelId,
    cardId: filters.cardId,
  });
}

export function adminCommentsHref(boardId?: string | null): string {
  return adminListHref("/admin/moderation", { tab: "comments", boardId });
}

export function adminAttachmentsHref(boardId?: string | null): string {
  return adminListHref("/admin/moderation", { tab: "attachments", boardId });
}

export function adminCommandsHref(boardId?: string | null): string {
  return adminListHref("/admin/audit", { tab: "commands", boardId });
}

export function adminActivityHref(boardId?: string | null): string {
  return adminListHref("/admin/audit", { tab: "activity", boardId });
}
