import "@mdxeditor/editor/style.css";

import {
  forwardRef,
  useCallback,
  useEffect,
  useId,
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
import {
  canOpenMentionAt,
  isMentionTrigger,
  mentionMemberLabel,
} from "@/utils/mentions";
import {
  embedMarkdown,
  handleAttachmentImageOpen,
  handleAttachmentLinkClick,
} from "@/utils/embedAttachments";
import {
  LIMITS,
  isMentionHref,
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

const BLOCK_TAGS = new Set([
  "ADDRESS",
  "ARTICLE",
  "ASIDE",
  "BLOCKQUOTE",
  "DIV",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "LI",
  "OL",
  "P",
  "PRE",
  "SECTION",
  "TABLE",
  "UL",
]);

/**
 * The last visible character before the caret, or null when the caret starts
 * a block/list item or follows a `<br>`. `Range.toString()` hides those
 * boundaries (it concatenates blocks), so the cloned fragment is inspected
 * structurally.
 */
function lastCaretChar(node: Node | null): string | null {
  if (node === null) return null;
  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.textContent ?? "";
    return text === "" ? null : ([...text].pop() ?? null);
  }
  if (node.nodeType === Node.DOCUMENT_FRAGMENT_NODE) {
    return lastCaretChar(node.lastChild);
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return null;
  const element = node as HTMLElement;
  if (element.tagName === "BR") return null;
  let child = element.lastChild;
  while (child !== null) {
    if (child.nodeType === Node.ELEMENT_NODE) {
      const childElement = child as HTMLElement;
      if (childElement.tagName === "BR") return null;
    }
    const last = lastCaretChar(child);
    if (last !== null) return last;
    if (
      child.nodeType === Node.ELEMENT_NODE &&
      BLOCK_TAGS.has((child as HTMLElement).tagName)
    ) {
      return null;
    }
    child = child.previousSibling;
  }
  if (BLOCK_TAGS.has(element.tagName)) return null;
  return lastCaretChar(element.previousSibling);
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
  const editorRef = useRef<HTMLDivElement>(null);
  const members = useBoardMembersList(boardId);
  const mentionListId = useId();
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionActiveId, setMentionActiveId] = useState<string | null>(null);

  const insertMention = (member: BoardMemberDto) => {
    methodsRef.current?.insertMarkdown(
      `${mentionMarkdown(mentionMemberLabel(member), member.userId)} `,
    );
    setMentionOpen(false);
    setMentionActiveId(null);
  };

  const cancelMention = useCallback((query: string | undefined) => {
    setMentionOpen(false);
    setMentionActiveId(null);
    // A dismissal restores the literal text the author typed; an explicit
    // Send passes `undefined` so the draft is not polluted with `@query`.
    if (query !== undefined) methodsRef.current?.insertMarkdown(`@${query}`);
  }, []);

  const reportMentionActive = useCallback((optionId: string | null) => {
    setMentionActiveId((current) =>
      current === optionId ? current : optionId,
    );
  }, []);

  useEffect(() => {
    const editable = editorRef.current?.querySelector<HTMLElement>(
      '[contenteditable="true"]',
    );
    if (!editable) return;
    // ARIA 1.2 combobox: the editor is a textbox *with autocomplete*, so
    // every combobox attribute is valid only after the role is switched.
    editable.setAttribute("role", "combobox");
    editable.setAttribute("aria-autocomplete", "list");
    editable.setAttribute("aria-haspopup", "listbox");
    editable.setAttribute("aria-expanded", mentionOpen ? "true" : "false");
    if (!mentionOpen) {
      editable.removeAttribute("aria-controls");
      editable.removeAttribute("aria-activedescendant");
      return;
    }
    editable.setAttribute("aria-controls", `${mentionListId}-listbox`);
    if (mentionActiveId !== null) {
      editable.setAttribute("aria-activedescendant", mentionActiveId);
    } else {
      editable.removeAttribute("aria-activedescendant");
    }
  }, [lang, mentionActiveId, mentionListId, mentionOpen]);

  /** Caret context used by the `@` trigger (block boundaries are openings). */
  const caretContext = (): { previous: string | null; inCode: boolean } => {
    const root = editorRef.current;
    const selection = window.getSelection();
    if (root === null || selection === null || selection.rangeCount === 0) {
      return { previous: null, inCode: false };
    }
    const range = selection.getRangeAt(0);
    if (!root.contains(range.startContainer)) {
      return { previous: null, inCode: false };
    }
    const startElement =
      range.startContainer.nodeType === Node.TEXT_NODE
        ? range.startContainer.parentElement
        : (range.startContainer as HTMLElement);
    const inCode =
      startElement?.closest("code, pre, textarea, [class*='code']") != null;
    if (range.startContainer.nodeType === Node.TEXT_NODE) {
      const text = range.startContainer.textContent ?? "";
      if (range.startOffset > 0) {
        return {
          previous: [...text.slice(0, range.startOffset)].pop() ?? null,
          inCode,
        };
      }
    }
    // `Range.toString()` concatenates block text without separators, so walk
    // the cloned fragment to the last meaningful node instead. A block, list
    // item or `<br>` boundary means the caret starts fresh and `@` opens.
    const before = range.cloneRange();
    before.selectNodeContents(root);
    before.setEnd(range.startContainer, range.startOffset);
    return { previous: lastCaretChar(before.cloneContents()), inCode };
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
      ref={editorRef}
      data-testid="comment-input"
      className="relative"
      onKeyDown={(event) => {
        const context = caretContext();
        const codeSurface = (node: Element | null) =>
          node?.closest("code, pre, textarea, [class*='code']") != null;
        const eventTarget =
          event.target instanceof Element ? event.target : null;
        const activeElement =
          document.activeElement instanceof HTMLElement
            ? document.activeElement
            : null;
        const inCodeControl =
          codeSurface(eventTarget) || codeSurface(activeElement);
        if (
          !context.inCode &&
          !inCodeControl &&
          isMentionTrigger({
            key: event.key,
            isComposing: event.nativeEvent.isComposing,
            metaKey: event.metaKey,
            ctrlKey: event.ctrlKey,
            altKey: event.altKey,
          }) &&
          canOpenMentionAt(context.previous)
        ) {
          // The picker owns the following keystrokes; the literal `@` is
          // restored on Escape/no match and the token inserted on selection.
          event.preventDefault();
          event.stopPropagation();
          setMentionOpen(true);
          setMentionActiveId(null);
          return;
        }
        if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
          event.preventDefault();
          event.stopPropagation();
          // Submit discards an uncommitted picker query, like the Send click.
          setMentionOpen(false);
          setMentionActiveId(null);
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
        const href = anchor?.getAttribute("href");
        if (isMentionHref(href)) {
          event.preventDefault();
          event.stopPropagation();
          const mentionId = mentionIdFromHref(href);
          if (mentionId !== null) openProfile(mentionId);
          return;
        }
        handleAttachmentLinkClick(event);
      }}
      onAuxClickCapture={(event: ReactMouseEvent) => {
        const anchor = (event.target as HTMLElement | null)?.closest?.("a");
        if (isMentionHref(anchor?.getAttribute("href"))) {
          event.preventDefault();
          event.stopPropagation();
        }
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
          anchorRef={editorRef}
          idPrefix={mentionListId}
          onSelect={insertMention}
          onCancel={cancelMention}
          onActiveChange={reportMentionActive}
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
        const href = anchor?.getAttribute("href");
        if (isMentionHref(href)) {
          // A mention is a profile link inside the board, not a URL. The
          // reserved `.invalid` address never reaches the browser's
          // navigation; malformed lookalikes are swallowed without a profile.
          event.preventDefault();
          event.stopPropagation();
          const mentionId = mentionIdFromHref(href);
          if (mentionId !== null) openProfile(mentionId);
          return;
        }
        handleAttachmentLinkClick(event);
        handleAttachmentImageOpen(event);
      }}
      onAuxClickCapture={(event) => {
        const anchor = (event.target as HTMLElement | null)?.closest?.("a");
        if (isMentionHref(anchor?.getAttribute("href"))) {
          event.preventDefault();
          event.stopPropagation();
        }
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
