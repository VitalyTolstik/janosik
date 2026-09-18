/** A piece of a plain-text comment: either literal text or a URL to link. */
export interface TextSegment {
  type: "text" | "link";
  value: string;
}

/** `http(s)://…` runs up to whitespace or a wrapper character. */
const URL_PATTERN = /https?:\/\/[^\s<>"'()[\]]+/g;

/** Punctuation that commonly ends a sentence right after a pasted link. */
const TRAILING = /[.,!?;:]+$/;

/** `[text](url)` runs — markdown links that must not be re-linked. */
const MD_LINK_PATTERN = /\[[^\]]*\]\([^)]*\)/g;

/**
 * Wrap bare `http(s)://…` URLs in markdown links so legacy plain-text
 * comments stay clickable inside the markdown viewer (TASK-37). Existing
 * `[text](url)` runs are left untouched, and trailing sentence punctuation
 * stays outside the link, exactly like `splitLinks`.
 */
export function autolinkMarkdown(markdown: string): string {
  if (!/https?:\/\//.test(markdown)) return markdown;
  const pieces: Array<{ chunk: string; link: boolean }> = [];
  let cursor = 0;
  for (const match of markdown.matchAll(MD_LINK_PATTERN)) {
    const start = match.index ?? 0;
    if (start > cursor) {
      pieces.push({ chunk: markdown.slice(cursor, start), link: false });
    }
    pieces.push({ chunk: match[0], link: true });
    cursor = start + match[0].length;
  }
  if (cursor < markdown.length) {
    pieces.push({ chunk: markdown.slice(cursor), link: false });
  }
  return pieces
    .map(({ chunk, link }) =>
      link || !/https?:\/\//.test(chunk)
        ? chunk
        : chunk.replace(URL_PATTERN, (url) => {
            const trailing = TRAILING.exec(url)?.[0] ?? "";
            const bare = url.slice(0, url.length - trailing.length);
            return bare === "" ? url : `[${bare}](${bare})${trailing}`;
          }),
    )
    .join("");
}

/**
 * Split comment text into text and link segments (TASK-37): comments are
 * plain text by spec, but a pasted URL should still be clickable. Trailing
 * sentence punctuation stays outside the link so "see https://a.b." does
 * not produce a URL ending in a dot.
 */
export function splitLinks(text: string): TextSegment[] {
  const segments: TextSegment[] = [];
  let cursor = 0;
  for (const match of text.matchAll(URL_PATTERN)) {
    const start = match.index ?? 0;
    let url = match[0];
    const trailing = TRAILING.exec(url)?.[0] ?? "";
    url = url.slice(0, url.length - trailing.length);
    if (url === "") continue;
    if (start > cursor) {
      segments.push({ type: "text", value: text.slice(cursor, start) });
    }
    segments.push({ type: "link", value: url });
    cursor = start + url.length;
  }
  if (cursor < text.length) {
    segments.push({ type: "text", value: text.slice(cursor) });
  }
  return segments;
}
