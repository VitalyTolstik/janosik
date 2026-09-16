import type { AdminUserDto } from "@janosik/shared";

/**
 * Master-account contour (§7.4, TASK-36). The audience, the cookie name and
 * the cookie path are all different from the user contour, so neither
 * strategy can ever accept the other side's token or cookie.
 */

/** httpOnly refresh cookie of the admin contour. */
export const ADMIN_REFRESH_COOKIE = "admin_refresh_token";

/** Only this path receives the admin cookie — user routes never see it. */
export const ADMIN_REFRESH_COOKIE_PATH = "/api/v1/admin/auth";

/** JWT audience that separates master tokens from user tokens. */
export const ADMIN_JWT_AUDIENCE = "janosik-admin";

/** `typ` claim carried by every admin access token. */
export const ADMIN_TOKEN_TYPE = "admin";

/** Failed logins before the account is temporarily locked. */
export const ADMIN_MAX_FAILED_LOGINS = 5;

/** Lockout window after too many failed logins. */
export const ADMIN_LOCKOUT_MS = 15 * 60 * 1000;

/** What `request.user` carries on `/admin/*` routes. */
export type AdminPrincipal = AdminUserDto;

/** Session result inside the service: response payload + raw refresh token. */
export interface AdminSessionResult {
  accessToken: string;
  refreshToken: string;
  admin: AdminUserDto;
}
