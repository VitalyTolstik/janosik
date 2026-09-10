/**
 * Strips raw HTML (tags + comments) from markdown before it is handed to
 * MDXEditor.
 *
 * Why: with `suppressHtmlProcessing` MDXEditor does not run generic HTML,
 * but the image plugin still visits every HTML node that starts with
 * `<img` and pipes its raw source through `wrapper.innerHTML = ...`
 * (MdastImageVisitor) — a confirmed XSS sink: markdown like
 * `<img src=x onerror="...">` executes even with HTML processing
 * suppressed. Other raw HTML (e.g. `<b>`, `<script>`) has no import
 * visitor at all and makes the whole import fail with an error.
 *
 * The security property enforced (and differentially tested against the
 * real remark parser in the unit tests): the sanitized markdown must not
 * contain a single `html` node anywhere in the AST. Fenced code blocks
 * are exempt — remark treats their content as inert text, so HTML there
 * is preserved verbatim. That exemption is the dangerous part (a backtick
 * fence whose info string contains a backtick is NOT a fence for remark,
 * and "protecting" it would shield real HTML), so the fence tracker
 * mirrors CommonMark exactly. Inline code spans are NOT protected:
 * micromark's backtick-run pairing has too many edge cases to mirror
 * faithfully, and a wrong "this is code" decision would shield live HTML.
 * Worst case there: brackets of an HTML sample inside inline code are
 * stripped — a cosmetic loss traded for a fail-safe design.
 */
const TAG = /<!--[\s\S]*?-->|<\/?[a-zA-Z][^>]*>/g;

/** Tags that are dangerous even inside an unterminated construction;
 * applied document-wide as a safety net. */
const DANGEROUS_HTML =
  /<!--[\s\S]*?-->|<(?:script|style|iframe|object|embed|img|svg|math|base|form|frame|frameset|applet|audio|video|source|track|link|meta|title|body|head|html|textarea|select|button|input)\b[\s\S]*?>/gi;

const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const FENCE_CLOSE = /^ {0,3}(`{3,}|~{3,})\s*$/;

function stripHtmlSegments(line: string): string {
  return line.replace(TAG, "");
}

export function sanitizeMarkdownForImport(markdown: string): string {
  // NUL bytes could forge protection placeholders below.
  let current = markdown.replace(/\u0000/g, "");

  // Strip to a fixpoint: removing tags can change backtick-run adjacency
  // (e.g. "````<b>`<img>`" — the 4-run and 1-run merge into a 5-run once
  // "<b>" is gone, unpairing the code span that used to shield the img),
  // so a single pass can leave HTML that a re-parse would expose.
  // Each pass only ever removes characters, so this terminates.
  for (let i = 0; i < 16; i++) {
    const next = sanitizePass(current);
    if (next === current) break;
    current = next;
  }
  return current;
}

function sanitizePass(markdown: string): string {
  const protectedSpans: string[] = [];
  const protect = (value: string) => {
    protectedSpans.push(value);
    return `\u0000${protectedSpans.length - 1}\u0000`;
  };

  const processedLines: string[] = [];
  let fenceChar: "`" | "~" | null = null;
  let fenceLength = 0;

  for (const line of markdown.split("\n")) {
    const fence = line.match(FENCE);
    if (fenceChar !== null) {
      const closer = line.match(FENCE_CLOSE);
      if (closer && closer[1][0] === fenceChar && closer[1].length >= fenceLength) {
        fenceChar = null;
        fenceLength = 0;
      }
      processedLines.push(protect(line));
    } else if (
      fence &&
      // CommonMark: the info string of a backtick fence may not contain a
      // backtick — such a line is a paragraph for remark, and "protecting"
      // it would shield real HTML on the following lines.
      (fence[1][0] === "~" || !line.slice(fence[1].length).includes("`"))
    ) {
      fenceChar = fence[1][0] as "`" | "~";
      fenceLength = fence[1].length;
      processedLines.push(protect(line));
    } else {
      processedLines.push(stripHtmlSegments(line));
    }
  }

  // Safety net: a tag split across lines escaped the per-line pass, so run
  // one bounded pass over the whole document (placeholders keep protected
  // segments out of its way).
  const stripped = processedLines.join("\n").replace(DANGEROUS_HTML, "");

  return stripped.replace(/\u0000(\d+)\u0000/g, (_, i) => protectedSpans[Number(i)] ?? "");
}
