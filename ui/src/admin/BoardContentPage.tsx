import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  Archive,
  ArrowLeft,
  Check,
  Columns3,
  Pencil,
  Plus,
  RotateCw,
  Trash2,
  X,
} from "lucide-react";
import type { BoardAggregate } from "@janosik/shared";
import { LIMITS } from "@janosik/shared";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/Toast";
import { ApiError } from "@/api/client";
import { cn } from "@/lib/utils";
import { pollWhileFocused } from "@/lib/visible-poll";
import { routes } from "@/routes";
import { adminApi } from "./admin-client";
import { useAdminT } from "./admin-i18n";
import {
  ConfirmDialog,
  ErrorState,
  IdChip,
  LoadingState,
  PageHeader,
  Panel,
} from "./ui";

/**
 * Board content editor (TASK-43) — create and tidy columns/cards without
 * leaving the panel.
 *
 * Every mutation is a real `BoardAction` shipped through
 * `POST /admin/boards/:id/commands` **on behalf of the board owner**, so the
 * command log, versions and the board UI all stay consistent (§7.4.1). The
 * server re-validates each action with the shared strict validator; a
 * refusal (WIP limit, limits) surfaces as a toast.
 */

function uuid(): string {
  return crypto.randomUUID();
}

export function BoardContentPage() {
  const t = useAdminT();
  const toast = useToast();
  const { boardId = "" } = useParams();

  const [board, setBoard] = useState<BoardAggregate | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [selectedColumnId, setSelectedColumnId] = useState<string | null>(null);
  const [newColumn, setNewColumn] = useState("");
  const [newCard, setNewCard] = useState("");
  const [renaming, setRenaming] = useState<{
    id: string;
    value: string;
  } | null>(null);
  const [pendingDelete, setPendingDelete] = useState<{
    id: string;
    title: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setState("loading");
    void adminApi
      .getBoardContent(boardId)
      .then((next) => {
        setBoard(next);
        setState("ready");
        setSelectedColumnId(
          (current) => current ?? next.columns[0]?.id ?? null,
        );
      })
      .catch(() => setState("error"));
  }, [boardId]);

  useEffect(() => {
    load();
  }, [load]);

  // Live view (TASK-57): while this page is visible and focused, re-fetch the
  // aggregate every 2s so a running demo is watched in place — the manual
  // refresh stays for a one-off peek.
  useEffect(() => {
    const tick = () => {
      adminApi
        .getBoardContent(boardId)
        .then(setBoard)
        .catch(() => {
          /* a transient error keeps the last aggregate on screen */
        });
    };
    return pollWhileFocused(tick, 2000);
  }, [boardId]);

  const send = useCallback(
    async (action: Record<string, unknown>, successMessage: string) => {
      setBusy(true);
      try {
        await adminApi.sendBoardCommand(boardId, {
          // `at` is the command clock the reducer stamps into the board;
          // the strict validator requires it on every board-scoped action.
          action: { ...action, at: Date.now() } as never,
        });
        toast.success(successMessage);
        const next = await adminApi.getBoardContent(boardId);
        setBoard(next);
        // First content ever created: focus the new column so the card
        // composer is reachable without an extra click.
        setSelectedColumnId(
          (current) => current ?? next.columns[0]?.id ?? null,
        );
      } catch (error) {
        toast.error(
          error instanceof ApiError
            ? error.messageText
            : t("admin.common.error"),
        );
      } finally {
        setBusy(false);
      }
    },
    [boardId, t, toast],
  );

  if (state === "loading") return <LoadingState />;
  if (state === "error" || board === null) return <ErrorState onRetry={load} />;

  const selected = board.columns.find(
    (column) => column.id === selectedColumnId,
  );
  const cards = selected
    ? selected.cardIds
        .map((cardId) => board.cards[cardId])
        .filter((card) => card !== undefined)
    : [];

  const addColumn = () => {
    const title = newColumn.trim();
    if (title === "") return;
    setNewColumn("");
    void send(
      { type: "ADD_COLUMN", newColumnId: uuid(), title },
      t("admin.boardContent.toast.columnAdded"),
    );
  };

  const addCard = () => {
    if (!selected) return;
    const title = newCard.trim();
    if (title === "") return;
    setNewCard("");
    void send(
      { type: "ADD_CARD", newCardId: uuid(), columnId: selected.id, title },
      t("admin.boardContent.toast.cardAdded"),
    );
  };

  const commitRename = (kind: "column" | "card") => {
    if (renaming === null) return;
    const title = renaming.value.trim();
    setRenaming(null);
    if (title === "") return;
    void send(
      kind === "column"
        ? { type: "RENAME_COLUMN", columnId: renaming.id, title }
        : { type: "UPDATE_CARD", cardId: renaming.id, title },
      t("admin.boardContent.toast.saved"),
    );
  };

  return (
    <>
      <div className="flex items-center gap-2">
        <Link
          to={routes.admin}
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
          {t("admin.boardContent.back")}
        </Link>
      </div>

      <PageHeader
        title={board.title}
        subtitle={t("admin.boardContent.title")}
        actions={
          <div className="flex items-center gap-2">
            <IdChip id={board.id} />
            <Button size="sm" variant="outline" onClick={load} disabled={busy}>
              <RotateCw className="h-3.5 w-3.5" aria-hidden />
              {t("admin.common.retry")}
            </Button>
          </div>
        }
      />

      <div className="grid gap-3 lg:grid-cols-[18rem_1fr]">
        <Panel className="flex flex-col">
          <div className="flex items-center gap-2 border-b border-border px-3 py-2">
            <Columns3 className="h-3.5 w-3.5 text-primary" aria-hidden />
            <h2 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              {t("admin.boardContent.columns")}
            </h2>
          </div>
          <ul className="flex-1 divide-y divide-border/60">
            {board.columns.map((column) => (
              <li key={column.id}>
                <div
                  className={cn(
                    "group flex items-center justify-between gap-2 px-3 py-2 transition-colors",
                    column.id === selectedColumnId
                      ? "bg-primary/10"
                      : "hover:bg-hover/50",
                  )}
                >
                  {renaming?.id === column.id ? (
                    <span className="flex flex-1 items-center gap-1">
                      <input
                        autoFocus
                        value={renaming.value}
                        maxLength={LIMITS.columnTitle}
                        onChange={(event) =>
                          setRenaming({
                            id: column.id,
                            value: event.target.value,
                          })
                        }
                        onKeyDown={(event) => {
                          if (event.key === "Enter") commitRename("column");
                          if (event.key === "Escape") setRenaming(null);
                        }}
                        className="h-7 w-full rounded border border-input bg-background/70 px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      />
                      <button
                        type="button"
                        aria-label={t("admin.common.save")}
                        onClick={() => commitRename("column")}
                        className="text-success"
                      >
                        <Check className="h-3.5 w-3.5" aria-hidden />
                      </button>
                      <button
                        type="button"
                        aria-label={t("admin.common.cancel")}
                        onClick={() => setRenaming(null)}
                        className="text-muted-foreground"
                      >
                        <X className="h-3.5 w-3.5" aria-hidden />
                      </button>
                    </span>
                  ) : (
                    <button
                      type="button"
                      data-testid={`admin-column-${column.id}`}
                      onClick={() => setSelectedColumnId(column.id)}
                      className="flex-1 truncate text-left text-xs font-medium text-foreground"
                    >
                      {column.title}
                      <span className="ml-2 text-[11px] font-normal text-muted-foreground">
                        {column.cardIds.length}
                      </span>
                    </button>
                  )}
                  {renaming?.id !== column.id ? (
                    <span className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                      <button
                        type="button"
                        aria-label={t("admin.boardContent.rename")}
                        data-testid={`admin-column-rename-${column.id}`}
                        onClick={() =>
                          setRenaming({ id: column.id, value: column.title })
                        }
                        className="text-muted-foreground hover:text-foreground"
                      >
                        <Pencil className="h-3.5 w-3.5" aria-hidden />
                      </button>
                      <button
                        type="button"
                        aria-label={t("admin.boardContent.delete")}
                        data-testid={`admin-column-delete-${column.id}`}
                        onClick={() =>
                          setPendingDelete({
                            id: column.id,
                            title: column.title,
                          })
                        }
                        className="text-muted-foreground hover:text-danger"
                      >
                        <Trash2 className="h-3.5 w-3.5" aria-hidden />
                      </button>
                    </span>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
          <div className="flex items-center gap-1.5 border-t border-border p-2">
            <input
              value={newColumn}
              maxLength={LIMITS.columnTitle}
              onChange={(event) => setNewColumn(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") addColumn();
              }}
              placeholder={t("admin.boardContent.columnPlaceholder")}
              data-testid="admin-new-column"
              className="h-8 w-full rounded-lg border border-input bg-background/70 px-2.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <Button
              size="icon"
              variant="outline"
              aria-label={t("admin.boardContent.addColumn")}
              data-testid="admin-add-column"
              onClick={addColumn}
              disabled={busy}
            >
              <Plus className="h-3.5 w-3.5" aria-hidden />
            </Button>
          </div>
        </Panel>

        <Panel className="flex flex-col">
          <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
            <h2 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              {t("admin.boardContent.cards")}
              {selected ? ` · ${selected.title}` : ""}
            </h2>
            {selected ? <IdChip id={selected.id} /> : null}
          </div>

          {selected === undefined ? (
            <p className="px-3 py-10 text-center text-xs text-muted-foreground">
              {t("admin.boardContent.empty")}
            </p>
          ) : (
            <>
              <ul className="flex-1 divide-y divide-border/60">
                {cards.length === 0 ? (
                  <li className="px-3 py-8 text-center text-xs text-muted-foreground">
                    {t("admin.boardContent.noCards")}
                  </li>
                ) : null}
                {cards.map((card) => (
                  <li
                    key={card.id}
                    className="group flex items-center justify-between gap-2 px-3 py-2 transition-colors hover:bg-hover/50"
                  >
                    {renaming?.id === card.id ? (
                      <span className="flex flex-1 items-center gap-1">
                        <input
                          autoFocus
                          value={renaming.value}
                          maxLength={LIMITS.cardTitle}
                          onChange={(event) =>
                            setRenaming({
                              id: card.id,
                              value: event.target.value,
                            })
                          }
                          onKeyDown={(event) => {
                            if (event.key === "Enter") commitRename("card");
                            if (event.key === "Escape") setRenaming(null);
                          }}
                          className="h-7 w-full rounded border border-input bg-background/70 px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        />
                        <button
                          type="button"
                          aria-label={t("admin.common.save")}
                          onClick={() => commitRename("card")}
                          className="text-success"
                        >
                          <Check className="h-3.5 w-3.5" aria-hidden />
                        </button>
                        <button
                          type="button"
                          aria-label={t("admin.common.cancel")}
                          onClick={() => setRenaming(null)}
                          className="text-muted-foreground"
                        >
                          <X className="h-3.5 w-3.5" aria-hidden />
                        </button>
                      </span>
                    ) : (
                      <span className="flex min-w-0 flex-1 items-center gap-2">
                        <span className="truncate text-xs text-foreground">
                          {card.title}
                        </span>
                        <IdChip id={card.id} className="shrink-0" />
                      </span>
                    )}
                    <span className="flex items-center gap-1.5 opacity-0 transition-opacity group-hover:opacity-100">
                      <button
                        type="button"
                        aria-label={t("admin.boardContent.rename")}
                        data-testid={`admin-card-rename-${card.id}`}
                        onClick={() =>
                          setRenaming({ id: card.id, value: card.title })
                        }
                        className="text-muted-foreground hover:text-foreground"
                      >
                        <Pencil className="h-3.5 w-3.5" aria-hidden />
                      </button>
                      <button
                        type="button"
                        aria-label={t("admin.boardContent.archive")}
                        data-testid={`admin-card-archive-${card.id}`}
                        onClick={() =>
                          void send(
                            { type: "ARCHIVE_CARD", cardId: card.id },
                            t("admin.boardContent.toast.cardArchived"),
                          )
                        }
                        className="text-muted-foreground hover:text-danger"
                      >
                        <Archive className="h-3.5 w-3.5" aria-hidden />
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
              <div className="flex items-center gap-1.5 border-t border-border p-2">
                <input
                  value={newCard}
                  maxLength={LIMITS.cardTitle}
                  onChange={(event) => setNewCard(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") addCard();
                  }}
                  placeholder={t("admin.boardContent.cardPlaceholder")}
                  data-testid="admin-new-card"
                  className="h-8 w-full rounded-lg border border-input bg-background/70 px-2.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
                <Button
                  size="icon"
                  variant="outline"
                  aria-label={t("admin.boardContent.addCard")}
                  data-testid="admin-add-card"
                  onClick={addCard}
                  disabled={busy}
                >
                  <Plus className="h-3.5 w-3.5" aria-hidden />
                </Button>
              </div>
            </>
          )}
        </Panel>
      </div>

      <ConfirmDialog
        open={pendingDelete !== null}
        title={t("admin.boardContent.confirmDelete.title", {
          title: pendingDelete?.title ?? "",
        })}
        body={t("admin.boardContent.confirmDelete.body")}
        confirmLabel={t("admin.boardContent.delete")}
        onClose={() => setPendingDelete(null)}
        onConfirm={() => {
          const columnId = pendingDelete?.id;
          setPendingDelete(null);
          if (columnId) {
            setSelectedColumnId(null);
            void send(
              { type: "DELETE_COLUMN", columnId },
              t("admin.boardContent.toast.columnDeleted"),
            );
          }
        }}
      />
    </>
  );
}
