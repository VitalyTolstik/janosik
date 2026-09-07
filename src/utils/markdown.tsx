import ReactMarkdown, { type Components } from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";

import { cn } from "@/lib/utils";

/**
 * Markdown renderer for card descriptions.
 *
 * - `react-markdown` is safe by default: raw HTML from the text is NOT
 *   executed (`skipHtml`), the output is React elements (no
 *   `dangerouslySetInnerHTML`), and `javascript:`/`vbscript:` URLs are
 *   filtered by its default `urlTransform`. This holds for text coming from
 *   JSON import / paste — the only external inputs.
 * - `remark-gfm` adds GitHub-Flavored features: tables, task lists
 *   (`- [x]`), strikethrough (`~text~`) and autolinks.
 * - Blocks are styled with design tokens via Tailwind classes — no hardcoded
 *   colors (ROADMAP §8).
 *
 * Usage: render the whole description in the dialog;
 * `<MarkdownView preview>` truncates to ~2 lines for the card snippet.
 */
interface MarkdownViewProps {
  children: string;
  /** Compact inline styles + line-clamp for the card preview. */
  preview?: boolean;
  className?: string;
}

const mdComponents: Components = {
  h1: ({ children }) => (
    <h1 className="mb-1.5 mt-3.5 text-xl font-bold leading-tight text-foreground first:mt-0">
      {children}
    </h1>
  ),
  h2: ({ children }) => (
    <h2 className="mb-1.5 mt-3 text-lg font-bold leading-tight text-foreground first:mt-0">
      {children}
    </h2>
  ),
  h3: ({ children }) => (
    <h3 className="mb-1 mt-2.5 text-base font-bold leading-snug text-foreground first:mt-0">
      {children}
    </h3>
  ),
  h4: ({ children }) => (
    <h4 className="mb-1 mt-2 text-sm font-semibold leading-snug text-foreground first:mt-0">
      {children}
    </h4>
  ),
  h5: ({ children }) => (
    <h5 className="mb-1 mt-2 text-[13px] font-semibold leading-snug text-foreground first:mt-0">
      {children}
    </h5>
  ),
  h6: ({ children }) => (
    <h6 className="mb-1 mt-2 text-xs font-semibold leading-snug text-foreground first:mt-0">
      {children}
    </h6>
  ),
  p: ({ children }) => (
    <p className="my-1.5 text-sm leading-relaxed text-foreground/90 first:mt-0 last:mb-0">
      {children}
    </p>
  ),
  ul: ({ children }) => (
    <ul className="my-1.5 list-disc space-y-0.5 pl-5 first:mt-0 last:mb-0">
      {children}
    </ul>
  ),
  ol: ({ children }) => (
    <ol className="my-1.5 list-decimal space-y-0.5 pl-5 first:mt-0 last:mb-0">
      {children}
    </ol>
  ),
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
  a: ({ children, href }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-primary underline decoration-primary/30 underline-offset-2 hover:decoration-primary"
    >
      {children}
    </a>
  ),
  img: ({ src, alt }) => (
    <img
      src={src}
      alt={alt ?? ""}
      loading="lazy"
      className="my-2 block max-h-64 max-w-full rounded-lg border border-border/50 object-contain first:mt-0 last:mb-0"
    />
  ),
  code: ({ children }) => (
    <code className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-[0.85em] text-foreground">
      {children}
    </code>
  ),
  pre: ({ children }) => (
    <pre className="my-2 overflow-x-auto rounded-lg bg-muted p-3 text-xs leading-relaxed first:mt-0 last:mb-0 [&_code]:bg-transparent [&_code]:p-0 [&_code]:text-[0.95em]">
      {children}
    </pre>
  ),
  blockquote: ({ children }) => (
    <blockquote className="my-2 border-l-2 border-border pl-3 text-muted-foreground first:mt-0 last:mb-0">
      {children}
    </blockquote>
  ),
  hr: () => <hr className="my-3 border-border" />,
  table: ({ children }) => (
    <div className="my-2 overflow-x-auto first:mt-0 last:mb-0">
      <table className="w-full border-collapse text-xs">{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th className="border border-border bg-muted/60 px-2 py-1 text-left font-semibold text-foreground">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="border border-border px-2 py-1 text-muted-foreground">
      {children}
    </td>
  ),
  del: ({ children }) => (
    <del className="text-muted-foreground/70">{children}</del>
  ),
  input: ({ checked }) => (
    <input
      type="checkbox"
      checked={Boolean(checked)}
      readOnly
      tabIndex={-1}
      className="mr-1.5 size-3.5 translate-y-0.5 accent-primary"
    />
  ),
};

export function MarkdownView({
  children,
  preview = false,
  className,
}: MarkdownViewProps) {
  return (
    <div
      className={cn(
        // Base prose-ish typography; tokens only (no hardcoded colors).
        "min-w-0 text-left",
        preview && "line-clamp-3 overflow-hidden",
        className,
      )}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkBreaks]}
        components={{
          ...mdComponents,
          // In preview mode blocks stay blocks (so the snippet reads like
          // Markdown: margins + a visible heading ladder), but compact —
          // small sizes, tight spacing — and clipped by line-clamp-3 on
          // the root. Images collapse to a placeholder so a big picture
          // can't blow up the two-line snippet.
          ...(preview
            ? {
                p: ({ children }) => (
                  <p className="my-1 text-xs leading-relaxed text-muted-foreground/90 first:mt-0 last:mb-0">
                    {children}
                  </p>
                ),
                ul: ({ children }) => (
                  <ul className="my-1 list-disc space-y-0 pl-4 text-xs text-muted-foreground/90 first:mt-0 last:mb-0">
                    {children}
                  </ul>
                ),
                ol: ({ children }) => (
                  <ol className="my-1 list-decimal space-y-0 pl-4 text-xs text-muted-foreground/90 first:mt-0 last:mb-0">
                    {children}
                  </ol>
                ),
                h1: ({ children }) => (
                  <h1 className="mb-0.5 mt-1.5 text-sm font-bold leading-snug text-foreground/90 first:mt-0">
                    {children}
                  </h1>
                ),
                h2: ({ children }) => (
                  <h2 className="mb-0.5 mt-1.5 text-[13px] font-bold leading-snug text-foreground/90 first:mt-0">
                    {children}
                  </h2>
                ),
                h3: ({ children }) => (
                  <h3 className="mb-0.5 mt-1 text-xs font-bold leading-snug text-foreground/90 first:mt-0">
                    {children}
                  </h3>
                ),
                h4: ({ children }) => (
                  <h4 className="mb-0.5 mt-1 text-[11px] font-semibold leading-snug text-foreground/90 first:mt-0">
                    {children}
                  </h4>
                ),
                h5: ({ children }) => (
                  <h5 className="mb-0.5 mt-1 text-[11px] font-semibold leading-snug text-foreground/90 first:mt-0">
                    {children}
                  </h5>
                ),
                h6: ({ children }) => (
                  <h6 className="mb-0.5 mt-1 text-[11px] font-semibold leading-snug text-foreground/90 first:mt-0">
                    {children}
                  </h6>
                ),
                img: ({ alt }) => (
                  <span className="my-1 block italic text-muted-foreground/90">
                    {alt ? `🖼 ${alt}` : "🖼 image"}
                  </span>
                ),
                pre: ({ children }) => (
                  <pre className="my-1 overflow-x-auto rounded bg-muted p-1.5 text-[11px] leading-relaxed first:mt-0 last:mb-0">
                    {children}
                  </pre>
                ),
              }
            : {}),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
