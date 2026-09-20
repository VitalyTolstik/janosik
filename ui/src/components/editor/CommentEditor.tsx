import "@mdxeditor/editor/style.css";

import {
  forwardRef,
  useImperativeHandle,
  useRef,
  type ClipboardEvent as ReactClipboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { MDXEditor, type MDXEditorMethods } from "@mdxeditor/editor";

import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n";
import { useToast } from "@/components/Toast";
import { api, ApiError } from "@/api/client";
import { sanitizeMarkdownForImport } from "@/utils/sanitizeMarkdown";
import { autolinkMarkdown } from "@/utils/linkify";
import { emojify } from "@/utils/emoji";
import {
  embedMarkdown,
  handleAttachmentLinkClick,
} from "@/utils/embedAttachments";
import { LIMITS } from "@janosik/shared";
import {
  commentEditorPlugins,
  descriptionViewerPlugins,
  editorTranslation,
  janosikIconFor,
} from "@/components/editor/plugins";

/** Imperative editor surface exposed to the comment composer. */
export interface CommentComposerEditorHandle {
  /** Insert markdown at the current cursor position. */
  insertMarkdown: (markdown: string) => void;
}

interface CommentComposerEditorProps {
  cardId: string;
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
 *
 * Pasted files upload as INLINE attachments (hidden from the card's
 * attachment list) and embed into the draft at the cursor — an image
 * renders as an image, any other file as a download link, exactly like
 * the description, so mixed text/media structure survives the round-trip.
 */
export const CommentComposerEditor = forwardRef<
  CommentComposerEditorHandle,
  CommentComposerEditorProps
>(function CommentComposerEditor(
  { cardId, value, onChange, onSubmit, placeholder },
  ref,
) {
  const { lang, t } = useI18n();
  const toast = useToast();
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

  // Capture phase: the editor's own paste handlers must not see the files.
  const onPasteCapture = (event: ReactClipboardEvent) => {
    const files = Array.from(event.clipboardData?.files ?? []);
    if (files.length === 0) return;
    event.preventDefault();
    event.stopPropagation();
    void (async () => {
      for (const file of files) {
        try {
          const attachment = await api.uploadAttachment(cardId, file, {
            inline: true,
          });
          methodsRef.current?.insertMarkdown(
            embedMarkdown(file, attachment.id),
          );
        } catch (error) {
          if (error instanceof ApiError && error.status === 413) {
            toast.error(
              t("card.attachments.tooLarge", {
                max: LIMITS.attachmentSize / 1024 / 1024,
              }),
            );
          } else if (error instanceof ApiError && error.status === 0) {
            toast.error(t("card.attachments.pasteOffline"));
            return;
          } else {
            toast.error(t("card.attachments.uploadError"));
          }
        }
      }
    })();
  };

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
      onPasteCapture={onPasteCapture}
      onClickCapture={(event: ReactMouseEvent) =>
        handleAttachmentLinkClick(event)
      }
    >
      <MDXEditor
        ref={methodsRef}
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
});

/**
 * A rendered comment body: the description's read-only markdown surface in
 * a flush variant (no min-height, no padding — the row provides rhythm).
 * Bare URLs are wrapped into links first so legacy plain-text comments
 * keep their clickability; shortcodes and ASCII emoticons render as emoji.
 * Body-embedded attachment links open through the authenticated client.
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
    <div onClickCapture={(event) => handleAttachmentLinkClick(event)}>
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
    </div>
  );
}
