import { env } from "./env";

/**
 * Self-host hardening (TASK-38a, §7.8).
 *
 * The refresh cookie is `httpOnly Secure SameSite=Strict`. On a plain-HTTP
 * installation a browser silently drops a `Secure` cookie: sign-in appears to
 * work, and then the user is bounced to the login screen when the 15-minute
 * access token expires — with no error anywhere. Documentation does not fix
 * this; the code must. `assertBootSecurity` refuses to boot a production
 * instance that would hit exactly that trap, unless the operator explicitly
 * acknowledges it with `COOKIE_SECURE=false`.
 */

/** Whether the refresh/admin cookies carry the `Secure` attribute. */
export function cookieSecure(): boolean {
  if (env.COOKIE_SECURE === "true") return true;
  if (env.COOKIE_SECURE === "false") return false;
  // Unset: secure in production (the correct default), plain in dev/test.
  return env.NODE_ENV === "production";
}

/**
 * Fail-fast boot guard (TASK-38a). In production, if the app is served over
 * HTTP while the cookie is `Secure`, refuse to start with an actionable
 * message; if the operator forced `COOKIE_SECURE=false`, warn loudly instead
 * (their choice, but it must be visible in the log).
 *
 * No-op outside production, so dev and e2e over plain HTTP are untouched.
 */
export function assertBootSecurity(log: (message: string) => void): void {
  if (env.NODE_ENV !== "production") return;
  const https = env.PUBLIC_ORIGIN.startsWith("https://");
  if (cookieSecure() && !https) {
    throw new Error(
      "Refusing to start: NODE_ENV=production but PUBLIC_ORIGIN is not HTTPS " +
        `(${env.PUBLIC_ORIGIN}). The refresh cookie is marked Secure, and a ` +
        "browser silently drops it over plain HTTP — the user is logged out " +
        "after 15 minutes with no error. Serve the app over HTTPS, or set " +
        "COOKIE_SECURE=false to accept the risk (not recommended).",
    );
  }
  if (!cookieSecure()) {
    log(
      "SECURITY WARNING: COOKIE_SECURE=false in production — the refresh " +
        "cookie travels over plain HTTP and can be intercepted. Use HTTPS.",
    );
  }
}
