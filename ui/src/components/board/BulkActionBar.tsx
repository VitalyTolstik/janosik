import {
  Archive,
  Check,
  ListChecks,
  LoaderCircle,
  Minus,
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

  const cancelRef = useRef(false);
  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const visible = selection.enabled && (selection.mode || selection.count > 0);
  const role = board ? roleOf(board.id) : undefined;
  const readOnly = role === "VIEWER" || board?.archivedAt !== undefined;

  useEffect(() => {
    if (!visible || readOnly) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) return;
      if (isEditableTarget(event.target) || isOverlayOpen()) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "a") {
        event.preventDefault();
        selection.selectAllVisible();
        return;
      }
      if (event.key === "Escape" && (selection.count > 0 || selection.mode)) {
        event.preventDefault();
        selection.clear();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [readOnly, selection, visible]);

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
            ...(result.reason !== undefined ? { reason: result.reason } : {}),
          });
        } else if (result.changed !== false) {
          changed += 1;
        }
        done += 1;
        if (aliveRef.current) setBusy({ done, total: ids.length });
      }

      const result: RunResult = {
        failures: cardFailures,
        changed,
        done,
        total: ids.length,
        cancelled: cancelRef.current,
      };
      if (aliveRef.current) {
        setBusy(null);
        setCancelling(false);
        setFailures(cardFailures);
      }
      return result;
    },
    [board],
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
      if (destructive) {
        if (result.failures.length === 0) selection.clear();
        else
          selection.replace(result.failures.map((failure) => failure.cardId));
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
  const allSelectedIn = (column: Column) =>
    selectedIds.size > 0 &&
    column.cardIds.filter((id) => selectedIds.has(id)).length ===
      selectedIds.size;

  if (!board || !visible || readOnly) return null;

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
      role="region"
      aria-label={t("bulk.region")}
      aria-busy={busy !== null}
      data-testid="bulk-bar"
      className="mt-3 flex flex-col gap-2 rounded-xl border border-border/70 bg-card/95 p-2 shadow-lg backdrop-blur-sm sm:p-3"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span
          data-testid="bulk-count"
          className="inline-flex h-8 items-center rounded-full bg-primary/10 px-2.5 text-sm font-semibold tabular-nums text-primary"
        >
          {t("bulk.selected", { count: selection.count })}
        </span>

        <Button
          type="button"
          variant="outline"
          size="sm"
          data-testid="bulk-select-all"
          className={ACTION_BUTTON}
          disabled={
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
        <span className="text-xs text-muted-foreground">
          {t("bulk.cap", { count: selection.cap })}
        </span>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="sm"
                data-testid="bulk-move"
                className={cn(ACTION_BUTTON, "gap-1.5")}
                disabled={busy !== null || selection.count === 0}
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
                disabled={busy !== null || selection.count === 0}
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
                  const selectedCards = [...selectedIds].map(
                    (id) => board.cards[id],
                  );
                  const allHave =
                    selectedCards.length > 0 &&
                    selectedCards.every((card) =>
                      card?.labelIds.includes(label.id),
                    );
                  const someHave = selectedCards.some((card) =>
                    card?.labelIds.includes(label.id),
                  );
                  return (
                    <DropdownMenuItem
                      key={label.id}
                      onSelect={() => void applyLabel(label)}
                    >
                      <span className="flex h-4 w-4 items-center justify-center">
                        {allHave ? (
                          <Check className="h-3.5 w-3.5" aria-hidden />
                        ) : someHave ? (
                          <Minus className="h-3.5 w-3.5" aria-hidden />
                        ) : null}
                      </span>
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
                    </DropdownMenuItem>
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
                  disabled={busy !== null || selection.count === 0}
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
                <DropdownMenuItem onSelect={() => void applyAssignee(null)}>
                  <span className="h-4 w-4" aria-hidden />
                  {t("bulk.unassign")}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                {members.map((member) => {
                  const name = userLabel(member.displayName, member.email);
                  const allAssigned = [...selectedIds].every(
                    (id) => board.cards[id]?.assigneeId === member.userId,
                  );
                  return (
                    <DropdownMenuItem
                      key={member.userId}
                      onSelect={() => void applyAssignee(member.userId)}
                    >
                      <span className="flex h-4 w-4 items-center justify-center">
                        {allAssigned ? (
                          <Check className="h-3.5 w-3.5" aria-hidden />
                        ) : null}
                      </span>
                      <span className="min-w-0 flex-1 truncate">{name}</span>
                    </DropdownMenuItem>
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
            disabled={busy !== null || selection.count === 0}
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
            disabled={busy !== null || selection.count === 0}
            onClick={() => setDeleteOpen(true)}
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden />
            {t("bulk.delete")}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            data-testid="bulk-clear"
            className={cn(ACTION_BUTTON, "gap-1.5")}
            onClick={() => {
              if (busy !== null) {
                cancelRef.current = true;
                setCancelling(true);
                return;
              }
              selection.clear();
            }}
          >
            {busy !== null ? (
              <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden />
            ) : (
              <X className="h-3.5 w-3.5" aria-hidden />
            )}
            {busy !== null ? t("bulk.cancel") : t("bulk.clear")}
          </Button>
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

      <p
        role="status"
        aria-live="polite"
        data-testid="bulk-status"
        className="text-xs text-muted-foreground"
      >
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
          <ul className="mt-1 space-y-0.5">
            {failures.slice(0, 3).map((failure) => (
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
          {failures.length > 3 ? (
            <p className="mt-1 text-muted-foreground">
              {t("bulk.moreFailures", { count: failures.length - 3 })}
            </p>
          ) : null}
        </div>
      ) : null}

      <ConfirmDialog
        open={archiveOpen}
        onOpenChange={setArchiveOpen}
        title={tp("bulk.archiveTitle", selection.count)}
        description={tp("bulk.archiveDescription", selection.count)}
        confirmLabel={t("bulk.archive")}
        onConfirm={() => void archiveSelected()}
      />
      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={tp("bulk.deleteTitle", selection.count)}
        description={tp("bulk.deleteDescription", selection.count)}
        confirmLabel={t("bulk.delete")}
        destructive
        onConfirm={() => void deleteSelected()}
      />
    </section>
  );
}
