import {
  Archive,
  Check,
  ListChecks,
  LoaderCircle,
  MoveRight,
  Plus,
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
import { Input } from "@/components/ui/input";
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
type BarFocusTarget = "dismiss" | "clear" | "first";

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
  const { board, dispatch, roleOf, addColumn, addLabel } = useBoard();
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
  // Destructive delete is armed in place: the trash turns into a red check
  // and a cancel icon. No modal, one deliberate second click.
  const [deleteArmed, setDeleteArmed] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [labelOpen, setLabelOpen] = useState(false);
  const [columnCreating, setColumnCreating] = useState(false);
  const [columnDraft, setColumnDraft] = useState("");
  const [labelCreating, setLabelCreating] = useState(false);
  const [labelDraft, setLabelDraft] = useState("");
  const [liveMessage, setLiveMessage] = useState("");
  const [countAnnouncement, setCountAnnouncement] = useState<{
    count: number;
    text: string;
  } | null>(null);

  const cancelRef = useRef(false);
  const aliveRef = useRef(true);
  const barRef = useRef<HTMLElement | null>(null);
  const deleteConfirmRef = useRef<HTMLButtonElement>(null);
  const deleteTriggerRef = useRef<HTMLButtonElement>(null);
  const wasVisibleRef = useRef(false);
  const boardIdRef = useRef(board?.id);
  const shouldRestoreFocusRef = useRef(false);
  const pendingBarFocusRef = useRef<BarFocusTarget | null>(null);
  const hadBarFocusRef = useRef(false);
  const lastBarFocusRef = useRef<HTMLElement | null>(null);
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

  const requestCancel = useCallback(() => {
    if (busy === null) return false;
    cancelRef.current = true;
    setCancelling(true);
    // Calendar/Watch remove Cancel when the run ends; land on Dismiss.
    if (!selection.enabled) pendingBarFocusRef.current = "dismiss";
    return true;
  }, [busy, selection.enabled]);

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

  /**
   * Keep keyboard focus inside a bar that stays open while its focused
   * control disappears or becomes disabled (Cancel → Dismiss, Dismiss with a
   * selection → Clear, Clear with results → Dismiss).
   */
  const focusSurvivingBarControl = useCallback(
    (target: BarFocusTarget): boolean => {
      const root = barRef.current;
      if (root === null) return false;
      const selector =
        target === "dismiss"
          ? '[data-testid="bulk-dismiss"]'
          : target === "clear"
            ? '[data-testid="bulk-clear"]'
            : "button";
      const preferred = root.querySelector<HTMLElement>(
        `${selector}:not(:disabled)`,
      );
      if (preferred !== null) {
        preferred.focus();
        return true;
      }
      if (target === "dismiss") {
        // The result bar has not rendered yet; retry after the next commit.
        return false;
      }
      const fallback =
        root.querySelector<HTMLElement>(
          '[data-testid="bulk-dismiss"]:not(:disabled)',
        ) ??
        root.querySelector<HTMLElement>(
          '[data-testid="bulk-clear"]:not(:disabled)',
        ) ??
        root.querySelector<HTMLElement>("button:not(:disabled)");
      if (fallback !== null) {
        fallback.focus();
        return true;
      }
      root.focus();
      return true;
    },
    [],
  );

  // Keep the fixed toast stack above the in-flow result bar. The bar can
  // wrap to several rows on phones, so measure it and publish the reserved
  // height as a CSS variable consumed by the toast viewport.
  useEffect(() => {
    const root = document.documentElement;
    const bar = barRef.current;
    if (!visible || bar === null) {
      root.style.removeProperty("--janosik-bulk-bar-inset");
      return;
    }
    const update = () => {
      const height = Math.ceil(bar.getBoundingClientRect().height);
      root.style.setProperty("--janosik-bulk-bar-inset", `${height + 12}px`);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(bar);
    return () => {
      observer.disconnect();
      root.style.removeProperty("--janosik-bulk-bar-inset");
    };
  }, [board?.id, visible]);

  // A changed selection or board means the armed delete no longer names what
  // the user saw when they armed it.
  useEffect(() => {
    setDeleteArmed(false);
  }, [board?.id, selection.count]);

  useEffect(() => {
    if (deleteArmed) deleteConfirmRef.current?.focus();
  }, [deleteArmed]);

  const resetResults = useCallback(() => {
    setFailures((previous) => (previous.length === 0 ? previous : []));
    setLastRun((previous) => (previous === null ? previous : null));
    setLiveMessage((previous) => (previous === "" ? previous : ""));
    // Keep the count announcement: dismissing results while a selection
    // remains must not re-announce the unchanged count.
  }, []);

  const dismissResults = useCallback(() => {
    if (busy !== null) return;
    const willClose =
      !selection.enabled || (!selection.mode && selection.count === 0);
    if (willClose) shouldRestoreFocusRef.current = true;
    else pendingBarFocusRef.current = "clear";
    resetResults();
  }, [busy, resetResults, selection.count, selection.enabled, selection.mode]);

  useEffect(() => {
    if (
      visible &&
      !wasVisibleRef.current &&
      selection.enabled &&
      pendingBarFocusRef.current === null
    ) {
      barRef.current?.focus();
    } else if (!visible && wasVisibleRef.current) {
      pendingBarFocusRef.current = null;
      resetResults();
      // The bar is gone; a later selection of the same size must announce.
      setCountAnnouncement(null);
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

  // Runs after the open/close focus pass so a surviving-control target wins
  // even when a transient busy→result render briefly reopens the bar.
  useEffect(() => {
    const target = pendingBarFocusRef.current;
    if (target === null) return;
    if (focusSurvivingBarControl(target)) pendingBarFocusRef.current = null;
  });

  // A control can disappear before React tracks any pending target (a run
  // finishing across a slow commit). If the focused bar element is detached
  // and focus fell to <body>, recover into the surviving control.
  useEffect(() => {
    if (!visible) return;
    const last = lastBarFocusRef.current;
    if (last === null || last.isConnected) return;
    if (document.activeElement !== document.body) return;
    const target: BarFocusTarget = hasResults
      ? "dismiss"
      : selection.enabled && (selection.mode || selection.count > 0)
        ? "clear"
        : "first";
    if (focusSurvivingBarControl(target)) lastBarFocusRef.current = null;
  });

  // Results survive a view switch (selection is disabled there) and a
  // selection change; only a board switch or the explicit Dismiss/Clear/new
  // run paths reset them.
  useEffect(() => {
    if (board?.id === boardIdRef.current) return;
    boardIdRef.current = board?.id;
    resetResults();
  }, [board?.id, resetResults]);

  // Announce the selection count once it settles; a checkbox storm must not
  // turn into a stream of live-region messages.
  useEffect(() => {
    if (!visible) return;
    // A destructive run may empty the selection while still busy; clear the
    // stale text before the busy guard so a new selection cannot flash it.
    if (selection.count === 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- clearing a stale live-region text is the required effect
      setCountAnnouncement((previous) => (previous === null ? previous : null));
      return;
    }
    if (busy !== null) return;
    const count = selection.count;
    const timer = window.setTimeout(() => {
      setCountAnnouncement({
        count,
        text: t("bulk.selected", { count }),
      });
    }, 350);
    return () => window.clearTimeout(timer);
  }, [busy, selection.count, t, visible]);

  useEffect(() => {
    // Listen while the board/table can select (so Ctrl+A can enter the mode)
    // and while any result bar is visible in Calendar/Watch (Escape dismiss).
    if (readOnly || (!visible && !selection.enabled)) return;
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
        selection.enabled &&
        (event.metaKey || event.ctrlKey) &&
        event.key.toLowerCase() === "a"
      ) {
        event.preventDefault();
        if (!selection.mode) selection.setMode(true);
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
      // Calendar/Watch remove Cancel when the run ends. If the run took the
      // focus (Cancel, or confirmation's onClosed), land on Dismiss even when
      // a transient busy→result commit briefly closed the bar first.
      if (hadBarFocusRef.current && !selection.enabled) {
        pendingBarFocusRef.current = "dismiss";
      }
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
    [selection, t, toast, tp],
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

  const createColumn = useCallback(() => {
    const title = columnDraft.trim();
    if (!title) return;
    addColumn(title);
    setColumnDraft("");
    setColumnCreating(false);
    setMoveOpen(false);
  }, [addColumn, columnDraft]);

  const createLabel = useCallback(() => {
    const name = labelDraft.trim();
    if (!name) return;
    addLabel({ id: createId(), name, color: "brand" });
    setLabelDraft("");
    setLabelCreating(false);
    setLabelOpen(false);
  }, [addLabel, labelDraft]);

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
      onFocusCapture={(event) => {
        hadBarFocusRef.current = true;
        lastBarFocusRef.current = event.target as HTMLElement;
      }}
      onBlurCapture={(event) => {
        const next = event.relatedTarget as Node | null;
        const last = lastBarFocusRef.current;
        if (next !== null && !event.currentTarget.contains(next)) {
          hadBarFocusRef.current = false;
          lastBarFocusRef.current = null;
        } else if (next === null && last !== null && last.isConnected) {
          // Focus moved to the page background while the control still
          // exists: a deliberate click-away, not a disappearing control.
          hadBarFocusRef.current = false;
          lastBarFocusRef.current = null;
        }
      }}
      className="mt-3 flex flex-col gap-2 rounded-xl border border-border/70 bg-card/95 p-2 shadow-lg outline-none backdrop-blur-sm focus-visible:ring-2 focus-visible:ring-ring sm:p-3"
    >
      <span
        role="status"
        aria-live="polite"
        data-testid="bulk-count-announcement"
        className="sr-only"
      >
        {selection.count > 0 && countAnnouncement?.count === selection.count
          ? countAnnouncement.text
          : ""}
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
          <DropdownMenu
            open={moveOpen}
            onOpenChange={(next) => {
              setMoveOpen(next);
              if (!next) {
                setColumnCreating(false);
                setColumnDraft("");
              }
            }}
          >
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
              <DropdownMenuSeparator />
              {columnCreating ? (
                <div
                  className="space-y-1.5 p-1.5"
                  onClick={(event) => event.stopPropagation()}
                  onKeyDown={(event) => event.stopPropagation()}
                >
                  <Input
                    autoFocus
                    name="bulk-new-column"
                    value={columnDraft}
                    maxLength={LIMITS.columnTitle}
                    onChange={(event) => setColumnDraft(event.target.value)}
                    onKeyDown={(event) => {
                      event.stopPropagation();
                      if (event.key === "Enter") {
                        event.preventDefault();
                        createColumn();
                      }
                      if (event.key === "Escape") {
                        event.preventDefault();
                        setColumnCreating(false);
                        setColumnDraft("");
                      }
                    }}
                    placeholder={t("column.placeholder")}
                    className="h-8"
                  />
                  <div className="flex items-center gap-1.5">
                    <Button
                      size="sm"
                      data-testid="bulk-create-column"
                      onClick={createColumn}
                      disabled={!columnDraft.trim()}
                    >
                      {t("column.add")}
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label={t("common.cancel")}
                      onClick={() => {
                        setColumnCreating(false);
                        setColumnDraft("");
                      }}
                      className="h-7 w-7"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ) : (
                <DropdownMenuItem
                  data-testid="bulk-new-column-trigger"
                  onSelect={(event) => {
                    event.preventDefault();
                    setColumnCreating(true);
                  }}
                >
                  <Plus className="h-4 w-4" aria-hidden />
                  {t("column.add")}
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>

          <DropdownMenu
            open={labelOpen}
            onOpenChange={(next) => {
              setLabelOpen(next);
              if (!next) {
                setLabelCreating(false);
                setLabelDraft("");
              }
            }}
          >
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
              <DropdownMenuSeparator />
              {labelCreating ? (
                <div
                  className="space-y-1.5 p-1.5"
                  onClick={(event) => event.stopPropagation()}
                  onKeyDown={(event) => event.stopPropagation()}
                >
                  <Input
                    autoFocus
                    name="bulk-new-label"
                    value={labelDraft}
                    maxLength={LIMITS.labelName}
                    onChange={(event) => setLabelDraft(event.target.value)}
                    onKeyDown={(event) => {
                      event.stopPropagation();
                      if (event.key === "Enter") {
                        event.preventDefault();
                        createLabel();
                      }
                      if (event.key === "Escape") {
                        event.preventDefault();
                        setLabelCreating(false);
                        setLabelDraft("");
                      }
                    }}
                    placeholder={t("label.namePlaceholder")}
                    className="h-8"
                  />
                  <div className="flex items-center gap-1.5">
                    <Button
                      size="sm"
                      data-testid="bulk-create-label"
                      onClick={createLabel}
                      disabled={!labelDraft.trim()}
                    >
                      {t("label.create")}
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label={t("common.cancel")}
                      onClick={() => {
                        setLabelCreating(false);
                        setLabelDraft("");
                      }}
                      className="h-7 w-7"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ) : (
                <DropdownMenuItem
                  data-testid="bulk-new-label-trigger"
                  disabled={labels.length >= LIMITS.labelsPerBoard}
                  onSelect={(event) => {
                    event.preventDefault();
                    setLabelCreating(true);
                  }}
                >
                  <Plus className="h-4 w-4" aria-hidden />
                  {t("label.new")}
                </DropdownMenuItem>
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
          {deleteArmed ? (
            <div className="flex items-center gap-1">
              <Button
                ref={deleteConfirmRef}
                type="button"
                variant="destructive"
                size="icon"
                data-testid="bulk-delete-confirm"
                className="h-9 w-9 max-lg:h-11 max-lg:w-11"
                aria-label={tp("bulk.deleteTitle", displayedCount)}
                title={tp("bulk.deleteTitle", displayedCount)}
                disabled={
                  !selection.enabled || busy !== null || selection.count === 0
                }
                onClick={() => {
                  setDeleteArmed(false);
                  void deleteSelected();
                }}
              >
                <Check className="h-4 w-4" aria-hidden />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                data-testid="bulk-delete-cancel"
                className="h-9 w-9 max-lg:h-11 max-lg:w-11"
                aria-label={t("common.cancel")}
                title={t("common.cancel")}
                onClick={() => {
                  setDeleteArmed(false);
                  deleteTriggerRef.current?.focus();
                }}
              >
                <X className="h-4 w-4" aria-hidden />
              </Button>
            </div>
          ) : (
            <Button
              ref={deleteTriggerRef}
              type="button"
              variant="destructive"
              size="sm"
              data-testid="bulk-delete"
              className={cn(ACTION_BUTTON, "gap-1.5")}
              disabled={
                !selection.enabled || busy !== null || selection.count === 0
              }
              onClick={() => setDeleteArmed(true)}
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden />
              {t("bulk.delete")}
            </Button>
          )}
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
          {busy !== null || (selection.enabled && !deleteArmed) ? (
            <Button
              type="button"
              variant="ghost"
              size={busy !== null ? "sm" : "icon"}
              data-testid="bulk-clear"
              className={cn(
                busy !== null
                  ? cn(ACTION_BUTTON, "gap-1.5")
                  : "h-9 w-9 max-lg:h-11 max-lg:w-11",
              )}
              aria-label={busy !== null ? t("bulk.cancel") : t("bulk.clear")}
              title={busy !== null ? t("bulk.cancel") : t("bulk.clear")}
              disabled={
                busy === null && selection.count === 0 && !selection.mode
              }
              onClick={() => {
                if (requestCancel()) return;
                if (hasResults) pendingBarFocusRef.current = "dismiss";
                selection.clear();
              }}
            >
              {busy !== null ? (
                <>
                  <LoaderCircle
                    className="h-3.5 w-3.5 animate-spin"
                    aria-hidden
                  />
                  {t("bulk.cancel")}
                </>
              ) : (
                <X className="h-4 w-4" aria-hidden />
              )}
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
    </section>
  );
}
