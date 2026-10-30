import {
  lazy,
  memo,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  Archive,
  ArchiveRestore,
  ArrowRightLeft,
  CalendarClock,
  CopyPlus,
  Link2,
  Trash2,
} from "lucide-react";

import { ConfirmDialog } from "@/components/board/ConfirmDialog";
import { CardActivity } from "@/components/board/CardActivity";
import { CardChecklists } from "@/components/board/CardChecklists";
import { CardAttachments } from "@/components/board/CardAttachments";
import { CollapsibleSection } from "@/components/board/CollapsibleSection";
import { CardDueDate } from "@/components/board/CardDueDate";
import { CardPriority } from "@/components/board/CardPriority";
import { CardAssignee } from "@/components/board/CardAssignee";
import { CardTaskSpec } from "@/components/board/CardTaskSpec";
import { CardLinks } from "@/components/board/CardLinks";
import { CardCoverPicker } from "@/components/board/CardCoverPicker";
import { LabelPicker } from "@/components/board/LabelPicker";
// MDXEditor + Lexical are ~half of the app bundle but only needed once the
// user opens a card — load them on demand (TASK-19). vi.mock in tests
// intercepts the dynamic import the same way as a static one.
const DescriptionEditor = lazy(() =>
  import("@/components/editor/DescriptionEditor").then((m) => ({
    default: m.DescriptionEditor,
  })),
);
// Keystrokes in the title used to re-render the WYSIWYG editor (TASK-156).
const MemoDescriptionEditor = memo(DescriptionEditor);
import { formatDate, useHour12, useI18n } from "@/i18n";
import { useToast } from "@/components/Toast";
import { LimitCounter } from "@/components/ui/limit-counter";
import { showRemaining } from "@/utils/limit-format";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { api, ApiError } from "@/api/client";
import { embedMarkdown } from "@/utils/embedAttachments";
import type { DescriptionEditorHandle } from "@/components/editor/DescriptionEditor";
import { useBoard } from "@/store/BoardContext";
import { createId } from "@/utils/id";
import type { LabelColor } from "@janosik/shared";
import { LIMITS } from "@janosik/shared";
import { isColumnFull } from "@janosik/shared";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface CardDialogProps {
  cardId: string | null;
  open: boolean;
  /** VIEWER mode (TASK-35): read-only fields, no mutating actions. */
  readOnly?: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Idle gap after the last keystroke that stamps the final `updatedAt`. */
const QUIET_TOUCH_DELAY_MS = 800;

/**
 * Idle gap before a title edit is written to the store (TASK-150, C8).
 *
 * Writing on every keystroke replaced the whole board object, which
 * re-rendered the dialog — and with it the MDXEditor — for a change the
 * editor shows nothing of. The draft stays local; this timer is the quiet
 * commit, and blur/close flush it at once.
 */
const TITLE_COMMIT_DELAY_MS = 400;

/**
 * Description drafts held back because someone else changed the card while
 * they were being typed (C3). Kept per `board:card`, outside the component,
 * so closing or switching the dialog never overwrites the other writer's
 * newer text and reopening the card can ask again. Scoping by board (not just
 * the card id, TASK-147 follow-up) keeps ids from ever colliding across
 * boards. Cleared when the user decides.
 */
const conflictedDrafts = new Map<string, string>();

/** Title drafts withheld by the same rule (TASK-156). */
const heldTitles = new Map<string, string>();

/** Keep the module-level draft maps bounded (review follow-up). */
const MAX_HELD_DRAFTS = 50;
function rememberDraft(
  drafts: Map<string, string>,
  key: string,
  value: string,
): void {
  if (!drafts.has(key) && drafts.size >= MAX_HELD_DRAFTS) {
    const oldest = drafts.keys().next().value;
    if (oldest !== undefined) drafts.delete(oldest);
  }
  drafts.set(key, value);
}

/** The module-map key for one card's conflict draft. */
function conflictedKey(boardId: string, cardId: string): string {
  return `${boardId}:${cardId}`;
}

/** Four rows of text-sm plus the textarea padding: past this the title scrolls. */
const TITLE_MAX_HEIGHT = 100;

/**
 * Card detail popover: edit the title, pick a label, move the card to another
 * column and delete it (with confirmation). Title changes are saved live.
 */
export function CardDialog({
  cardId,
  open,
  readOnly = false,
  onOpenChange,
}: CardDialogProps) {
  const {
    board,
    updateCard,
    touchCard,
    archiveCard,
    unarchiveCard,
    toggleCardLabel,
    addLabel,
    renameLabel,
    setLabelColor,
    deleteLabel,
    moveCard,
    deleteCard,
    duplicateCard,
    registerDraftFlush,
  } = useBoard();
  // The conflict-draft key is board-scoped (TASK-147 follow-up). `board` is
  // optional in the store; an empty id only happens before a board loads,
  // when this dialog is not really open.
  const boardId = board?.id ?? "";
  // Declared before the handlers so event callbacks can reference it without
  // a temporal-dead-zone access (TASK-156).
  const card = board && cardId ? board.cards[cardId] : undefined;
  const { t, lang } = useI18n();
  const hour12 = useHour12();
  const toast = useToast();
  // Fires the "too long" toast once per crossing (not on every keystroke
  // past the limit) and remounts the editor with the clamped markdown —
  // otherwise the editor DOM keeps the oversized text the store rejected.
  const [overflowTick, setOverflowTick] = useState(0);
  const overLimitRef = useRef(false);
  // Quiet updatedAt (TASK-18): live edits dispatch with quiet:true and the
  // debounced touch commits one timestamp per editing session, so sorting
  // by "updated" doesn't reshuffle mid-typing and exports stay clean.
  const touchTimerRef = useRef<number | null>(null);
  // The card the pending timer belongs to, captured when the timer is
  // scheduled — a timer must never stamp a card the user has since opened.
  const touchTargetRef = useRef<string | null>(null);
  const touchCardRef = useRef(touchCard);
  // Mirror the latest action into a ref outside of render (the timer
  // callback must see it without re-creating the timeout).
  useEffect(() => {
    touchCardRef.current = touchCard;
  }, [touchCard]);
  const scheduleTouch = (targetCardId: string) => {
    if (touchTimerRef.current !== null)
      window.clearTimeout(touchTimerRef.current);
    touchTargetRef.current = targetCardId;
    touchTimerRef.current = window.setTimeout(() => {
      touchTimerRef.current = null;
      const target = touchTargetRef.current;
      touchTargetRef.current = null;
      if (target) touchCardRef.current(target);
    }, QUIET_TOUCH_DELAY_MS);
  };
  // Closing the dialog or switching to another card flushes the pending
  // stamp to the card that was actually edited: no edit is dropped and no
  // other card is falsely marked as updated.
  useEffect(
    () => () => {
      if (touchTimerRef.current !== null) {
        window.clearTimeout(touchTimerRef.current);
        touchTimerRef.current = null;
      }
      const target = touchTargetRef.current;
      touchTargetRef.current = null;
      if (target) touchCardRef.current(target);
    },
    [cardId, open],
  );

  // The description stages keystrokes in the editor and commits once —
  // on blur, card switch or dialog close (owner request: the history must
  // show one "Description changed" per editing session, not one per pause).
  const descriptionDraftRef = useRef<{ cardId: string; value: string } | null>(
    null,
  );

  // U-6: the editor is uncontrolled — it reads the description once, on
  // mount. `seen` is the text it is showing (the mount value, or what this
  // dialog committed itself); when the store's description moves away from
  // it, the change came from elsewhere (another member, an agent, an undo).
  // Untouched editor: it silently reloads. With unsaved typing: a notice
  // asks whether to reload or keep mine, and blur no longer overwrites the
  // other change behind the user's back.
  const liveDescription = board?.cards[cardId ?? ""]?.description ?? "";
  const descriptionKey = open && cardId ? conflictedKey(boardId, cardId) : "";
  const [descriptionSync, setDescriptionSync] = useState({
    key: descriptionKey,
    seen: liveDescription,
    dirty: false,
    conflict: false,
    epoch: 0,
  });
  // Draft restored from `conflictedDrafts` when this card is reopened with
  // an unresolved conflict; the editor shows it instead of the stored text
  // so «Keep mine» still commits what the user typed.
  const [heldDraft, setHeldDraft] = useState<string | null>(null);
  if (descriptionSync.key !== descriptionKey) {
    // Another card (or the dialog reopened): start from what is stored —
    // unless an unresolved conflict draft was kept for this card (C3), in
    // which case ask again with the user's text restored.
    const held = descriptionKey
      ? conflictedDrafts.get(descriptionKey)
      : undefined;
    const heldConflicts = held !== undefined && held !== liveDescription;
    if (held !== undefined && !heldConflicts) {
      conflictedDrafts.delete(descriptionKey);
    }
    setHeldDraft(heldConflicts && held !== undefined ? held : null);
    setDescriptionSync({
      key: descriptionKey,
      seen: heldConflicts && held !== undefined ? held : liveDescription,
      dirty: heldConflicts,
      conflict: heldConflicts,
      epoch: descriptionSync.epoch + 1,
    });
  } else if (
    descriptionSync.seen !== liveDescription &&
    !descriptionSync.conflict
  ) {
    setDescriptionSync(
      descriptionSync.dirty
        ? { ...descriptionSync, conflict: true }
        : {
            ...descriptionSync,
            seen: liveDescription,
            epoch: descriptionSync.epoch + 1,
          },
    );
  }

  const flushStagedDescription = useCallback(
    (force = false) => {
      const staged = descriptionDraftRef.current;
      if (!staged) return;
      if (
        !force &&
        conflictedDrafts.has(conflictedKey(boardId, staged.cardId))
      ) {
        // Unresolved conflict: never overwrite the other writer's newer text
        // on blur, close, card switch or pagehide (C3). Keep the draft with
        // the card so reopening it can ask again.
        rememberDraft(
          conflictedDrafts,
          conflictedKey(boardId, staged.cardId),
          staged.value,
        );
        descriptionDraftRef.current = null;
        return;
      }
      conflictedDrafts.delete(conflictedKey(boardId, staged.cardId));
      descriptionDraftRef.current = null;
      setHeldDraft(null);
      // Committed by this dialog: the store's new text is not a foreign one.
      setDescriptionSync((prev) => ({
        ...prev,
        seen: staged.value,
        dirty: false,
        conflict: false,
      }));
      updateCard(
        staged.cardId,
        { description: staged.value },
        {
          quiet: true,
        },
      );
      scheduleTouch(staged.cardId);
    },
    [updateCard, boardId],
  );
  const flushDescriptionRef = useRef(flushStagedDescription);
  useEffect(() => {
    flushDescriptionRef.current = flushStagedDescription;
  }, [flushStagedDescription]);
  // A conflict detected while typing is sealed into the per-card store, so a
  // close/switch (which unmounts the editor) cannot drop it (C3).
  useEffect(() => {
    if (!descriptionSync.conflict) return;
    const staged = descriptionDraftRef.current;
    if (staged !== null) {
      rememberDraft(
        conflictedDrafts,
        conflictedKey(boardId, staged.cardId),
        staged.value,
      );
    }
  }, [
    descriptionSync.conflict,
    descriptionSync.epoch,
    descriptionSync.dirty,
    boardId,
  ]);
  // U-3: the provider flushes the draft before the tab hides or unloads and
  // before logout — typing that never blurred must not be lost.
  useEffect(
    () => registerDraftFlush(() => flushDescriptionRef.current()),
    [registerDraftFlush],
  );
  /** Conflict notice: drop my draft and show the stored description. */
  const reloadDescription = () => {
    descriptionDraftRef.current = null;
    if (cardId) conflictedDrafts.delete(conflictedKey(boardId, cardId));
    setHeldDraft(null);
    setDescriptionSync((prev) => ({
      ...prev,
      seen: liveDescription,
      dirty: false,
      conflict: false,
      epoch: prev.epoch + 1,
    }));
  };
  /** Conflict notice: my draft wins — commit it now, knowingly. */
  const keepMyDescription = () => {
    if (descriptionDraftRef.current === null && heldDraft !== null && cardId) {
      // A draft restored from a previous opening of this dialog.
      descriptionDraftRef.current = { cardId, value: heldDraft };
    }
    if (descriptionDraftRef.current === null) {
      setDescriptionSync((prev) => ({
        ...prev,
        seen: liveDescription,
        conflict: false,
      }));
      return;
    }
    flushStagedDescription(true);
  };
  // Paste-embed (Jira-style): every pasted file uploads as a real card
  // attachment AND embeds into the description at the cursor — an image
  // renders inline, any other file stays as a clickable download link, so
  // mixed text/media structure survives (text → image → text → file).
  // Capture phase: the editor's own paste handlers must not see the files.
  const descriptionEditorRef = useRef<DescriptionEditorHandle | null>(null);
  const onDescriptionPaste = (event: React.ClipboardEvent) => {
    if (readOnly || !card) return;
    const files = Array.from(event.clipboardData?.files ?? []);
    if (files.length === 0) return;
    event.preventDefault();
    event.stopPropagation();
    void (async () => {
      let ok = 0;
      for (const file of files) {
        try {
          const attachment = await api.uploadAttachment(card.id, file);
          descriptionEditorRef.current?.insertMarkdown(
            embedMarkdown(file, attachment.id),
          );
          ok += 1;
        } catch (error) {
          if (error instanceof ApiError && error.status === 413) {
            toast.error(
              t("card.attachments.tooLarge", {
                max: LIMITS.attachmentSize / 1024 / 1024,
              }),
            );
          } else if (error instanceof ApiError && error.status === 0) {
            // Offline board: nothing to upload the blob to.
            toast.error(t("card.attachments.pasteOffline"));
            return;
          } else {
            toast.error(t("card.attachments.uploadError"));
          }
        }
      }
      if (ok > 0) {
        toast.success(
          t("card.attachments.pasted", {
            name: files[0]?.name ?? "",
          }),
        );
      }
    })();
  };
  // Switching cards or closing the dialog unmounts the editor without a
  // blur — the per-card cleanup is what saves the staged draft.
  useEffect(() => {
    const flush = () => flushDescriptionRef.current();
    return flush;
  }, [cardId]);

  // Title grows with its content (Jira-style) instead of reserving three
  // blank rows: one line at rest, a scrollbar past four rows.
  const titleRef = useRef<HTMLTextAreaElement | null>(null);
  // Local title draft (TASK-150, C8): keystrokes stay here, the store sees
  // one quietly-stamped write after an idle gap (or on blur/close), so typing
  // the title no longer re-renders the description editor.
  const [titleDraft, setTitleDraft] = useState("");
  const titleDraftRef = useRef("");
  const titleTargetRef = useRef<string | null>(null);
  const titleTimerRef = useRef<number | null>(null);
  // What the draft was based on (TASK-156): a stored title that differs from
  // it while the user is typing is a foreign rename, not our own echo.
  const titleSeenRef = useRef("");
  const titleDirtyRef = useRef(false);
  const titleConflictRef = useRef(false);
  const [titleConflict, setTitleConflict] = useState(false);
  const updateCardRef = useRef(updateCard);
  useEffect(() => {
    updateCardRef.current = updateCard;
  }, [updateCard]);
  const flushTitle = useCallback(
    (force = false) => {
      if (titleTimerRef.current !== null) {
        window.clearTimeout(titleTimerRef.current);
        titleTimerRef.current = null;
      }
      const target = titleTargetRef.current;
      titleTargetRef.current = null;
      if (!target) return;
      const value = titleDraftRef.current;
      if (!force && titleConflictRef.current) {
        // Never overwrite the other writer's newer title on blur/close.
        rememberDraft(heldTitles, conflictedKey(boardId, target), value);
        return;
      }
      heldTitles.delete(conflictedKey(boardId, target));
      titleSeenRef.current = value;
      titleDirtyRef.current = false;
      titleConflictRef.current = false;
      setTitleConflict(false);
      updateCardRef.current(target, { title: value }, { quiet: true });
      // The idle gap already played the debounce role; stamp now so "updated"
      // and the undo precondition line up with the write. A pending description
      // touch would otherwise stamp the card a second time for the same burst.
      if (touchTimerRef.current !== null) {
        window.clearTimeout(touchTimerRef.current);
        touchTimerRef.current = null;
      }
      touchCardRef.current(target);
    },
    [boardId],
  );
  const flushTitleRef = useRef(flushTitle);
  useEffect(() => {
    flushTitleRef.current = flushTitle;
  }, [flushTitle]);
  // Closing/switching unmounts the field without a blur — commit here (but
  // never over an unresolved foreign rename).
  useEffect(
    () => () => {
      flushTitleRef.current();
    },
    [cardId, open],
  );
  useEffect(() => {
    if (!cardId) return;
    const key = conflictedKey(boardId, cardId);
    const stored = board?.cards[cardId]?.title ?? "";
    const held = heldTitles.get(key);
    titleSeenRef.current = stored;
    titleDirtyRef.current = held !== undefined;
    titleTargetRef.current = held !== undefined ? cardId : null;
    titleConflictRef.current = held !== undefined;
    setTitleConflict(held !== undefined);
    if (titleTimerRef.current !== null) {
      window.clearTimeout(titleTimerRef.current);
      titleTimerRef.current = null;
    }
    titleDraftRef.current = held ?? stored;
    setTitleDraft(held ?? stored);
    // Only a card/board switch reseeds; live writes are handled by the
    // external-change effect below so a draft is never lost to a re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cardId, open, board?.id]);
  // A stored title that moved away from the draft's base is a foreign rename.
  useEffect(() => {
    if (!cardId || !open) return;
    const stored = board?.cards[cardId]?.title;
    if (stored === undefined || stored === titleSeenRef.current) return;
    if (!titleDirtyRef.current && !titleConflictRef.current) {
      titleSeenRef.current = stored;
      titleDraftRef.current = stored;
      setTitleDraft(stored);
      return;
    }
    // Keep the local text and stop the timer; the user chooses reload/keep.
    if (titleTimerRef.current !== null) {
      window.clearTimeout(titleTimerRef.current);
      titleTimerRef.current = null;
    }
    titleConflictRef.current = true;
    setTitleConflict(true);
  }, [board?.cards, cardId, open]);
  const reloadTitle = () => {
    if (!cardId) return;
    const stored = board?.cards[cardId]?.title ?? "";
    heldTitles.delete(conflictedKey(boardId, cardId));
    titleSeenRef.current = stored;
    titleDraftRef.current = stored;
    titleDirtyRef.current = false;
    titleConflictRef.current = false;
    setTitleConflict(false);
    setTitleDraft(stored);
  };
  const keepMyTitle = () => {
    if (!cardId) return;
    titleTargetRef.current = cardId;
    titleConflictRef.current = false;
    setTitleConflict(false);
    flushTitleRef.current(true);
  };
  const onTitleChange = (value: string) => {
    if (readOnly || !cardId) return;
    titleDraftRef.current = value;
    titleDirtyRef.current = true;
    titleTargetRef.current = cardId;
    setTitleDraft(value);
    if (titleTimerRef.current !== null) {
      window.clearTimeout(titleTimerRef.current);
    }
    titleTimerRef.current = window.setTimeout(() => {
      titleTimerRef.current = null;
      flushTitleRef.current();
    }, TITLE_COMMIT_DELAY_MS);
  };
  const titleText = titleDraft;
  useLayoutEffect(() => {
    const el = titleRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, TITLE_MAX_HEIGHT)}px`;
    el.style.overflowY = el.scrollHeight > TITLE_MAX_HEIGHT ? "auto" : "hidden";
  }, [cardId, open, titleText]);

  // The editor is memoized, so its `onChange` must keep one identity for the
  // whole card session (TASK-156): the latest closure is read through a ref.
  const descriptionChangeRef = useRef<(description: string) => void>(() => {});
  const onDescriptionChange = useCallback((description: string) => {
    descriptionChangeRef.current(description);
  }, []);
  const commitDescriptionChange = (description: string): void => {
    if (!card) return;
    const clamped = description.slice(0, LIMITS.description);
    if (description.length > LIMITS.description) {
      if (!overLimitRef.current) {
        overLimitRef.current = true;
        toast.error(t("limits.exceeded", { limit: LIMITS.description }));
      }
      if (descriptionSync.conflict) {
        // Unresolved conflict: stage the clamped text and never commit behind
        // the other writer's back.
        descriptionDraftRef.current = {
          cardId: card.id,
          value: clamped,
        };
        rememberDraft(
          conflictedDrafts,
          conflictedKey(boardId, card.id),
          clamped,
        );
        return;
      }
      // Oversized pastes clamp immediately — this path still commits right
      // away, staging stays empty.
      descriptionDraftRef.current = null;
      setDescriptionSync((prev) => ({
        ...prev,
        seen: clamped,
        dirty: false,
        conflict: false,
      }));
      updateCard(card.id, { description: clamped }, { quiet: true });
      scheduleTouch(card.id);
      setOverflowTick((n) => n + 1);
      return;
    }
    overLimitRef.current = false;
    // Stage only: one UPDATE_CARD lands on blur / card switch / dialog close,
    // not one per pause in typing.
    descriptionDraftRef.current = {
      cardId: card.id,
      value: description,
    };
    if (descriptionSync.conflict) {
      rememberDraft(
        conflictedDrafts,
        conflictedKey(boardId, card.id),
        description,
      );
    }
    if (!descriptionSync.dirty) {
      setDescriptionSync((prev) =>
        prev.dirty ? prev : { ...prev, dirty: true },
      );
    }
  };
  // Ref writes are effect-only (TASK-156): the memoized editor sees the
  // latest handler from the next render without a new `onChange` identity.
  useEffect(() => {
    descriptionChangeRef.current = commitDescriptionChange;
  });

  if (!board || !cardId) {
    // Dialog stays closed when there's nothing to show.
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("card.notFoundTitle")}</DialogTitle>
            <DialogDescription>{t("card.notFoundDesc")}</DialogDescription>
          </DialogHeader>
        </DialogContent>
      </Dialog>
    );
  }

  // Card may have been deleted while the dialog was open.
  if (!card) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("card.notFoundTitle")}</DialogTitle>
            <DialogDescription>{t("card.deletedDesc")}</DialogDescription>
          </DialogHeader>
        </DialogContent>
      </Dialog>
    );
  }

  const currentColumn = board.columns.find((col) =>
    col.cardIds.includes(card.id),
  );

  // The duplicate lands in the card's own column — it is blocked when that
  // column cannot take another card (hard limit or WIP), so the button
  // says so up front instead of doing nothing.
  const duplicateDisabled = currentColumn ? isColumnFull(currentColumn) : true;
  const duplicateDisabledReason =
    currentColumn?.wipLimit !== undefined &&
    currentColumn.cardIds.length >= currentColumn.wipLimit
      ? t("column.wipLimitReached", { limit: currentColumn.wipLimit })
      : t("limits.columnFull", { limit: LIMITS.cardsPerColumn });

  const handleDelete = () => {
    deleteCard(card.id);
    onOpenChange(false);
  };

  // The duplicate lands right below the original with all content copied;
  // close the dialog so the user sees it on the board.
  const handleDuplicate = () => {
    duplicateCard(card.id, t("card.duplicateTitle", { title: card.title }));
    onOpenChange(false);
  };

  const handleCreateLabel = (name: string, color: LabelColor) => {
    const label = { id: createId(), name, color };
    addLabel(label);
    if (card) toggleCardLabel(card.id, label.id);
  };

  const handleMove = (columnId: string) => {
    const target = board.columns.find((col) => col.id === columnId);
    if (!target) return;
    moveCard(
      card.id,
      currentColumn?.id ?? target.id,
      columnId,
      target.cardIds.length,
    );
  };

  // Archive keeps the dialog open: the card is still here (archived cards
  // stay in `board.cards`), so the footer flips to "Unarchive" and the user
  // can put it right back without hunting through the archive (TASK-18.1).
  const handleArchive = () => {
    archiveCard(card.id);
  };

  // Restore keeps the dialog open so the user sees the card back on board.
  const handleRestore = (columnId: string) => {
    unarchiveCard(card.id, columnId);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        {/* Fixed, viewport-bound height (TASK-44): the card always opens as
            the same near-full-height panel (1rem breathing room top and
            bottom) — long descriptions and checklists scroll in the body
            instead of growing the dialog from both ends. */}
        <DialogContent className="h-[calc(100dvh-2rem)] w-[calc(100vw-1.5rem)] sm:max-w-3xl">
          <DialogHeader className="group/header shrink-0 pr-8">
            {/* Copy link hugs the title text (Jira-style): it pops out
                immediately after "Card details" while the header is
                hovered — not after the (much wider) subtitle block. */}
            <div className="flex items-center gap-1.5">
              <DialogTitle className="text-base">
                {t("card.detailsTitle")}
              </DialogTitle>
              <span className="opacity-0 transition-opacity focus-within:opacity-100 group-hover/header:opacity-100">
                <CopyCardLinkButton />
              </span>
            </div>
            <DialogDescription>{t("card.detailsSubtitle")}</DialogDescription>
          </DialogHeader>

          {/* Scrollable body: the dialog caps itself to the viewport height
              (see ui/dialog.tsx), so tall cards (long descriptions, many
              checklists) scroll here while the header and the action footer
              below stay reachable. The negative/positive margin pair keeps
              the scrollbar at the dialog edge instead of inside the padding. */}
          <div className="-mx-6 min-h-0 flex-1 space-y-5 overflow-y-auto px-6">
            <div className="space-y-1.5">
              <label
                htmlFor="card-title-input"
                className="text-xs font-medium text-muted-foreground"
              >
                {t("card.titleLabel")}
              </label>
              <Textarea
                id="card-title-input"
                ref={titleRef}
                name="card-title"
                autoFocus
                readOnly={readOnly}
                value={titleDraft}
                maxLength={LIMITS.cardTitle}
                onChange={(e) => {
                  onTitleChange(e.target.value);
                }}
                onBlur={() => {
                  if (!readOnly) flushTitle();
                }}
                onFocus={(e) => e.target.select()}
                rows={1}
                className="min-h-9 resize-none break-words"
                placeholder={t("card.titlePlaceholder")}
                aria-describedby={
                  showRemaining(titleDraft.length, LIMITS.cardTitle)
                    ? "card-title-counter"
                    : undefined
                }
              />
              {/* Live counter appears only near the limit — constant
                  character counts are noise for a 300-char title. */}
              <LimitCounter
                id="card-title-counter"
                length={titleDraft.length}
                limit={LIMITS.cardTitle}
                testId="card-title-counter"
              />
              {titleConflict && !readOnly ? (
                <div
                  role="alert"
                  data-testid="card-title-conflict"
                  className="flex flex-wrap items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-2.5 py-1.5 text-xs text-foreground"
                >
                  <span className="min-w-0 flex-1">
                    {t("card.titleConflict")}
                  </span>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7"
                    data-testid="card-title-conflict-reload"
                    onClick={reloadTitle}
                  >
                    {t("card.descriptionConflictReload")}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-7"
                    data-testid="card-title-conflict-keep"
                    onClick={keepMyTitle}
                  >
                    {t("card.descriptionConflictKeep")}
                  </Button>
                </div>
              ) : null}
            </div>

            {/* Attribution line: directly under the title (owner's layout),
                before the content sections begin. */}
            <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground/70">
              <CalendarClock className="h-3.5 w-3.5" />
              {t("card.created", {
                date: formatDate(card.createdAt, lang, hour12),
              })}
              {card.updatedAt > card.createdAt
                ? ` · ${t("card.updated", { date: formatDate(card.updatedAt, lang, hour12) })}`
                : ""}
            </div>

            <CollapsibleSection
              title={t("card.descriptionLabel")}
              testId="card-description-toggle"
              contentClassName="mt-1.5 space-y-1.5"
            >
              {/* WYSIWYG Markdown (MDXEditor) — formatting lives in the
                  editor toolbar; no separate preview toggle needed. The
                  editor surface can't take maxLength (contenteditable), so
                  oversized pastes are clamped here with a visible toast. */}
              <Suspense
                fallback={
                  /* Same footprint as the empty editor so the dialog rows
                     don't jump while the chunk streams in (first open only). */
                  <div className="h-16 animate-pulse rounded-md bg-muted/40" />
                }
              >
                {/* The blur wrapper closes the staging window: leaving the
                    editor is what commits the description. */}
                {descriptionSync.conflict && !readOnly ? (
                  <div
                    role="alert"
                    data-testid="card-description-conflict"
                    className="mb-1.5 flex flex-wrap items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-2.5 py-1.5 text-xs text-foreground"
                  >
                    <span className="min-w-0 flex-1">
                      {t("card.descriptionConflict")}
                    </span>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-7"
                      data-testid="card-description-conflict-reload"
                      onClick={reloadDescription}
                    >
                      {t("card.descriptionConflictReload")}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="h-7"
                      data-testid="card-description-conflict-keep"
                      onClick={keepMyDescription}
                    >
                      {t("card.descriptionConflictKeep")}
                    </Button>
                  </div>
                ) : null}
                <div
                  onBlur={() => {
                    // A pending conflict is decided by the notice, not by
                    // leaving the editor.
                    if (!descriptionSync.conflict) flushStagedDescription();
                  }}
                  onPasteCapture={onDescriptionPaste}
                >
                  <MemoDescriptionEditor
                    ref={descriptionEditorRef}
                    key={`${card.id}:${overflowTick}:${descriptionSync.epoch}`}
                    value={
                      descriptionSync.conflict && heldDraft !== null
                        ? heldDraft
                        : (card.description ?? "")
                    }
                    readOnly={readOnly}
                    onChange={onDescriptionChange}
                    placeholder={t("card.descriptionPlaceholder")}
                  />
                </div>
              </Suspense>
              <LimitCounter
                length={(card.description ?? "").length}
                limit={LIMITS.description}
                testId="card-description-counter"
              />
            </CollapsibleSection>

            <div className="space-y-1.5">
              <span className="text-xs font-medium text-muted-foreground">
                {t("card.labelLabel")}
              </span>
              <LabelPicker
                labels={board.labels}
                selected={card.labelIds}
                readOnly={readOnly}
                onToggle={(labelId) => toggleCardLabel(card.id, labelId)}
                onCreate={handleCreateLabel}
                onRename={renameLabel}
                onRecolor={setLabelColor}
                onDelete={deleteLabel}
              />
            </div>

            <CardPriority
              cardId={card.id}
              priority={card.priority}
              readOnly={readOnly}
            />

            <CardDueDate
              cardId={card.id}
              dueDate={card.dueDate}
              readOnly={readOnly}
            />

            <CardAssignee
              boardId={board.id}
              cardId={card.id}
              assigneeId={card.assigneeId}
              readOnly={readOnly}
            />

            <CardTaskSpec
              acceptanceCriteria={card.acceptanceCriteria}
              definitionOfDone={card.definitionOfDone}
            />

            <CardLinks cardId={card.id} board={board} readOnly={readOnly} />

            {readOnly ? null : (
              <CardCoverPicker cardId={card.id} cover={card.cover} />
            )}

            <CardChecklists
              cardId={card.id}
              checklists={card.checklists ?? []}
              readOnly={readOnly}
            />

            <CardAttachments
              cardId={card.id}
              boardId={board.id}
              readOnly={readOnly}
            />

            {!readOnly && !card.archivedAt && (
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-muted-foreground">
                  {t("card.columnLabel")}
                </span>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm">
                      <ArrowRightLeft className="h-3.5 w-3.5" />
                      {currentColumn?.title ?? "—"}
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-48">
                    <DropdownMenuLabel>{t("card.moveTo")}</DropdownMenuLabel>
                    {board.columns.map((column) => {
                      const full =
                        column.id !== currentColumn?.id && isColumnFull(column);
                      return (
                        <DropdownMenuItem
                          key={column.id}
                          disabled={column.id === currentColumn?.id || full}
                          onClick={() => handleMove(column.id)}
                        >
                          {column.id === currentColumn?.id ? "✓ " : ""}
                          <span className="truncate">{column.title}</span>
                          {column.wipLimit !== undefined && (
                            <span className="ml-auto pl-2 text-xs tabular-nums text-muted-foreground">
                              {column.cardIds.length}/{column.wipLimit}
                            </span>
                          )}
                        </DropdownMenuItem>
                      );
                    })}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            )}

            {/* Last on purpose: the thread is the part that grows and
                scrolls, everything above stays put. */}
            <CardActivity
              key={card.id}
              cardId={card.id}
              boardId={board.id}
              updatedAt={card.updatedAt}
              localActivity={card.activity}
              readOnly={readOnly}
            />
          </div>

          <DialogFooter className="mt-2 shrink-0">
            {readOnly ? null : (
              <>
                {card.archivedAt === undefined ? (
                  duplicateDisabled ? (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        {/* Disabled buttons drop pointer events — the tooltip
                            needs a wrapper that still receives them. */}
                        <span className="inline-flex">
                          <Button variant="ghost" disabled>
                            <CopyPlus className="h-4 w-4" />
                            {t("card.duplicate")}
                          </Button>
                        </span>
                      </TooltipTrigger>
                      <TooltipContent>{duplicateDisabledReason}</TooltipContent>
                    </Tooltip>
                  ) : (
                    <Button variant="ghost" onClick={handleDuplicate}>
                      <CopyPlus className="h-4 w-4" />
                      {t("card.duplicate")}
                    </Button>
                  )
                ) : null}
                {card.archivedAt === undefined ? (
                  <Button variant="ghost" onClick={handleArchive}>
                    <Archive className="h-4 w-4" />
                    {t("card.archive")}
                  </Button>
                ) : (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost">
                        <ArchiveRestore className="h-4 w-4" />
                        {t("card.unarchive")}
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" className="w-48">
                      <DropdownMenuLabel>
                        {t("card.restoreTo")}
                      </DropdownMenuLabel>
                      {board.columns.map((column) => {
                        const full = isColumnFull(column);
                        return (
                          <DropdownMenuItem
                            key={column.id}
                            disabled={full}
                            onClick={() => handleRestore(column.id)}
                          >
                            <span className="truncate">{column.title}</span>
                            {column.wipLimit !== undefined && (
                              <span className="ml-auto pl-2 text-xs tabular-nums text-muted-foreground">
                                {column.cardIds.length}/{column.wipLimit}
                              </span>
                            )}
                          </DropdownMenuItem>
                        );
                      })}
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
                <CardDeleteAction
                  archived={card.archivedAt !== undefined}
                  title={card.title}
                  onConfirm={handleDelete}
                />
              </>
            )}
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              {t("card.close")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

interface CardDeleteActionProps {
  archived: boolean;
  title: string;
  onConfirm: () => void;
}

/**
 * Delete button + its confirmation dialog. The pending-confirm flag lives
 * here, inside the card's `DialogContent`, so closing the card dialog
 * unmounts it and the next open never re-opens a stale confirmation
 * (AGENT.md: reset by remount — no `open` effect).
 */
function CardDeleteAction({
  archived,
  title,
  onConfirm,
}: CardDeleteActionProps) {
  const { t } = useI18n();
  const [confirm, setConfirm] = useState(false);

  return (
    <>
      <Button
        variant="ghost"
        className="text-destructive hover:bg-destructive/10 hover:text-destructive"
        onClick={() => setConfirm(true)}
      >
        <Trash2 className="h-4 w-4" />
        {archived ? t("card.deleteForever") : t("card.delete")}
      </Button>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={archived ? t("card.deleteForeverTitle") : t("card.deleteTitle")}
        description={
          archived
            ? t("card.deleteForeverDescription", { title })
            : t("card.deleteDescription", { title })
        }
        confirmLabel={t("card.deleteConfirm")}
        destructive
        onConfirm={onConfirm}
      />
    </>
  );
}

/**
 * Copies the address-bar URL (TASK-37). Every open path — click included —
 * keeps `?card=<id>` in sync (BoardSection), so the current URL is always
 * a deep link that reopens this exact card.
 */
function CopyCardLinkButton() {
  const { t } = useI18n();
  const toast = useToast();

  const handleCopy = async () => {
    try {
      if (!navigator.clipboard) throw new Error("clipboard unavailable");
      await navigator.clipboard.writeText(window.location.href);
      toast.success(t("card.linkCopied"));
    } catch {
      toast.error(t("card.linkCopyError"));
    }
  };

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0 text-muted-foreground"
          aria-label={t("card.copyLink")}
          data-testid="card-copy-link"
          onClick={() => void handleCopy()}
        >
          <Link2 className="h-4 w-4 -rotate-45" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{t("card.copyLink")}</TooltipContent>
    </Tooltip>
  );
}
