import { lazy, Suspense, useEffect, useRef, useState } from "react";
import {
  Archive,
  ArchiveRestore,
  ArrowRightLeft,
  CalendarClock,
  CopyPlus,
  Trash2,
} from "lucide-react";

import { ConfirmDialog } from "@/components/board/ConfirmDialog";
import { CardActivityFeed } from "@/components/board/CardActivityFeed";
import { CardChecklists } from "@/components/board/CardChecklists";
import { CardDueDate } from "@/components/board/CardDueDate";
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
import { useBoard } from "@/store/BoardContext";
import { createId } from "@/utils/id";
import type { LabelColor } from "@/types/kanban";
import { LIMITS } from "@/types/kanban";
import { isColumnFull } from "@/utils/column-limits";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface CardDialogProps {
  cardId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Idle gap after the last keystroke that stamps the final `updatedAt`. */
const QUIET_TOUCH_DELAY_MS = 800;

/**
 * Card detail popover: edit the title, pick a label, move the card to another
 * column and delete it (with confirmation). Title changes are saved live.
 */
export function CardDialog({ cardId, open, onOpenChange }: CardDialogProps) {
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
  } = useBoard();
  const { t, lang } = useI18n();
  const hour12 = useHour12();
  const toast = useToast();
  const [confirmDelete, setConfirmDelete] = useState(false);
  // Fires the "too long" toast once per crossing (not on every keystroke
  // past the limit) and remounts the editor with the clamped markdown —
  // otherwise the editor DOM keeps the oversized text the store rejected.
  const [overflowTick, setOverflowTick] = useState(0);
  const overLimitRef = useRef(false);
  // Quiet updatedAt (TASK-18): live edits dispatch with quiet:true and the
  // debounced touch commits one timestamp per editing session, so sorting
  // by "updated" doesn't reshuffle mid-typing and exports stay clean.
  const touchTimerRef = useRef<number | null>(null);
  const touchCardRef = useRef(touchCard);
  const cardIdRef = useRef(cardId);
  // Mirror the latest values into refs outside of render (the timer callback
  // must see current ones without re-creating the timeout).
  useEffect(() => {
    touchCardRef.current = touchCard;
    cardIdRef.current = cardId;
  }, [touchCard, cardId]);
  const scheduleTouch = () => {
    if (touchTimerRef.current !== null)
      window.clearTimeout(touchTimerRef.current);
    touchTimerRef.current = window.setTimeout(() => {
      touchTimerRef.current = null;
      if (cardIdRef.current) touchCardRef.current(cardIdRef.current);
    }, QUIET_TOUCH_DELAY_MS);
  };
  useEffect(
    () => () => {
      // Flush a pending commit: closing the dialog right after typing
      // must still stamp the final time, not drop it.
      if (touchTimerRef.current !== null) {
        window.clearTimeout(touchTimerRef.current);
        touchTimerRef.current = null;
        if (cardIdRef.current) touchCardRef.current(cardIdRef.current);
      }
    },
    [],
  );

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

  const card = board.cards[cardId];
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
    setConfirmDelete(false);
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

  // Archive closes the dialog — the card just left the board (TASK-18.1).
  const handleArchive = () => {
    archiveCard(card.id);
    onOpenChange(false);
  };

  // Restore keeps the dialog open so the user sees the card back on board.
  const handleRestore = (columnId: string) => {
    unarchiveCard(card.id, columnId);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="w-[calc(100vw-1.5rem)] sm:max-w-3xl">
          <DialogHeader className="pr-8">
            <DialogTitle className="text-base">
              {t("card.detailsTitle")}
            </DialogTitle>
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
                name="card-title"
                autoFocus
                value={card.title}
                maxLength={LIMITS.cardTitle}
                onChange={(e) => {
                  updateCard(
                    card.id,
                    { title: e.target.value },
                    { quiet: true },
                  );
                  scheduleTouch();
                }}
                onFocus={(e) => e.target.select()}
                rows={3}
                className="resize-none break-words"
                placeholder={t("card.titlePlaceholder")}
                aria-describedby={
                  showRemaining(card.title.length, LIMITS.cardTitle)
                    ? "card-title-counter"
                    : undefined
                }
              />
              {/* Live counter appears only near the limit — constant
                  character counts are noise for a 300-char title. */}
              <LimitCounter
                id="card-title-counter"
                length={card.title.length}
                limit={LIMITS.cardTitle}
                testId="card-title-counter"
              />
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor="card-description-input"
                className="text-xs font-medium text-muted-foreground"
              >
                {t("card.descriptionLabel")}
              </label>
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
                <DescriptionEditor
                  key={`${card.id}:${overflowTick}`}
                  value={card.description ?? ""}
                  onChange={(description) => {
                    if (description.length > LIMITS.description) {
                      if (!overLimitRef.current) {
                        overLimitRef.current = true;
                        toast.error(
                          t("limits.exceeded", { limit: LIMITS.description }),
                        );
                      }
                      updateCard(
                        card.id,
                        {
                          description: description.slice(0, LIMITS.description),
                        },
                        { quiet: true },
                      );
                      scheduleTouch();
                      setOverflowTick((n) => n + 1);
                      return;
                    }
                    overLimitRef.current = false;
                    updateCard(card.id, { description }, { quiet: true });
                    scheduleTouch();
                  }}
                  placeholder={t("card.descriptionPlaceholder")}
                />
              </Suspense>
              <LimitCounter
                length={(card.description ?? "").length}
                limit={LIMITS.description}
                testId="card-description-counter"
              />
            </div>

            <div className="space-y-1.5">
              <span className="text-xs font-medium text-muted-foreground">
                {t("card.labelLabel")}
              </span>
              <LabelPicker
                labels={board.labels}
                selected={card.labelIds}
                onToggle={(labelId) => toggleCardLabel(card.id, labelId)}
                onCreate={handleCreateLabel}
                onRename={renameLabel}
                onRecolor={setLabelColor}
                onDelete={deleteLabel}
              />
            </div>

            <CardDueDate cardId={card.id} dueDate={card.dueDate} />

            <CardCoverPicker cardId={card.id} cover={card.cover} />

            <CardChecklists
              cardId={card.id}
              checklists={card.checklists ?? []}
            />

            <CardActivityFeed
              activity={card.activity}
              createdAt={card.createdAt}
            />

            {!card.archivedAt && (
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

            <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground/70">
              <CalendarClock className="h-3.5 w-3.5" />
              {t("card.created", {
                date: formatDate(card.createdAt, lang, hour12),
              })}
              {card.updatedAt > card.createdAt
                ? ` · ${t("card.updated", { date: formatDate(card.updatedAt, lang, hour12) })}`
                : ""}
            </div>
          </div>

          <DialogFooter className="mt-2 shrink-0">
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
                  <DropdownMenuLabel>{t("card.restoreTo")}</DropdownMenuLabel>
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
            <Button
              variant="ghost"
              className="text-destructive hover:bg-destructive/10 hover:text-destructive"
              onClick={() => setConfirmDelete(true)}
            >
              <Trash2 className="h-4 w-4" />
              {card.archivedAt !== undefined
                ? t("card.deleteForever")
                : t("card.delete")}
            </Button>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              {t("card.close")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={
          card.archivedAt !== undefined
            ? t("card.deleteForeverTitle")
            : t("card.deleteTitle")
        }
        description={
          card.archivedAt !== undefined
            ? t("card.deleteForeverDescription", { title: card.title })
            : t("card.deleteDescription", { title: card.title })
        }
        confirmLabel={t("card.deleteConfirm")}
        destructive
        onConfirm={handleDelete}
      />
    </>
  );
}
