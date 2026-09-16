/**
 * Shapes shared across the auth layer (§7.2): controller ↔ service ↔ strategy.
 */

/** Name of the httpOnly cookie carrying the refresh token (§7.0). */
export const REFRESH_COOKIE = "refresh_token";

/** Public user projection — what the API returns; never the password hash. */
export interface AuthUser {
  id: string;
  email: string;
  displayName: string | null;
  isSuperAdmin: boolean;
}

/**
 * Body of register/login/refresh: `{ accessToken, user }` — the refresh token
 * never appears in the body, it rides the httpOnly cookie (§7.0).
 */
export interface AuthResponse {
  accessToken: string;
  user: AuthUser;
}

/** Full session result inside the service: response payload + raw refresh token. */
export interface AuthResult extends AuthResponse {
  refreshToken: string;
}
