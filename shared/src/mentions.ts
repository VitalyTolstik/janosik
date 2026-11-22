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

const BARE_URL = /https?:\/\/[^\s<>"'`)\]]+/gi;
const ASCII_PUNCTUATION = /[!-/:-@[-`{-~]/;

/**
 * Replace a range with spaces while preserving its length. Every parser index
 * therefore stays valid on the original text.
 */
function maskRange(chars: string[], start: number, end: number): void {
  for (let index = start; index < end; index += 1) {
    if (chars[index] !== "\n") chars[index] = " ";
  }
}

/** HTML comments are not rendered and never carry recipients. */
function maskHtmlComments(chars: string[]): void {
  const text = chars.join("");
  for (const match of text.matchAll(/<!--[\s\S]*?-->/g)) {
    const start = match.index ?? 0;
    maskRange(chars, start, start + match[0].length);
  }
}

interface UnquotedLine {
  content: string;
  /** Number of blockquote containers stripped from the opening line. */
  depth: number;
}

/** Remove up to `limit` blockquote markers, preserving the rest verbatim. */
function removeQuoteMarkers(
  line: string,
  limit = Number.POSITIVE_INFINITY,
): UnquotedLine {
  let content = line;
  let depth = 0;
  while (depth < limit) {
    const match = /^ {0,3}> ?/.exec(content);
    if (match === null) break;
    content = content.slice(match[0].length);
    depth += 1;
  }
  return { content, depth };
}

/** Expand tabs to their visual 4-column stops before parsing indentation. */
function expandTabs(line: string): string {
  let output = "";
  let column = 0;
  for (const char of line) {
    if (char === "\t") {
      const width = 4 - (column % 4);
      output += " ".repeat(width);
      column += width;
    } else {
      output += char;
      column += 1;
    }
  }
  return output;
}

const LIST_MARKER_PREFIX = /^(?:[-+*]|\d+[.)])[ \t]+/;

/**
 * Fenced code opener on a line after blockquote/list prefixes. The editor
 * only emits fenced and inline code; indented text is deliberately plain
 * text and is never masked.
 */
function fenceOpener(line: string): { char: string; length: number } | null {
  const trimmed = line.trimStart().replace(LIST_MARKER_PREFIX, "").trimStart();
  const match = /^(`{3,}|~{3,})(.*)$/.exec(trimmed);
  if (match === null) return null;
  const run = match[1]!;
  // A backtick fence's info string may not contain a backtick.
  if (run[0] === "`" && match[2]!.includes("`")) return null;
  return { char: run[0]!, length: run.length };
}

function fenceCloser(line: string, char: string, length: number): boolean {
  const trimmed = line.trimStart();
  const match = /^(`{3,}|~{3,})\s*$/.exec(trimmed);
  return match !== null && match[1]![0] === char && match[1]!.length >= length;
}

/**
 * TASK-177.12 — the code-context contract is intentionally narrow: mention
 * tokens are ignored inside fenced code blocks (any container) and inline
 * code. Indented text/code is plain text by design, matching the editor,
 * which only emits fenced code blocks.
 */
function maskCodeBlocks(chars: string[]): void {
  const text = chars.join("");
  let offset = 0;
  let fenceChar: string | null = null;
  let fenceLength = 0;
  let fenceQuoteDepth = 0;
  while (offset < text.length) {
    const newline = text.indexOf("\n", offset);
    const end = newline === -1 ? text.length : newline + 1;
    const line = text.slice(offset, newline === -1 ? text.length : newline);
    const expanded = expandTabs(line);

    if (fenceChar !== null) {
      // Strip only the opening container's quote depth: a deeper quoted
      // fence line is code content, never a closer.
      const fenceLine = removeQuoteMarkers(expanded, fenceQuoteDepth).content;
      if (fenceCloser(fenceLine, fenceChar, fenceLength)) {
        maskRange(chars, offset, end);
        fenceChar = null;
        fenceLength = 0;
        fenceQuoteDepth = 0;
      } else {
        maskRange(chars, offset, end);
      }
      offset = end;
      continue;
    }

    const unquoted = removeQuoteMarkers(expanded);
    const opener = fenceOpener(unquoted.content);
    if (opener !== null) {
      fenceChar = opener.char;
      fenceLength = opener.length;
      fenceQuoteDepth = unquoted.depth;
      maskRange(chars, offset, end);
    }
    offset = end;
  }
}

/** Inline code spans (matching backtick runs) are inert as well. */
function maskInlineCode(chars: string[]): void {
  for (let index = 0; index < chars.length; index += 1) {
    if (chars[index] !== "`") continue;
    let run = 1;
    while (chars[index + run] === "`") run += 1;
    let cursor = index + run;
    let close = -1;
    while (cursor < chars.length) {
      if (chars[cursor] !== "`") {
        cursor += 1;
        continue;
      }
      let closingRun = 1;
      while (chars[cursor + closingRun] === "`") closingRun += 1;
      if (closingRun === run) {
        close = cursor + closingRun;
        break;
      }
      cursor += closingRun;
    }
    if (close === -1) {
      index += run - 1;
      continue;
    }
    maskRange(chars, index, close);
    index = close - 1;
  }
}

/** A backslash-escaped `[`/`@`/`(` starts literal text, not a link. */
function maskEscapes(chars: string[]): void {
  for (let index = 0; index < chars.length - 1; index += 1) {
    if (chars[index] !== "\\") continue;
    const next = chars[index + 1]!;
    if (ASCII_PUNCTUATION.test(next)) {
      maskRange(chars, index, index + 2);
      index += 1;
    }
  }
}

/**
 * A candidate is a real mention only when it is not part of a larger bare
 * URL. The token's own destination is the single allowed URL overlap, so
 * `https://evil.test/[@A](…)` and `…/mention/id?next=…` never gain a
 * recipient.
 */
function isUrlEmbeddedLookalike(
  text: string,
  index: number,
  length: number,
  destinationStart: number,
  destinationEnd: number,
): boolean {
  for (const url of text.matchAll(BARE_URL)) {
    const start = url.index ?? 0;
    const end = start + url[0].length;
    if (start >= index + length || end <= index) continue;
    if (start === destinationStart && end === destinationEnd) continue;
    return true;
  }
  return false;
}

interface MentionMatch {
  userId: string;
  label: string;
  index: number;
  length: number;
}

function mentionMatches(text: string): MentionMatch[] {
  const chars = text.split("");
  maskHtmlComments(chars);
  maskCodeBlocks(chars);
  maskInlineCode(chars);
  maskEscapes(chars);
  const masked = chars.join("");
  const matches: MentionMatch[] = [];
  for (const match of masked.matchAll(MENTION_TOKEN)) {
    const userId = match[2];
    if (userId === undefined) continue;
    const index = match.index ?? 0;
    const destinationStart = index + match[0].lastIndexOf(MENTION_URL_PREFIX);
    const destinationEnd = destinationStart + mentionHref(userId).length;
    if (
      isUrlEmbeddedLookalike(
        masked,
        index,
        match[0].length,
        destinationStart,
        destinationEnd,
      )
    ) {
      continue;
    }
    matches.push({
      userId,
      label: match[1] ?? "",
      index,
      length: match[0].length,
    });
  }
  return matches;
}

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

/**
 * True for every URL under the reserved mention prefix, including malformed
 * ids, queries, fragments and traversal. The UI uses this to swallow the whole
 * family before the browser can navigate, while only an exact id opens a
 * profile.
 */
export function isMentionHref(href: string | null | undefined): boolean {
  if (!href) return false;
  // Raw prefix, not normalised `URL.pathname`: `…/mention/../etc` must be
  // swallowed even though the URL parser would collapse the traversal.
  return /^https:\/\/janosik\.invalid\/mention(?:[/?#%\\]|$)/i.test(href);
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
  return mentionMatches(text);
}

/** Unique mentioned user ids in first-mention order. */
export function extractMentionUserIds(text: string): string[] {
  const ids = new Set<string>();
  for (const token of mentionMatches(text)) ids.add(token.userId);
  return [...ids];
}

/**
 * Markdown tokens replaced by their visible `@Label` for previews/excerpts.
 * Unlike parsing, this replaces every syntactic token — including one a code
 * sample or larger URL hides — so a non-MDX surface never leaks the reserved
 * URL.
 */
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
