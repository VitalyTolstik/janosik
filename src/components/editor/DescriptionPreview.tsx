import { memo, useEffect, useRef } from "react";
import { MDXEditor, type MDXEditorMethods } from "@mdxeditor/editor";

import { cn } from "@/lib/utils";
import {
  descriptionPreviewPlugins,
  editorTranslation,
  janosikIconFor,
} from "@/components/editor/plugins";

interface DescriptionPreviewProps {
  /** Markdown to render. */
  value: string;
  /** Compact three-line snippet on the card face (vs. full view in dialogs). */
  snippet?: boolean;
  className?: string;
}

/**
 * Read-only MDXEditor rendering of a card description.
 *
 * Used for the card-face snippet (`snippet`) — compact typography, clamped
 * to three lines with a soft fade, immune to oversized images/tables. The
 * plugin set mirrors the editor so any markdown the editor can produce also
 * renders here, and raw HTML stays inert (`suppressHtmlProcessing`).
 *
 * Memoized and ref-synced: card columns re-render on every drag/filter tick,
 * and a Lexical instance must not re-mount per keystroke — external value
 * changes (e.g. editing in the dialog behind the board) go through
 * `setMarkdown` instead.
 */
export const DescriptionPreview = memo(function DescriptionPreview({
  value,
  snippet = false,
  className,
}: DescriptionPreviewProps) {
  const editorRef = useRef<MDXEditorMethods>(null);
  const lastMarkdown = useRef(value);

  useEffect(() => {
    if (value !== lastMarkdown.current) {
      lastMarkdown.current = value;
      editorRef.current?.setMarkdown(value);
    }
  }, [value]);

  return (
    <MDXEditor
      ref={editorRef}
      className={cn(
        "janosik-mdx janosik-mdx-preview",
        snippet && "janosik-md-snippet",
        className,
      )}
      contentEditableClassName="janosik-md-content"
      markdown={value}
      readOnly
      suppressHtmlProcessing
      translation={editorTranslation}
      iconComponentFor={janosikIconFor}
      plugins={descriptionPreviewPlugins}
    />
  );
});
