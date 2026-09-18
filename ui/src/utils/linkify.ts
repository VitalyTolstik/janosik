/** A piece of a plain-text comment: either literal text or a URL to link. */
export interface TextSegment {
  type: "text" | "link";
  value: string;
}

/** `http(s)://…` runs up to whitespace or a wrapper character. */
const URL_PATTERN = /https?:\/\/[^\s<>"'()[\]]+/g;

/** Punctuation that commonly ends a sentence right after a pasted link. */
const TRAILING = /[.,!?;:]+$/;

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
