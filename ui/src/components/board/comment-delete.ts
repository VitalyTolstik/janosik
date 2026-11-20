import { userLabel } from "@/utils/avatar";

/** Longest plain-text preview shown before deleting a comment (TASK-177.17). */
export const DELETE_EXCERPT_LENGTH = 240;

// Grapheme-aware cuts keep ZWJ emoji and combined marks together; older
// runtimes without Intl.Segmenter fall back to code points, which still
// avoids splitting a surrogate pair.
const graphemeSegmenter =
  typeof Intl.Segmenter === "function"
    ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
    : null;

function excerptUnits(text: string): string[] {
  if (graphemeSegmenter === null) return Array.from(text);
  return Array.from(graphemeSegmenter.segment(text), (part) => part.segment);
}

/**
 * The comment body as a one-paragraph excerpt: markdown/line breaks collapse
 * to spaces so the confirmation stays scannable, and a long body is cut with
 * an ellipsis instead of turning the dialog into a wall of text.
 *
 * Truncation walks grapheme clusters when the runtime can segment them (and
 * code points otherwise), so a surrogate pair or a ZWJ emoji is never cut in
 * half at the boundary.
 */
export function commentExcerpt(text: string): string {
  const compact = text.replace(/\s+/g, " ").trim();
  const chars = excerptUnits(compact);
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
