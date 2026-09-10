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
 * Stripping HTML keeps foreign markup from ever reaching those code paths
 * while normal markdown passes through untouched.
 *
 * Fenced code blocks and inline code spans are protected from stripping —
 * remark treats their content as code, so HTML there is inert text.
 * Indented (4-space) code blocks are not tracked: remark parses their
 * HTML as code too, so there is no XSS — worst case the brackets of such
 * a line are stripped, a cosmetic edge case we accept.
 */
const DANGEROUS_HTML =
  /<!--[\s\S]*?-->|<(?:script|style|iframe|object|embed|img|svg|math|base|form|frame|frameset|applet|audio|video|source|track|link|meta|title|body|head|html|textarea|select|button|input)\b[\s\S]*?>/gi;

export function sanitizeMarkdownForImport(markdown: string): string {
  const protectedSpans: string[] = [];
  const protect = (value: string) => {
    protectedSpans.push(value);
    return `\u0000${protectedSpans.length - 1}\u0000`;
  };

  const processedLines: string[] = [];
  let fenceChar: "`" | "~" | null = null;
  let fenceLength = 0;

  for (const line of markdown.split("\n")) {
    const fence = line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (fenceChar !== null) {
      const closer = line.match(/^ {0,3}(`{3,}|~{3,})\s*$/);
      if (closer && closer[1][0] === fenceChar && closer[1].length >= fenceLength) {
        fenceChar = null;
        fenceLength = 0;
      }
      processedLines.push(protect(line));
    } else if (fence) {
      fenceChar = fence[1][0] as "`" | "~";
      fenceLength = fence[1].length;
      processedLines.push(protect(line));
    } else {
      processedLines.push(
        line
          .replace(/`[^`\n]*`/g, (span) => protect(span))
          .replace(/<!--.*?-->|<\/?[a-zA-Z][^>]*>/g, ""),
      );
    }
  }

  // Safety net: a tag split across lines escaped the per-line pass, so run
  // one bounded pass over the whole document (placeholders keep code spans
  // and fences out of its way).
  const stripped = processedLines
    .join("\n")
    .replace(DANGEROUS_HTML, "");

  return stripped.replace(/\u0000(\d+)\u0000/g, (_, i) => protectedSpans[Number(i)] ?? "");
}
