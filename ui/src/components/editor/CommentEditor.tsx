import "@mdxeditor/editor/style.css";

import { MDXEditor } from "@mdxeditor/editor";

import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n";
import { sanitizeMarkdownForImport } from "@/utils/sanitizeMarkdown";
import { autolinkMarkdown } from "@/utils/linkify";
import { emojify } from "@/utils/emoji";
import {
  commentEditorPlugins,
  descriptionViewerPlugins,
  editorTranslation,
  janosikIconFor,
} from "@/components/editor/plugins";

interface CommentComposerEditorProps {
  /** The draft markdown — read once per mount (the parent remounts to reset). */
  value: string;
  onChange: (markdown: string) => void;
  /** Ctrl/Cmd+Enter submit — Enter inserts a newline, like the description. */
  onSubmit: () => void;
  placeholder?: string;
}

/**
 * The WYSIWYG markdown editor for writing card comments (TASK-37): the
 * description's MDXEditor in a compact footprint — same chrome, same
 * tokens, a smaller toolbar. The wrapper div owns the submit shortcut so
 * Lexical never sees (and never swallows) the keystroke.
 */
export function CommentComposerEditor({
  value,
  onChange,
  onSubmit,
  placeholder,
}: CommentComposerEditorProps) {
  const { lang } = useI18n();

  return (
    <div
      data-testid="comment-input"
      onKeyDown={(event) => {
        if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
          event.preventDefault();
          event.stopPropagation();
          onSubmit();
        }
      }}
    >
      <MDXEditor
        // Re-key on language change so toolbar tooltips/labels re-resolve.
        key={lang}
        className="janosik-mdx janosik-mdx-edit"
        contentEditableClassName="janosik-md-content janosik-md-compact"
        markdown={sanitizeMarkdownForImport(value)}
        onChange={(markdown, initialNormalize) => {
          if (!initialNormalize) {
            onChange(markdown);
          }
        }}
        placeholder={placeholder}
        suppressHtmlProcessing
        translation={editorTranslation}
        iconComponentFor={janosikIconFor}
        plugins={commentEditorPlugins}
      />
    </div>
  );
}

/**
 * A rendered comment body: the description's read-only markdown surface in
 * a flush variant (no min-height, no padding — the row provides rhythm).
 * Bare URLs are wrapped into links first so legacy plain-text comments
 * keep their clickability; shortcodes and ASCII emoticons render as emoji.
 */
export function CommentBody({
  text,
  className,
}: {
  text: string;
  className?: string;
}) {
  const { lang } = useI18n();

  return (
    <MDXEditor
      key={lang}
      className={cn("janosik-mdx janosik-mdx-readonly", className)}
      contentEditableClassName="janosik-md-content janosik-md-flush"
      markdown={emojify(autolinkMarkdown(sanitizeMarkdownForImport(text)))}
      readOnly
      suppressHtmlProcessing
      translation={editorTranslation}
      iconComponentFor={janosikIconFor}
      plugins={descriptionViewerPlugins}
    />
  );
}
