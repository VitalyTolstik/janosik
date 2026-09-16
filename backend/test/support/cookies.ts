import type { Response } from "supertest";

/** Cookie name the auth controller uses for the refresh token. */
export const REFRESH_COOKIE = "refresh_token";

/** Cookie name of the master-account contour (TASK-36). */
export const ADMIN_REFRESH_COOKIE = "admin_refresh_token";

/** Full Set-Cookie header carrying `name`, or undefined when absent. */
export function findCookie(res: Response, name: string): string | undefined {
  const cookies = res.headers["set-cookie"] ?? [];
  const list = Array.isArray(cookies) ? cookies : [cookies];
  return list.find((cookie) => cookie.startsWith(`${name}=`));
}

/** Full Set-Cookie header of the refresh cookie, or undefined when absent. */
export function refreshCookie(res: Response): string | undefined {
  return findCookie(res, REFRESH_COOKIE);
}

/** Raw cookie value from the Set-Cookie header. */
export function cookieValue(res: Response, name: string): string {
  const header = findCookie(res, name);
  const match = header?.match(new RegExp(`^${name}=([^;]+)`));
  if (!match) {
    throw new Error(`no ${name} cookie in the response`);
  }
  return decodeURIComponent(match[1]);
}

/** Raw refresh token value from the Set-Cookie header. */
export function refreshCookieValue(res: Response): string {
  return cookieValue(res, REFRESH_COOKIE);
}
