import type { Response } from "supertest";

/** Cookie name the auth controller uses for the refresh token. */
export const REFRESH_COOKIE = "refresh_token";

/** Full Set-Cookie header of the refresh cookie, or undefined when absent. */
export function refreshCookie(res: Response): string | undefined {
  const cookies = res.headers["set-cookie"] ?? [];
  const list = Array.isArray(cookies) ? cookies : [cookies];
  return list.find((cookie) => cookie.startsWith(`${REFRESH_COOKIE}=`));
}

/** Raw refresh token value from the Set-Cookie header. */
export function refreshCookieValue(res: Response): string {
  const header = refreshCookie(res);
  const match = header?.match(/^refresh_token=([^;]+)/);
  if (!match) {
    throw new Error("no refresh_token cookie in the response");
  }
  return decodeURIComponent(match[1]);
}
