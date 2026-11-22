import {
  Archive,
  ListChecks,
  LoaderCircle,
  MoveRight,
  Tag,
  Trash2,
  UserRound,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { ConfirmDialog } from "@/components/board/ConfirmDialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/components/Toast";
import { useI18n } from "@/i18n";
import { useBoard } from "@/store/BoardContext";
import { useCardSelection } from "@/store/board-selection";
import { useBoardMembersList } from "@/store/board-live";
import { userLabel } from "@/utils/avatar";
import { createId } from "@/utils/id";
import { isEditableTarget } from "@/utils/keyboard";
import { isOverlayOpen } from "@/utils/overlay";
import { boardMoveBlockReason } from "@/utils/workflow";
import {
  LABEL_COLOR_DOT,
  LIMITS,
  type BoardAction,
  type Column,
  type Label,
} from "@janosik/shared";
import { cn } from "@/lib/utils";

interface StepResult {
  ok: boolean;
  /** False when the card was already in the requested state. */
  changed?: boolean;
  reason?: string;
}

interface Failure {
  cardId: string;
  title: string;
  reason?: string;
}

interface RunResult {
  ids: readonly string[];
  failures: Failure[];
  changed: number;
  done: number;
  total: number;
  cancelled: boolean;
}

type BulkKind = "move" | "archive" | "delete" | "label" | "assign";

const ACTION_BUTTON = "h-9 max-lg:h-11";

/** The toolbar switch that enters checkbox selection mode. */
export function BoardSelectionToggle() {
  const selection = useCardSelection();
  const { t } = useI18n();
  if (!selection.enabled) return null;
  return (
    <Button
      type="button"
      variant={selection.mode ? "secondary" : "outline"}
      size="sm"
      aria-pressed={selection.mode}
      data-testid="bulk-select-toggle"
      className={cn(ACTION_BUTTON, "gap-1.5")}
      onClick={selection.toggleMode}
    >
      <ListChecks className="h-3.5 w-3.5" aria-hidden />
      {t("bulk.select")}
      {selection.count > 0 ? (
        <span
          className="ml-0.5 rounded-full bg-primary/15 px-1.5 text-[11px] font-semibold tabular-nums text-primary"
          data-testid="bulk-select-count"
        >
          {selection.count}
        </span>
      ) : null}
    </Button>
  );
}

/**
 * A bottom-of-board bulk action bar. Each card is still one command through
 * the same `dispatch`/undo funnel as a single-card edit: the server's
 * `/commands/batch` is all-or-nothing, which would hide the exact card that a
 * workflow, WIP or permission check refused and would roll back the rest.
 * Sequential commands therefore preserve per-card progress, partial failure
 * reports and the existing undo/rollback semantics.
 */
export function BulkActionBar() {
  const { board, dispatch, roleOf } = useBoard();
  const selection = useCardSelection();
  const { t, tp } = useI18n();
  const toast = useToast();
  const members = useBoardMembersList(board?.id);

  const [busy, setBusy] = useState<{ done: number; total: number } | null>(
    null,
  );
  const [cancelling, setCancelling] = useState(false);
  const [failures, setFailures] = useState<Failure[]>([]);
  const [lastRun, setLastRun] = useState<{
    kind: BulkKind;
    changed: number;
    done: number;
    total: number;
    cancelled: boolean;
  } | null>(null);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [liveMessage, setLiveMessage] = useState("");
  const [countAnnouncement, setCountAnnouncement] = useState("");

  const cancelRef = useRef(false);
  const aliveRef = useRef(true);
  const barRef = useRef<HTMLElement | null>(null);
  const wasVisibleRef = useRef(false);
  const boardIdRef = useRef(board?.id);
  const resultSelectionRef = useRef<string | null>(null);
  const shouldRestoreFocusRef = useRef(false);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  // A batch and its result are board tasks, not view tasks: Calendar/Watch
  // disable selection but must still show progress, Cancel, and the final
  // summary/failures until the user dismisses them.
  const hasResults = lastRun !== null || failures.length > 0;
  const visible =
    busy !== null ||
    hasResults ||
    (selection.enabled && (selection.mode || selection.count > 0));
  const role = board ? roleOf(board.id) : undefined;
  const readOnly = role === "VIEWER" || board?.archivedAt !== undefined;
  const selectionKey = selection.selectedIds.join("\u0000");

  const requestCancel = useCallback(() => {
    if (busy === null) return false;
    cancelRef.current = true;
    setCancelling(true);
    return true;
  }, [busy]);

  // Focus moves with the mode: opening it lands on the bar instead of making
  // a keyboard user tab through every card; closing it returns to the
  // Select toggle (or the board main for a read-only fallback).
  const focusToggleOrMain = useCallback(() => {
    const toggle = document.querySelector<HTMLElement>(
      '[data-testid="bulk-select-toggle"]',
    );
    if (toggle !== null) {
      toggle.focus();
      return;
    }
    document.querySelector<HTMLElement>('[data-testid="board-main"]')?.focus();
  }, []);

  const resetResults = useCallback(() => {
    setFailures((previous) => (previous.length === 0 ? previous : []));
    setLastRun((previous) => (previous === null ? previous : null));
    setLiveMessage((previous) => (previous === "" ? previous : ""));
    setCountAnnouncement((previous) => (previous === "" ? previous : ""));
  }, []);

  const dismissResults = useCallback(() => {
    if (busy !== null) return;
    const willClose =
      !selection.enabled || (!selection.mode && selection.count === 0);
    if (willClose) shouldRestoreFocusRef.current = true;
    resultSelectionRef.current = null;
    resetResults();
  }, [busy, resetResults, selection.count, selection.enabled, selection.mode]);

  useEffect(() => {
    if (visible && !wasVisibleRef.current) {
      barRef.current?.focus();
    } else if (!visible && wasVisibleRef.current) {
      resetResults();
      // A view switch disables selection and may unmount the bar; the view
      // switcher keeps focus. An explicit Dismiss/Clear returns focus from
      // every view (the board main is the fallback when Select is hidden).
      if (shouldRestoreFocusRef.current || selection.enabled) {
        focusToggleOrMain();
      }
      shouldRestoreFocusRef.current = false;
    }
    wasVisibleRef.current = visible;
  }, [focusToggleOrMain, resetResults, selection.enabled, visible]);

  // Any user selection change invalidates the previous run's errors and
  // summary. A report updates the selection itself, so its exact key is
  // exempted once; a board switch always resets.
  useEffect(() => {
    if (busy !== null) return;
    if (board?.id !== boardIdRef.current) {
      boardIdRef.current = board?.id;
      resultSelectionRef.current = null;
      resetResults();
      return;
    }
    if (!selection.enabled) {
      // Calendar/Watch cannot change the selection, so the result bar is
      // authoritative there. Adopt the current key so returning to the board
      // does not mistake it for a fresh user selection.
      resultSelectionRef.current = selectionKey;
      return;
    }
    if (resultSelectionRef.current === selectionKey) {
      resultSelectionRef.current = null;
      return;
    }
    resultSelectionRef.current = null;
    resetResults();
    // `busy` is intentionally not a dependency: a run ending is not a user
    // selection change, and the report keeps its own failures.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [board?.id, resetResults, selection.enabled, selectionKey]);

  // Announce the selection count once it settles; a checkbox storm must not
  // turn into a stream of live-region messages.
  useEffect(() => {
    if (!visible || busy !== null || hasResults) return;
    const timer = window.setTimeout(() => {
      setCountAnnouncement(t("bulk.selected", { count: selection.count }));
    }, 350);
    return () => window.clearTimeout(timer);
  }, [busy, hasResults, selection.count, t, visible]);

  useEffect(() => {
    if (!visible || readOnly) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) return;
      if (isEditableTarget(event.target) || isOverlayOpen()) return;
      if (event.key === "Escape") {
        if (busy !== null) {
          event.preventDefault();
          requestCancel();
          return;
        }
        if (hasResults) {
          event.preventDefault();
          dismissResults();
          return;
        }
        if (selection.count > 0 || selection.mode) {
          event.preventDefault();
          selection.clear();
        }
        return;
      }
      if (
        busy === null &&
        (event.metaKey || event.ctrlKey) &&
        event.key.toLowerCase() === "a"
      ) {
        event.preventDefault();
        selection.selectAllVisible();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    busy,
    dismissResults,
    hasResults,
    readOnly,
    requestCancel,
    selection,
    visible,
  ]);

  const runAction = useCallback(
    async (action: BoardAction): Promise<boolean> => {
      const outcome = dispatch(action);
      return outcome === undefined ? true : await outcome;
    },
    [dispatch],
  );

  const runBatch = useCallback(
    async (
      ids: readonly string[],
      step: (cardId: string) => StepResult | Promise<StepResult>,
    ): Promise<RunResult> => {
      cancelRef.current = false;
      setCancelling(false);
      setFailures([]);
      setLastRun(null);
      setBusy({ done: 0, total: ids.length });
      setLiveMessage(tp("bulk.started", ids.length));
      const cardFailures: Failure[] = [];
      let changed = 0;
      let done = 0;

      for (const cardId of ids) {
        if (cancelRef.current || !aliveRef.current) break;
        const title = board?.cards[cardId]?.title ?? cardId;
        let result: StepResult;
        try {
          result = await step(cardId);
        } catch {
          result = { ok: false };
        }
        if (!result.ok) {
          cardFailures.push({
            cardId,
            title,
            reason: result.reason ?? t("bulk.rejected"),
          });
        } else if (result.changed !== false) {
          changed += 1;
        }
        done += 1;
        if (aliveRef.current) setBusy({ done, total: ids.length });
      }

      const cancelled = cancelRef.current && done < ids.length;
      cancelRef.current = false;
      const result: RunResult = {
        ids,
        failures: cardFailures,
        changed,
        done,
        total: ids.length,
        cancelled,
      };
      if (aliveRef.current) {
        setBusy(null);
        setCancelling(false);
        setFailures(cardFailures);
      }
      return result;
    },
    [board, t, tp],
  );

  const report = useCallback(
    (
      kind: BulkKind,
      result: RunResult,
      destructive = false,
      successKey?: "bulk.unassigned",
    ) => {
      if (!aliveRef.current) return;
      setLastRun({
        kind,
        changed: result.changed,
        done: result.done,
        total: result.total,
        cancelled: result.cancelled,
      });
      setLiveMessage(
        result.cancelled
          ? t("bulk.cancelled", { done: result.done, total: result.total })
          : `${t("bulk.changedOf", {
              changed: result.changed,
              total: result.total,
            })}${
              result.failures.length > 0
                ? ` ${tp("bulk.failed", result.failures.length)}`
                : ""
            }`,
      );
      let nextSelection: string[] | null = null;
      if (result.cancelled) {
        // Cancel keeps both the refused cards and everything the run never
        // reached; successful earlier cards are not silently re-included.
        const failed = new Set(
          result.failures.map((failure) => failure.cardId),
        );
        nextSelection = result.ids.filter(
          (id, index) => index >= result.done || failed.has(id),
        );
      } else if (destructive) {
        nextSelection =
          result.failures.length === 0
            ? []
            : result.failures.map((failure) => failure.cardId);
      }
      if (nextSelection !== null) {
        // Calendar/Watch disable selection: the provider cannot hold the
        // failed ids there, so exempt the current (empty) key instead of a
        // key the selection will never adopt. The result bar persists.
        resultSelectionRef.current = selection.enabled
          ? nextSelection.join("\u0000")
          : selectionKey;
        if (nextSelection.length === 0) selection.clear();
        else selection.replace(nextSelection);
      }
      if (result.changed > 0) {
        toast.success(
          tp(
            successKey ??
              (kind === "move"
                ? "bulk.moved"
                : kind === "archive"
                  ? "bulk.archived"
                  : kind === "delete"
                    ? "bulk.deleted"
                    : kind === "label"
                      ? "bulk.labelled"
                      : "bulk.assigned"),
            result.changed,
          ),
        );
      } else if (result.failures.length === 0) {
        toast.info(t("bulk.noChanges"));
      }
      if (result.failures.length > 0 && result.changed === 0) {
        toast.error(tp("bulk.failed", result.failures.length));
      }
      if (result.cancelled && result.done < result.total) {
        toast.info(
          t("bulk.cancelled", { done: result.done, total: result.total }),
        );
      }
    },
    [selection, selectionKey, t, toast, tp],
  );

  const moveSelected = useCallback(
    async (column: Column) => {
      const currentBoard = board;
      if (!currentBoard) return;
      const target = currentBoard.columns.find(
        (entry) => entry.id === column.id,
      );
      if (!target) return;
      const ids = [...selection.selectedIds];
      let free =
        (target.wipLimit ?? LIMITS.cardsPerColumn) - target.cardIds.length;
      let appendIndex = target.cardIds.length;

      const result = await runBatch(ids, async (cardId) => {
        const card = currentBoard.cards[cardId];
        const from = currentBoard.columns.find((entry) =>
          entry.cardIds.includes(cardId),
        );
        if (!card || !from) {
          return { ok: false, reason: t("card.notFound") };
        }
        if (from.id === target.id) return { ok: true, changed: false };
        const reason = boardMoveBlockReason(
          currentBoard,
          cardId,
          target,
          role,
          t,
        );
        if (reason !== null) return { ok: false, reason };
        if (free <= 0) {
          return {
            ok: false,
            reason:
              target.wipLimit !== undefined
                ? t("workflow.blocked.wip", {
                    title: target.title,
                    limit: target.wipLimit,
                  })
                : t("limits.maxItems", { limit: LIMITS.cardsPerColumn }),
          };
        }
        const ok = await runAction({
          type: "MOVE_CARD",
          cardId,
          fromColumnId: from.id,
          fromIndex: Math.max(0, from.cardIds.indexOf(cardId)),
          toColumnId: target.id,
          toIndex: appendIndex,
          activityIds: [createId()],
          at: Date.now(),
        });
        if (ok) {
          free -= 1;
          appendIndex += 1;
        }
        return { ok, changed: ok };
      });
      report("move", result);
    },
    [board, report, role, runAction, runBatch, selection.selectedIds, t],
  );

  const archiveSelected = useCallback(async () => {
    const ids = [...selection.selectedIds];
    const result = await runBatch(ids, async (cardId) => {
      if (!board?.cards[cardId]) {
        return { ok: false, reason: t("card.notFound") };
      }
      const ok = await runAction({
        type: "ARCHIVE_CARD",
        cardId,
        activityIds: [createId()],
        at: Date.now(),
      });
      return { ok, changed: ok };
    });
    report("archive", result, true);
  }, [board?.cards, report, runAction, runBatch, selection.selectedIds, t]);

  const deleteSelected = useCallback(async () => {
    const ids = [...selection.selectedIds];
    const result = await runBatch(ids, async (cardId) => {
      if (!board?.cards[cardId]) {
        return { ok: false, reason: t("card.notFound") };
      }
      const ok = await runAction({
        type: "DELETE_CARD",
        cardId,
        at: Date.now(),
      });
      return { ok, changed: ok };
    });
    report("delete", result, true);
  }, [board?.cards, report, runAction, runBatch, selection.selectedIds, t]);

  const applyLabel = useCallback(
    async (label: Label) => {
      const currentBoard = board;
      if (!currentBoard) return;
      const ids = [...selection.selectedIds];
      const allHave = ids.every((id) =>
        currentBoard.cards[id]?.labelIds.includes(label.id),
      );
      const on = !allHave;

      const result = await runBatch(ids, async (cardId) => {
        const card = currentBoard.cards[cardId];
        if (!card) return { ok: false, reason: t("card.notFound") };
        if (card.labelIds.includes(label.id) === on) {
          return { ok: true, changed: false };
        }
        if (on && card.labelIds.length >= LIMITS.labelsPerCard) {
          return {
            ok: false,
            reason: t("limits.maxLabelsOnCard", {
              limit: LIMITS.labelsPerCard,
            }),
          };
        }
        const ok = await runAction({
          type: "SET_CARD_LABEL",
          cardId,
          labelId: label.id,
          on,
          activityIds: [createId()],
          at: Date.now(),
        });
        return { ok, changed: ok };
      });
      report("label", result);
    },
    [board, report, runAction, runBatch, selection.selectedIds, t],
  );

  const applyAssignee = useCallback(
    async (assigneeId: string | null) => {
      const currentBoard = board;
      if (!currentBoard) return;
      const ids = [...selection.selectedIds];

      const result = await runBatch(ids, async (cardId) => {
        const card = currentBoard.cards[cardId];
        if (!card) return { ok: false, reason: t("card.notFound") };
        if ((card.assigneeId ?? null) === assigneeId) {
          return { ok: true, changed: false };
        }
        const ok = await runAction({
          type: "SET_CARD_ASSIGN",
          cardId,
          assigneeId,
          activityIds: [createId()],
          at: Date.now(),
        });
        return { ok, changed: ok };
      });
      report(
        "assign",
        result,
        false,
        assigneeId === null ? "bulk.unassigned" : undefined,
      );
    },
    [board, report, runAction, runBatch, selection.selectedIds, t],
  );

  const labels = board?.labels ?? [];
  const selectedIds = new Set(selection.selectedIds);
  const selectedCards = selection.selectedIds
    .map((id) => board?.cards[id])
    .filter((card) => card !== undefined);
  const allUnassigned =
    selectedCards.length > 0 && selectedCards.every((card) => !card.assigneeId);
  const someUnassigned = selectedCards.some((card) => !card.assigneeId);
  const allSelectedIn = (column: Column) =>
    selectedIds.size > 0 &&
    column.cardIds.filter((id) => selectedIds.has(id)).length ===
      selectedIds.size;

  if (!board || !visible || (readOnly && busy === null)) return null;

  const displayedCount = busy?.total ?? selection.count;
  const busyLabel =
    busy === null
      ? null
      : cancelling
        ? t("bulk.cancelling")
        : t("bulk.progress", { done: busy.done, total: busy.total });
  const idleLabel =
    lastRun === null
      ? selection.mode
        ? t("bulk.selectionHint")
        : ""
      : lastRun.cancelled && lastRun.done < lastRun.total
        ? t("bulk.cancelled", {
            done: lastRun.done,
            total: lastRun.total,
          })
        : t("bulk.changedOf", {
            changed: lastRun.changed,
            total: lastRun.total,
          });

  return (
    <section
      ref={barRef}
      tabIndex={-1}
      role="region"
      aria-label={t("bulk.region")}
      data-testid="bulk-bar"
      className="mt-3 flex flex-col gap-2 rounded-xl border border-border/70 bg-card/95 p-2 shadow-lg outline-none backdrop-blur-sm focus-visible:ring-2 focus-visible:ring-ring sm:p-3"
    >
      <span
        role="status"
        aria-live="polite"
        data-testid="bulk-count-announcement"
        className="sr-only"
      >
        {countAnnouncement}
      </span>
      <span
        role="status"
        aria-live="polite"
        data-testid="bulk-phase-announcement"
        className="sr-only"
      >
        {liveMessage}
      </span>
      <div className="flex flex-wrap items-center gap-2">
        {displayedCount > 0 ? (
          <span
            data-testid="bulk-count"
            className="inline-flex h-8 items-center rounded-full bg-primary/10 px-2.5 text-sm font-semibold tabular-nums text-primary"
          >
            {t("bulk.selected", { count: displayedCount })}
          </span>
        ) : null}

        <Button
          type="button"
          variant="outline"
          size="sm"
          data-testid="bulk-select-all"
          className={ACTION_BUTTON}
          title={
            selection.visibleIds.length > selection.cap
              ? t("bulk.cap", { count: selection.cap })
              : undefined
          }
          disabled={
            !selection.enabled ||
            busy !== null ||
            selection.visibleIds.length === 0 ||
            selection.count ===
              Math.min(selection.visibleIds.length, selection.cap)
          }
          onClick={selection.selectAllVisible}
        >
          {selection.visibleIds.length > selection.cap
            ? t("bulk.selectFirst", { count: selection.cap })
            : t("bulk.selectAll")}
        </Button>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="sm"
                data-testid="bulk-move"
                className={cn(ACTION_BUTTON, "gap-1.5")}
                disabled={
                  !selection.enabled || busy !== null || selection.count === 0
                }
              >
                <MoveRight className="h-3.5 w-3.5" aria-hidden />
                {t("bulk.move")}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="max-h-72 overflow-y-auto"
            >
              <DropdownMenuLabel>{t("bulk.moveTo")}</DropdownMenuLabel>
              {board.columns.map((column) => (
                <DropdownMenuItem
                  key={column.id}
                  data-testid={`bulk-move-${column.id}`}
                  disabled={allSelectedIn(column)}
                  onSelect={() => void moveSelected(column)}
                >
                  <span className="min-w-0 flex-1 truncate">
                    {column.title}
                  </span>
                  <span className="ml-2 text-xs tabular-nums text-muted-foreground">
                    {column.cardIds.length}
                    {column.wipLimit !== undefined ? `/${column.wipLimit}` : ""}
                  </span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="sm"
                data-testid="bulk-label"
                className={cn(ACTION_BUTTON, "gap-1.5")}
                disabled={
                  !selection.enabled || busy !== null || selection.count === 0
                }
              >
                <Tag className="h-3.5 w-3.5" aria-hidden />
                {t("bulk.label")}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="max-h-72 overflow-y-auto"
            >
              <DropdownMenuLabel>{t("bulk.labelAction")}</DropdownMenuLabel>
              {labels.length === 0 ? (
                <DropdownMenuItem disabled>
                  {t("bulk.noLabels")}
                </DropdownMenuItem>
              ) : (
                labels.map((label) => {
                  const allHave =
                    selectedCards.length > 0 &&
                    selectedCards.every((card) =>
                      card.labelIds.includes(label.id),
                    );
                  const someHave = selectedCards.some((card) =>
                    card.labelIds.includes(label.id),
                  );
                  return (
                    <DropdownMenuCheckboxItem
                      key={label.id}
                      checked={
                        allHave ? true : someHave ? "indeterminate" : false
                      }
                      onCheckedChange={() => void applyLabel(label)}
                    >
                      <span
                        aria-hidden
                        className={cn(
                          "h-2.5 w-2.5 rounded-full",
                          LABEL_COLOR_DOT[label.color],
                        )}
                      />
                      <span className="min-w-0 flex-1 truncate">
                        {label.name}
                      </span>
                      <span className="sr-only">
                        {allHave
                          ? t("bulk.applied")
                          : someHave
                            ? t("bulk.partiallyApplied")
                            : t("bulk.notApplied")}
                      </span>
                    </DropdownMenuCheckboxItem>
                  );
                })
              )}
            </DropdownMenuContent>
          </DropdownMenu>

          {members.length > 0 ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  data-testid="bulk-assign"
                  className={cn(ACTION_BUTTON, "gap-1.5")}
                  disabled={
                    !selection.enabled || busy !== null || selection.count === 0
                  }
                >
                  <UserRound className="h-3.5 w-3.5" aria-hidden />
                  {t("bulk.assign")}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
                className="max-h-72 overflow-y-auto"
              >
                <DropdownMenuLabel>{t("bulk.assignAction")}</DropdownMenuLabel>
                <DropdownMenuCheckboxItem
                  checked={
                    allUnassigned
                      ? true
                      : someUnassigned
                        ? "indeterminate"
                        : false
                  }
                  onCheckedChange={() => void applyAssignee(null)}
                >
                  <span className="min-w-0 flex-1 truncate">
                    {t("bulk.unassign")}
                  </span>
                  <span className="sr-only">
                    {allUnassigned
                      ? t("bulk.applied")
                      : someUnassigned
                        ? t("bulk.partiallyApplied")
                        : t("bulk.notApplied")}
                  </span>
                </DropdownMenuCheckboxItem>
                <DropdownMenuSeparator />
                {members.map((member) => {
                  const name = userLabel(member.displayName, member.email);
                  const allAssigned =
                    selectedCards.length > 0 &&
                    selectedCards.every(
                      (card) => card.assigneeId === member.userId,
                    );
                  const someAssigned = selectedCards.some(
                    (card) => card.assigneeId === member.userId,
                  );
                  return (
                    <DropdownMenuCheckboxItem
                      key={member.userId}
                      checked={
                        allAssigned
                          ? true
                          : someAssigned
                            ? "indeterminate"
                            : false
                      }
                      onCheckedChange={() => void applyAssignee(member.userId)}
                    >
                      <span className="min-w-0 flex-1 truncate">{name}</span>
                      <span className="sr-only">
                        {allAssigned
                          ? t("bulk.applied")
                          : someAssigned
                            ? t("bulk.partiallyApplied")
                            : t("bulk.notApplied")}
                      </span>
                    </DropdownMenuCheckboxItem>
                  );
                })}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}

          <Button
            type="button"
            variant="outline"
            size="sm"
            data-testid="bulk-archive"
            className={cn(ACTION_BUTTON, "gap-1.5")}
            disabled={
              !selection.enabled || busy !== null || selection.count === 0
            }
            onClick={() => setArchiveOpen(true)}
          >
            <Archive className="h-3.5 w-3.5" aria-hidden />
            {t("bulk.archive")}
          </Button>
          <Button
            type="button"
            variant="destructive"
            size="sm"
            data-testid="bulk-delete"
            className={cn(ACTION_BUTTON, "gap-1.5")}
            disabled={
              !selection.enabled || busy !== null || selection.count === 0
            }
            onClick={() => setDeleteOpen(true)}
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden />
            {t("bulk.delete")}
          </Button>
          {hasResults && busy === null ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              data-testid="bulk-dismiss"
              className={cn(ACTION_BUTTON, "gap-1.5")}
              onClick={dismissResults}
            >
              <X className="h-3.5 w-3.5" aria-hidden />
              {t("bulk.dismissResults")}
            </Button>
          ) : null}
          {busy !== null || selection.enabled ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              data-testid="bulk-clear"
              className={cn(ACTION_BUTTON, "gap-1.5")}
              disabled={
                busy === null && selection.count === 0 && !selection.mode
              }
              onClick={() => {
                if (requestCancel()) return;
                selection.clear();
              }}
            >
              {busy !== null ? (
                <LoaderCircle
                  className="h-3.5 w-3.5 animate-spin"
                  aria-hidden
                />
              ) : (
                <X className="h-3.5 w-3.5" aria-hidden />
              )}
              {busy !== null ? t("bulk.cancel") : t("bulk.clear")}
            </Button>
          ) : null}
        </div>
      </div>

      {busy !== null ? (
        <div className="flex items-center gap-2">
          <div
            role="progressbar"
            aria-label={t("bulk.progressLabel")}
            aria-valuemin={0}
            aria-valuemax={busy.total}
            aria-valuenow={busy.done}
            data-testid="bulk-progress"
            className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-muted"
          >
            <div
              className="h-full rounded-full bg-primary transition-[width]"
              style={{
                width: `${busy.total === 0 ? 0 : (busy.done / busy.total) * 100}%`,
              }}
            />
          </div>
          <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
            {t("bulk.progress", { done: busy.done, total: busy.total })}
          </span>
        </div>
      ) : null}

      <p data-testid="bulk-status" className="text-xs text-muted-foreground">
        {busyLabel ?? idleLabel}
        {lastRun !== null && lastRun.changed > 1 ? (
          <span className="ml-1">{t("bulk.undoHint")}</span>
        ) : null}
      </p>

      {failures.length > 0 ? (
        <div
          role="alert"
          data-testid="bulk-errors"
          className="rounded-lg border border-danger/30 bg-danger/10 px-2.5 py-2 text-xs text-(--chip-red)"
        >
          <p className="font-semibold">{tp("bulk.failed", failures.length)}</p>
          <ul
            tabIndex={0}
            aria-label={t("bulk.failureList")}
            data-testid="bulk-failure-list"
            className="mt-1 max-h-40 space-y-0.5 overflow-y-auto overscroll-contain rounded pr-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {failures.map((failure) => (
              <li key={failure.cardId} className="break-words">
                <span className="font-medium">{failure.title}</span>
                {failure.reason !== undefined ? (
                  <span className="text-muted-foreground">
                    {" — "}
                    {failure.reason}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <ConfirmDialog
        open={archiveOpen}
        onOpenChange={setArchiveOpen}
        title={tp("bulk.archiveTitle", selection.count)}
        description={tp("bulk.archiveDescription", selection.count)}
        confirmLabel={t("bulk.archive")}
        onConfirm={() => void archiveSelected()}
        onClosed={() => barRef.current?.focus()}
      />
      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={tp("bulk.deleteTitle", selection.count)}
        description={tp("bulk.deleteDescription", selection.count)}
        confirmLabel={t("bulk.delete")}
        destructive
        onConfirm={() => void deleteSelected()}
        onClosed={() => barRef.current?.focus()}
      />
    </section>
  );
}
