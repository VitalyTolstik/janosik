/**
 * Avatar helpers (TASK-35) — kept out of the component file so the palette,
 * the initials rule and the label rule are testable without React and the
 * component module exports nothing but components (react-refresh).
 */

const AVATAR_COLORS = [
  "bg-primary",
  "bg-secondary",
  "bg-blue",
  "bg-indigo",
  "bg-teal",
  "bg-success",
  "bg-orange",
  "bg-danger",
  "bg-fuchsia",
  "bg-pink",
  "bg-slate",
] as const;

/** Stable color class for a user — derived from the id, no storage needed. */
export function userAvatarColor(userId: string): string {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = (hash * 31 + userId.charCodeAt(i)) | 0;
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
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
