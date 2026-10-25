/**
 * Support impersonation (TASK-59) — the master panel opens the app with a
 * short-lived user token in the URL hash. The hash is consumed once and the
 * token is kept in `sessionStorage` for the tab's lifetime, so a reload in
 * the same tab stays in the "view as" session while a new tab does not.
 */

const STORAGE_KEY = "janosik.impersonation";

/** Reads `#impersonate=<token>` out of the URL, clears it and stores the token. */
export function consumeImpersonationHash(): string | null {
  if (typeof window === "undefined") return null;
  const match = window.location.hash.match(/impersonate=([^&]+)/);
  if (!match || match[1] === undefined) return null;
  const token = decodeURIComponent(match[1]);
  window.history.replaceState(
    null,
    "",
    window.location.pathname + window.location.search,
  );
  try {
    window.sessionStorage.setItem(STORAGE_KEY, token);
  } catch {
    /* private mode — the in-memory token still works for this load */
  }
  return token;
}

export function getImpersonationToken(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function clearImpersonation(): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
