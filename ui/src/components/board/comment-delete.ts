import { userLabel } from "@/utils/avatar";

/** Longest plain-text preview shown before deleting a comment (TASK-177.17). */
export const DELETE_EXCERPT_LENGTH = 240;

/**
 * The comment body as a one-paragraph excerpt: markdown/line breaks collapse
 * to spaces so the confirmation stays scannable, and a long body is cut with
 * an ellipsis instead of turning the dialog into a wall of text.
 *
 * Truncation walks code points, not UTF-16 units: a naive `slice` can cut an
 * emoji in half and render a replacement glyph at the boundary.
 */
export function commentExcerpt(text: string): string {
  const compact = text.replace(/\s+/g, " ").trim();
  const chars = Array.from(compact);
  if (chars.length <= DELETE_EXCERPT_LENGTH) return compact;
  return `${chars
    .slice(0, DELETE_EXCERPT_LENGTH - 1)
    .join("")
    .trimEnd()}…`;
}

interface AuthorSource {
  displayName?: string | null;
  email?: string | null;
}

/**
 * The author line's name, in priority order: the board member's chosen name,
 * their email, the raw author id (a deleted or unloaded profile still names
 * *someone*), and finally the localized unknown-author copy.
 */
export function commentAuthorLabel(
  authorId: string,
  member: AuthorSource | undefined,
  currentUser: (AuthorSource & { id: string }) | null | undefined,
  unknownAuthor: string,
): string {
  // Only the author can delete their own comment, so the current user is a
  // safe fallback while the board directory is still loading.
  const source =
    member ?? (currentUser?.id === authorId ? currentUser : undefined);
  return (
    userLabel(source?.displayName ?? null, source?.email ?? "") ||
    authorId ||
    unknownAuthor
  );
}
