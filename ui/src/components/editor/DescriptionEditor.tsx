import "@mdxeditor/editor/style.css";

import {
  forwardRef,
  useImperativeHandle,
  useRef,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { MDXEditor, type MDXEditorMethods } from "@mdxeditor/editor";

import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n";
import { sanitizeMarkdownForImport } from "@/utils/sanitizeMarkdown";
import { emojify } from "@/utils/emoji";
import { handleAttachmentLinkClick } from "@/utils/embedAttachments";
import {
  descriptionEditorPlugins,
  descriptionViewerPlugins,
  editorTranslation,
  janosikIconFor,
} from "@/components/editor/plugins";

/** Imperative editor surface exposed to the card dialog (paste embedding). */
export interface DescriptionEditorHandle {
  /** Insert markdown at the current cursor position. */
  insertMarkdown: (markdown: string) => void;
}

interface DescriptionEditorProps {
  /** Current markdown — treated as the initial value (like a defaultValue). */
  value: string;
  /** Fired on every edit; `updateCard` handles persistence/debounce. */
  onChange: (markdown: string) => void;
  /** Shown when the description is empty. */
  placeholder?: string;
  /** VIEWER mode (TASK-35): rendered content, no toolbar, no edits. */
  readOnly?: boolean;
  className?: string;
}

/**
 * WYSIWYG markdown editor for the card description (MDXEditor).
 *
 * The dialog remounts the editor for every card (`key={cardId}` upstream),
 * so the `value` prop is read once on mount — afterwards the editor owns its
 * state and streams changes up through `onChange`. Normalization-only
 * emissions (whitespace/bullet char fixes on mount) are dropped so that
 * merely opening a card doesn't dirty `updatedAt`. Incoming markdown is
 * stripped of raw HTML first (see `sanitizeMarkdownForImport`) — the image
 * plugin's HTML visitor has an `innerHTML` sink that `suppressHtmlProcessing`
 * does not cover.
 *
 * The wrapper div owns two delegated concerns: pasted-file embedding is
 * handled by the dialog (capture phase above this component), and clicks on
 * body-embedded attachment links are rerouted through the authenticated API
 * client here (capture phase below the dialog's handlers).
 *
 * Theming, typography and the lucide icon set live in index.css under the
 * `janosik-mdx` class; both themes come from the design tokens automatically.
 */
export const DescriptionEditor = forwardRef<
  DescriptionEditorHandle,
  DescriptionEditorProps
>(function DescriptionEditor(
  { value, onChange, placeholder, readOnly = false, className },
  ref,
) {
  const { lang } = useI18n();
  const methodsRef = useRef<MDXEditorMethods | null>(null);

  useImperativeHandle(
    ref,
    () => ({
      insertMarkdown: (markdown: string) => {
        methodsRef.current?.insertMarkdown(markdown);
      },
    }),
    [],
  );

  // Capture phase: attachment links must be intercepted before Lexical's
  // own click handling (link toolbar in edit mode) sees them.
  const onLinkClickCapture = (event: ReactMouseEvent) => {
    handleAttachmentLinkClick(event);
  };

  return (
    <div onClickCapture={onLinkClickCapture}>
      <MDXEditor
        ref={methodsRef}
        // Re-key on language change so toolbar tooltips/labels re-resolve.
        key={lang}
        className={cn(
          "janosik-mdx",
          readOnly ? "janosik-mdx-readonly" : "janosik-mdx-edit",
          className,
        )}
        contentEditableClassName="janosik-md-content"
        readOnly={readOnly}
        markdown={
          readOnly
            ? emojify(sanitizeMarkdownForImport(value))
            : sanitizeMarkdownForImport(value)
        }
        onChange={(markdown, initialNormalize) => {
          if (!readOnly && !initialNormalize) {
            onChange(markdown);
          }
        }}
        placeholder={placeholder}
        suppressHtmlProcessing
        translation={editorTranslation}
        iconComponentFor={janosikIconFor}
        plugins={readOnly ? descriptionViewerPlugins : descriptionEditorPlugins}
      />
    </div>
  );
});
