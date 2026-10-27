import { routes } from "@/routes";
import { appPath } from "@/utils/app-path";

/**
 * Support impersonation (TASK-59) — the master panel opens the app on the
 * dedicated `/impersonate` route with a short-lived user token in the URL
 * hash. The hash is consumed once and the token is kept in `sessionStorage`
 * for the tab's lifetime, so a reload in the same tab stays in the "view
 * as" session while a new tab does not.
 *
 * U-8 (login CSRF): a link carrying *any* access token used to be adopted
 * on every route — an attacker could send a victim `/#impersonate=<the
 * attacker's own token>` and have them work inside the attacker's account
 * under a "support session" banner. The token is now accepted only
 *  - on the dedicated route (never on `/`, a board, or anywhere else), and
 *  - when it is an impersonation token: the master mints those with an
 *    `imp` claim (the master's id) that a normal login token never has, and
 *    only a master can mint one.
 * Anything else is cleared from the URL and ignored. The claim is read
 * client-side (the signature is the server's business — every request still
 * presents the token to it); the robust fix is a one-time code exchanged on
 * the server, which needs a backend change.
 */

const STORAGE_KEY = "janosik.impersonation";

/** The `imp`/`exp` claims of a JWT, or `null` when it is not one. */
function readClaims(token: string): { imp?: unknown; exp?: unknown } | null {
  const parts = token.split(".");
  if (parts.length !== 3 || parts[1] === undefined) return null;
  try {
    const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
    const json = atob(padded);
    const claims = JSON.parse(json) as unknown;
    return claims !== null && typeof claims === "object"
      ? (claims as { imp?: unknown; exp?: unknown })
      : null;
  } catch {
    return null;
  }
}

/**
 * Is this an unexpired impersonation token (it names the master who minted
 * it in `imp`)? A regular access token — the attacker's own — is not.
 */
export function isImpersonationToken(
  token: string,
  now: number = Date.now(),
): boolean {
  const claims = readClaims(token);
  if (claims === null) return false;
  if (typeof claims.imp !== "string" || claims.imp === "") return false;
  if (typeof claims.exp === "number" && claims.exp * 1000 <= now) return false;
  return true;
}

/** Is the tab on the dedicated impersonation route? */
function onImpersonationRoute(): boolean {
  const path = window.location.pathname.replace(/\/+$/, "");
  return path === appPath(routes.impersonate).replace(/\/+$/, "");
}

/**
 * Reads `#impersonate=<token>` out of the URL, always clears it, and stores
 * the token — only on the impersonation route and only for an impersonation
 * token (see the module comment).
 */
export function consumeImpersonationHash(): string | null {
  if (typeof window === "undefined") return null;
  const match = window.location.hash.match(/impersonate=([^&]+)/);
  if (!match || match[1] === undefined) return null;
  // Out of the URL (and the history entry) whatever happens next: a token
  // must not linger in the address bar, the history, or a copied link.
  window.history.replaceState(
    null,
    "",
    window.location.pathname + window.location.search,
  );
  let token: string;
  try {
    token = decodeURIComponent(match[1]);
  } catch {
    return null;
  }
  if (!onImpersonationRoute() || !isImpersonationToken(token)) return null;
  try {
    window.sessionStorage.setItem(STORAGE_KEY, token);
  } catch {
    /* private mode — the in-memory token still works for this load */
  }
  return token;
}

/** The tab's stored view-as token — dropped when it no longer qualifies. */
export function getImpersonationToken(): string | null {
  if (typeof window === "undefined") return null;
  let token: string | null;
  try {
    token = window.sessionStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
  if (token === null) return null;
  if (!isImpersonationToken(token)) {
    clearImpersonation();
    return null;
  }
  return token;
}

export function clearImpersonation(): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
