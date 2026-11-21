import { appPath } from "./app-path";

/**
 * Account panel deep links (TASK-177.6).
 *
 * The account panel is a header-owned dialog, not a route of its own. A
 * `?account=<section>` query param opens it on the requested section, so a
 * notification can carry a real `<a href>` (middle-click, Cmd+click and a
 * cold refresh all work) without inventing a second account page. The
 * dialog consumes the param on mount/navigation and removes it on close.
 */
export const ACCOUNT_SECTION_IDS = [
  "profile",
  "security",
  "tokens",
  "preferences",
  "data",
] as const;

export type AccountSection = (typeof ACCOUNT_SECTION_IDS)[number];

export function isAccountSection(
  value: string | null,
): value is AccountSection {
  return (
    value !== null && (ACCOUNT_SECTION_IDS as readonly string[]).includes(value)
  );
}

/** The query param that opens the account dialog. */
export const ACCOUNT_QUERY_PARAM = "account";

/** Router-relative address of `pathname` with the account panel open. */
export function accountPath(
  pathname: string,
  search: string,
  section: AccountSection,
): string {
  // Keep the board's filters/view in the copied or reloaded link; only the
  // `account` key is ours to add or replace.
  const params = new URLSearchParams(search);
  params.set(ACCOUNT_QUERY_PARAM, section);
  return `${pathname}?${params.toString()}`;
}

/** Site-root-relative href for a fresh tab or a copied link. */
export function accountHref(
  pathname: string,
  search: string,
  section: AccountSection,
): string {
  return appPath(accountPath(pathname, search, section));
}
