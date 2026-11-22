import "@mdxeditor/editor/style.css";

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type ClipboardEvent as ReactClipboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { MDXEditor, type MDXEditorMethods } from "@mdxeditor/editor";

import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n";
import { useToast } from "@/components/Toast";
import { api, ApiError } from "@/api/client";
import { MentionPicker } from "@/components/board/MentionPicker";
import { useOpenProfile } from "@/components/board/UserProfileDialog";
import { useBoardMembersList } from "@/store/board-live";
import { sanitizeMarkdownForImport } from "@/utils/sanitizeMarkdown";
import { autolinkMarkdown } from "@/utils/linkify";
import { emojify } from "@/utils/emoji";
import { mentionMemberLabel } from "@/utils/mentions";
import {
  embedMarkdown,
  handleAttachmentImageOpen,
  handleAttachmentLinkClick,
} from "@/utils/embedAttachments";
import {
  LIMITS,
  mentionIdFromHref,
  mentionMarkdown,
  type BoardMemberDto,
} from "@janosik/shared";
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
  /** Board roster used by the `@` picker (TASK-177.12). */
  boardId: string;
  /** The draft markdown — read once per mount (the parent remounts to reset). */
  value: string;
  onChange: (markdown: string) => void;
  /** Ctrl/Cmd+Enter submit — Enter inserts a newline, like the description. */
  onSubmit: () => void;
  /** Escape cancels (inline comment editing, TASK-176.2). */
  onCancel?: () => void;
  /** Focus the editable surface on mount (inline edit opens ready to type). */
  autoFocus?: boolean;
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
  {
    cardId,
    boardId,
    value,
    onChange,
    onSubmit,
    onCancel,
    autoFocus,
    placeholder,
  },
  ref,
) {
  const { lang, t } = useI18n();
  const toast = useToast();
  const openProfile = useOpenProfile();
  const methodsRef = useRef<MDXEditorMethods | null>(null);
  const members = useBoardMembersList(boardId);
  const [mentionOpen, setMentionOpen] = useState(false);

  const insertMention = (member: BoardMemberDto) => {
    methodsRef.current?.insertMarkdown(
      `${mentionMarkdown(mentionMemberLabel(member), member.userId)} `,
    );
    setMentionOpen(false);
  };

  const cancelMention = (query: string | undefined) => {
    setMentionOpen(false);
    // Escape/no-match restores the literal text the author typed; an outside
    // click discards it, so clicking Send cannot inject a stray `@`.
    if (query !== undefined) methodsRef.current?.insertMarkdown(`@${query}`);
  };

  useImperativeHandle(
    ref,
    () => ({
      insertMarkdown: (markdown: string) => {
        methodsRef.current?.insertMarkdown(markdown);
      },
    }),
    [],
  );

  useEffect(() => {
    if (autoFocus) methodsRef.current?.focus();
  }, [autoFocus]);

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
      className="relative"
      onKeyDown={(event) => {
        if (
          event.key === "@" &&
          !event.metaKey &&
          !event.ctrlKey &&
          !event.altKey
        ) {
          // The picker owns the following keystrokes; the literal `@` is
          // restored on Escape/no match and the token inserted on selection.
          event.preventDefault();
          event.stopPropagation();
          setMentionOpen(true);
          return;
        }
        if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
          event.preventDefault();
          event.stopPropagation();
          onSubmit();
          return;
        }
        if (event.key === "Escape" && onCancel !== undefined) {
          event.preventDefault();
          event.stopPropagation();
          onCancel();
        }
      }}
      onPasteCapture={onPasteCapture}
      onClickCapture={(event: ReactMouseEvent) => {
        const anchor = (event.target as HTMLElement | null)?.closest?.("a");
        const mentionId = mentionIdFromHref(anchor?.getAttribute("href"));
        if (mentionId !== null) {
          event.preventDefault();
          event.stopPropagation();
          openProfile(mentionId);
          return;
        }
        handleAttachmentLinkClick(event);
      }}
      onDoubleClickCapture={(event: ReactMouseEvent) =>
        handleAttachmentImageOpen(event)
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
      {mentionOpen ? (
        <MentionPicker
          members={members}
          onSelect={insertMention}
          onCancel={cancelMention}
        />
      ) : null}
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
  const openProfile = useOpenProfile();
  const methodsRef = useRef<MDXEditorMethods | null>(null);
  const markdown = emojify(autolinkMarkdown(sanitizeMarkdownForImport(text)));

  // A row can change text without remounting (a live edit from another tab,
  // TASK-176.2). The `markdown` prop alone does not refresh the read-only
  // Lexical tree here, so push the new body through the imperative API.
  useEffect(() => {
    methodsRef.current?.setMarkdown(markdown);
  }, [markdown]);

  return (
    <div
      onClickCapture={(event) => {
        const anchor = (event.target as HTMLElement | null)?.closest?.("a");
        const mentionId = mentionIdFromHref(anchor?.getAttribute("href"));
        if (mentionId !== null) {
          // A mention is a profile link inside the board, not a URL. The
          // reserved `.invalid` address never reaches the browser's
          // navigation.
          event.preventDefault();
          event.stopPropagation();
          openProfile(mentionId);
          return;
        }
        handleAttachmentLinkClick(event);
        handleAttachmentImageOpen(event);
      }}
      onDoubleClickCapture={(event) => handleAttachmentImageOpen(event)}
    >
      <MDXEditor
        ref={methodsRef}
        key={lang}
        className={cn("janosik-mdx janosik-mdx-readonly", className)}
        contentEditableClassName="janosik-md-content janosik-md-flush"
        markdown={markdown}
        readOnly
        suppressHtmlProcessing
        translation={editorTranslation}
        iconComponentFor={janosikIconFor}
        plugins={descriptionViewerPlugins}
      />
    </div>
  );
}
