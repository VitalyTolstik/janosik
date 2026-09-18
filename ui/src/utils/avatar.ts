/**
 * Avatar helpers (TASK-35, palette TASK-36.1) — kept out of the component
 * file so the palette, the initials rule and the label rule are testable
 * without React and the component module exports nothing but components
 * (react-refresh).
 *
 * A user either picks a palette color (persisted in `User.avatarColor`) or
 * gets the stable id-hash default; every avatar surface takes the picked
 * value as an optional second argument and falls back to the hash.
 */

import { USER_AVATAR_COLORS, type UserAvatarColor } from "@janosik/shared";

const AVATAR_CLASS: Record<UserAvatarColor, string> = {
  primary: "bg-primary",
  secondary: "bg-secondary",
  blue: "bg-blue",
  indigo: "bg-indigo",
  teal: "bg-teal",
  success: "bg-success",
  orange: "bg-orange",
  danger: "bg-danger",
  fuchsia: "bg-fuchsia",
  pink: "bg-pink",
  slate: "bg-slate",
};

/**
 * The same palette as CSS variables, for the surfaces a class cannot reach
 * (the foreign-change ring is painted with `box-shadow`/`color-mix` from an
 * inline style, because its color must animate and class-based colors cannot
 * be interpolated per user).
 */
const AVATAR_VAR: Record<UserAvatarColor, string> = {
  primary: "var(--primary)",
  secondary: "var(--secondary)",
  blue: "var(--blue)",
  indigo: "var(--indigo)",
  teal: "var(--teal)",
  success: "var(--success)",
  orange: "var(--orange)",
  danger: "var(--danger)",
  fuchsia: "var(--fuchsia)",
  pink: "var(--pink)",
  slate: "var(--slate)",
};

/** Palette order for pickers (the server validates against the same list). */
export const AVATAR_COLOR_KEYS = USER_AVATAR_COLORS;

/** Background class of a palette key — used by the profile color picker. */
export function avatarColorClass(color: UserAvatarColor): string {
  return AVATAR_CLASS[color];
}

/** Stable hash color of a user id — the default when no color was picked. */
export function avatarColorKey(userId: string): UserAvatarColor {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = (hash * 31 + userId.charCodeAt(i)) | 0;
  }
  return AVATAR_COLOR_KEYS[Math.abs(hash) % AVATAR_COLOR_KEYS.length];
}

/** Color class for a user: the picked key when present, else the hash. */
export function userAvatarColor(
  userId: string,
  color?: UserAvatarColor | null,
): string {
  return AVATAR_CLASS[color ?? avatarColorKey(userId)];
}

/**
 * The same color as a CSS color value (`var(--token)`) for inline styles —
 * attribution rings and row tints that have to match the avatar.
 */
export function userAvatarVar(
  userId: string,
  color?: UserAvatarColor | null,
): string {
  return AVATAR_VAR[color ?? avatarColorKey(userId)];
}

/**
 * Up to two initials from the display name (first letters of the first two
 * words); the first letter of the email is the fallback.
 */
export function userInitials(
  displayName: string | null | undefined,
  email: string,
): string {
  const words = (displayName ?? "").trim().split(/\s+/).filter(Boolean);
  if (words.length > 0) {
    return words
      .slice(0, 2)
      .map((word) => word[0])
      .join("")
      .toUpperCase();
  }
  const local = email.trim();
  return local ? local[0].toUpperCase() : "•";
}

/** What the tooltip (and the accessible name) shows for a member. */
export function userLabel(
  displayName: string | null | undefined,
  email: string,
): string {
  return (displayName ?? "").trim() || email;
}
