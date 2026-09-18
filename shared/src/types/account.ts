/**
 * Account / identity contract shared by the API and the UI (TASK-36.1).
 *
 * The avatar palette is a fixed set of keys: the UI renders each key as a
 * design token class or CSS variable, and the backend validates the key
 * against the same list — so a stored color can never be a value the UI
 * does not know how to draw.
 */

/** Avatar palette keys, persisted in `User.avatarColor`. */
export const USER_AVATAR_COLORS = [
  "primary",
  "secondary",
  "blue",
  "indigo",
  "teal",
  "success",
  "orange",
  "danger",
  "fuchsia",
  "pink",
  "slate",
] as const;

export type UserAvatarColor = (typeof USER_AVATAR_COLORS)[number];

/** Prefix of a personal API token: `jnk_<43 base64url chars>` (TASK-36.1). */
export const API_TOKEN_PREFIX = "jnk_";

/** Longest accepted API-token name (mirrors the profile display-name bound). */
export const API_TOKEN_NAME_MAX = 50;

/** How far ahead an API token may expire. */
export const API_TOKEN_MAX_TTL_DAYS = 3650;

/** Display-name bound, shared by register/admin create/profile update. */
export const DISPLAY_NAME_MAX = 50;
