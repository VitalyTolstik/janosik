/**
 * TASK-177.12 — explicit comment mentions.
 *
 * A mention is a markdown link whose URL is the stable, reserved
 * `https://janosik.invalid/mention/<userId>` address and whose label is the
 * member's display name. The link carries the user id, so a mentioned member
 * is selected unambiguously — typing `@name` by hand never creates a mention.
 * The backend resolves the ids at write time and rejects anyone who is not an
 * active board member; the reader never has to guess which `@Alice` the
 * author meant.
 *
 * The token is ordinary markdown, so the existing MDXEditor viewers render it
 * as a link (`@Alice`) and the server stores no parallel body format. The
 * `.invalid` TLD is reserved by RFC 2606, so a click that escapes the app's
 * handler can never reach a real host.
 */

/** Reserved address prefix carried by every mention link. */
export const MENTION_URL_PREFIX = "https://janosik.invalid/mention/";

/** Longest display label a token may carry (board names are bounded too). */
const MAX_LABEL = 120;
/** Cuid/legacy ids are short; the cap keeps a hostile token inert. */
const MAX_USER_ID = 128;

const MENTION_TOKEN = new RegExp(
  `\\[@([^\\]\\n]{1,${MAX_LABEL}})\\]\\(${MENTION_URL_PREFIX.replace(
    /[.*+?^${}()|[\]\\]/g,
    "\\$&",
  )}([A-Za-z0-9_-]{1,${MAX_USER_ID}})\\)`,
  "g",
);

/** One parsed mention token, in source order. */
export interface CommentMentionToken {
  /** Mentioned user id carried by the link. */
  userId: string;
  /** Visible label without the leading `@`. */
  label: string;
  /** Start offset of the whole token in the source text. */
  index: number;
  /** Length of the whole token in the source text. */
  length: number;
}

/**
 * Remove characters that would break the markdown link label or turn a
 * display name into markup. The label is intentionally human-readable, not a
 * second identity — the id in the URL is authoritative.
 */
export function sanitizeMentionLabel(name: string): string {
  return (
    name
      // eslint-disable-next-line no-control-regex -- stripping control chars is the point
      .replace(/[\u0000-\u001f\u007f]/g, " ")
      .replace(/[[\]\\<>`]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, MAX_LABEL)
  );
}

/** `@Name` → `[@Name](https://janosik.invalid/mention/user-id)`. */
export function mentionMarkdown(name: string, userId: string): string {
  const label = sanitizeMentionLabel(name) || "member";
  return `[@${label}](${mentionHref(userId)})`;
}

/** The anchor target of one mention. */
export function mentionHref(userId: string): string {
  return `${MENTION_URL_PREFIX}${userId}`;
}

/** Parse a mention anchor href; anything else (including lookalikes) is null. */
export function mentionIdFromHref(
  href: string | null | undefined,
): string | null {
  if (!href) return null;
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  if (url.origin !== "https://janosik.invalid") return null;
  if (url.search !== "" || url.hash !== "") return null;
  const match = new RegExp(`^/mention/([A-Za-z0-9_-]{1,${MAX_USER_ID}})$`).exec(
    url.pathname,
  );
  return match?.[1] ?? null;
}

/** Every well-formed mention token in source order. */
export function parseCommentMentions(text: string): CommentMentionToken[] {
  const tokens: CommentMentionToken[] = [];
  for (const match of text.matchAll(MENTION_TOKEN)) {
    const userId = match[2];
    if (userId === undefined) continue;
    tokens.push({
      userId,
      label: match[1] ?? "",
      index: match.index ?? 0,
      length: match[0].length,
    });
  }
  return tokens;
}

/** Unique mentioned user ids in first-mention order. */
export function extractMentionUserIds(text: string): string[] {
  const ids = new Set<string>();
  for (const token of parseCommentMentions(text)) ids.add(token.userId);
  return [...ids];
}

/** Markdown tokens replaced by their visible `@Label` for previews/excerpts. */
export function stripMentionMarkup(text: string): string {
  return text.replace(MENTION_TOKEN, (_match, label: string) => `@${label}`);
}

const MARKDOWN_IMAGE = /!\[([^\]]*)\]\([^)]*\)/g;
const MARKDOWN_LINK = /\[([^\]]*)\]\([^)]*\)/g;
const HTML_TAG = /<[^>]*>/g;

/**
 * A short, plain-text excerpt for an attention row or letter. Mentions keep
 * their visible `@Name`, links keep their label, and markup/HTML is removed
 * so a notification body never renders a board's raw markup.
 */
export function commentPlainExcerpt(text: string, limit = 160): string {
  const plain = stripMentionMarkup(text)
    .replace(MARKDOWN_IMAGE, "$1")
    .replace(MARKDOWN_LINK, "$1")
    .replace(HTML_TAG, " ")
    .replace(/[`*_~>#]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const chars = [...plain];
  if (chars.length <= limit) return plain;
  return `${chars
    .slice(0, Math.max(0, limit - 1))
    .join("")
    .trimEnd()}…`;
}
