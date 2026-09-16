/**
 * Shapes shared across the auth layer (§7.2): controller ↔ service ↔ strategy.
 * The two public projections are re-exported from `@janosik/shared` — the
 * wire contract lives in one place (§7.0).
 */

import type { AuthResponseDto, AuthUserDto } from "@janosik/shared";

/** Name of the httpOnly cookie carrying the refresh token (§7.0). */
export const REFRESH_COOKIE = "refresh_token";

/** Public user projection — what the API returns; never the password hash. */
export type AuthUser = AuthUserDto;

/** Body of register/login/refresh — `{ accessToken, user }` (shared DTO). */
export type AuthResponse = AuthResponseDto;

/** Full session result inside the service: response payload + raw refresh token. */
export interface AuthResult extends AuthResponse {
  refreshToken: string;
}
