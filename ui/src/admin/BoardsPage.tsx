import { useState } from "react";
import {
  Archive,
  ArchiveRestore,
  MoreHorizontal,
  Plus,
  Trash2,
} from "lucide-react";
import type { AdminBoardRowDto } from "@janosik/shared";
import { formatDate, useHour12, useI18n } from "@/i18n";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/components/Toast";
import { ApiError } from "@/api/client";
import { adminApi } from "./admin-client";
import { useAdminT } from "./admin-i18n";
import { useAdminList } from "./use-admin-list";
import {
  Badge,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  FilterTabs,
  LoadingState,
  PageHeader,
  Pagination,
  Panel,
  SearchInput,
  Table,
  Td,
  Th,
} from "./ui";

/**
 * Boards (TASK-36): every board on the platform with owner, counters and
 * moderation actions. Delete is the same soft-delete cascade the boards
 * service uses for users — the master never writes raw rows by hand.
 */

type PendingAction =
  | { kind: "archive"; board: AdminBoardRowDto }
  | { kind: "unarchive"; board: AdminBoardRowDto }
  | { kind: "delete"; board: AdminBoardRowDto }
  | null;

function CreateBoardDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const t = useAdminT();
  const toast = useToast();
  const [title, setTitle] = useState("");
  const [ownerEmail, setOwnerEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setTitle("");
    setOwnerEmail("");
    setError(null);
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await adminApi.createBoard({
        title: title.trim(),
        ownerEmail: ownerEmail.trim(),
      });
      toast.success(t("admin.boards.toast.created"));
      onCreated();
      onClose();
      reset();
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 404) {
        setError("Owner not found");
      } else if (cause instanceof ApiError && cause.messageText) {
        setError(cause.messageText);
      } else {
        setError(t("admin.common.error"));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent className="max-w-sm">
        <form onSubmit={(event) => void submit(event)} className="space-y-3">
          <DialogHeader>
            <DialogTitle className="text-sm">
              {t("admin.boards.create.title")}
            </DialogTitle>
          </DialogHeader>
          <label className="block space-y-1">
            <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
              {t("admin.boards.create.titleField")}
            </span>
            <input
              required
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              data-testid="admin-board-title"
              className="h-8 w-full rounded-lg border border-input bg-background/70 px-3 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </label>
          <label className="block space-y-1">
            <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
              {t("admin.boards.create.owner")}
            </span>
            <input
              type="email"
              required
              value={ownerEmail}
              onChange={(event) => setOwnerEmail(event.target.value)}
              data-testid="admin-board-owner"
              className="h-8 w-full rounded-lg border border-input bg-background/70 px-3 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <span className="block text-[11px] text-muted-foreground">
              {t("admin.boards.create.ownerHint")}
            </span>
          </label>
          {error ? (
            <p role="alert" className="text-xs text-danger">
              {error}
            </p>
          ) : null}
          <DialogFooter className="gap-2">
            <Button size="sm" variant="outline" type="button" onClick={onClose}>
              {t("admin.common.cancel")}
            </Button>
            <Button
              size="sm"
              type="submit"
              disabled={busy}
              data-testid="admin-board-submit"
            >
              {t("admin.boards.create.submit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function BoardsPage() {
  const t = useAdminT();
  const { lang } = useI18n();
  const hour12 = useHour12();
  const toast = useToast();

  const list = useAdminList<AdminBoardRowDto>((params) =>
    adminApi.listBoards(params),
  );
  const [pending, setPending] = useState<PendingAction>(null);
  const [creating, setCreating] = useState(false);

  const run = async (action: PendingAction) => {
    if (action === null) return;
    try {
      if (action.kind === "archive") {
        await adminApi.archiveBoard(action.board.id);
        toast.success(t("admin.boards.toast.archived"));
      } else if (action.kind === "unarchive") {
        await adminApi.unarchiveBoard(action.board.id);
        toast.success(t("admin.boards.toast.unarchived"));
      } else {
        await adminApi.deleteBoard(action.board.id);
        toast.success(t("admin.boards.toast.deleted"));
      }
      list.reload();
    } catch {
      toast.error(t("admin.common.error"));
    } finally {
      setPending(null);
    }
  };

  const statusBadge = (board: AdminBoardRowDto) => {
    if (board.deletedAt !== null) {
      return <Badge variant="danger">{t("admin.boards.status.deleted")}</Badge>;
    }
    if (board.archivedAt !== null) {
      return (
        <Badge variant="warning">{t("admin.boards.status.archived")}</Badge>
      );
    }
    return <Badge variant="success">{t("admin.boards.status.active")}</Badge>;
  };

  const confirmText = (action: PendingAction) => {
    if (action === null) return { title: "", body: "", label: "" };
    const title = action.board.title;
    if (action.kind === "archive") {
      return {
        title: t("admin.boards.confirm.archive.title", { title }),
        body: t("admin.boards.confirm.archive.body"),
        label: t("admin.boards.action.archive"),
      };
    }
    if (action.kind === "unarchive") {
      return {
        title: t("admin.boards.action.unarchive") + ` “${title}”`,
        body: t("admin.boards.confirm.archive.body"),
        label: t("admin.boards.action.unarchive"),
      };
    }
    return {
      title: t("admin.boards.confirm.delete.title", { title }),
      body: t("admin.boards.confirm.delete.body"),
      label: t("admin.boards.action.delete"),
    };
  };

  return (
    <>
      <PageHeader
        title={t("admin.boards.title")}
        subtitle={t("admin.boards.subtitle", { total: list.total })}
        actions={
          <Button
            size="sm"
            onClick={() => setCreating(true)}
            data-testid="admin-create-board"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden />
            {t("admin.boards.create")}
          </Button>
        }
      />

      <Panel>
        <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5">
          <SearchInput value={list.search} onChange={list.setSearch} />
          <FilterTabs
            value={list.status}
            onChange={list.setStatus}
            options={[
              { value: "all", label: t("admin.boards.filter.all") },
              { value: "active", label: t("admin.boards.filter.active") },
              { value: "archived", label: t("admin.boards.filter.archived") },
              { value: "deleted", label: t("admin.boards.filter.deleted") },
            ]}
          />
        </div>

        {list.loading ? (
          <LoadingState />
        ) : list.error ? (
          <ErrorState onRetry={list.reload} />
        ) : list.items.length === 0 ? (
          <EmptyState />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>{t("admin.boards.col.title")}</Th>
                <Th>{t("admin.boards.col.owner")}</Th>
                <Th className="text-right">{t("admin.boards.col.members")}</Th>
                <Th className="text-right">{t("admin.boards.col.columns")}</Th>
                <Th className="text-right">{t("admin.boards.col.cards")}</Th>
                <Th>{t("admin.boards.col.updated")}</Th>
                <Th>{t("admin.boards.col.status")}</Th>
                <Th className="w-10" />
              </tr>
            </thead>
            <tbody>
              {list.items.map((board) => (
                <tr
                  key={board.id}
                  className="transition-colors hover:bg-hover/50"
                >
                  <Td className="font-medium">{board.title}</Td>
                  <Td className="text-muted-foreground">
                    {board.ownerEmail ?? "—"}
                  </Td>
                  <Td className="text-right tabular-nums">{board.members}</Td>
                  <Td className="text-right tabular-nums">{board.columns}</Td>
                  <Td className="text-right tabular-nums">{board.cards}</Td>
                  <Td className="text-muted-foreground">
                    {formatDate(board.updatedAt, lang, hour12)}
                  </Td>
                  <Td>{statusBadge(board)}</Td>
                  <Td>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          type="button"
                          aria-label={t("admin.common.actions")}
                          data-testid={`admin-board-menu-${board.id}`}
                          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-hover hover:text-foreground"
                        >
                          <MoreHorizontal className="h-3.5 w-3.5" aria-hidden />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-48 text-xs">
                        {board.archivedAt === null ? (
                          <DropdownMenuItem
                            onSelect={() =>
                              setPending({ kind: "archive", board })
                            }
                          >
                            <Archive className="h-3.5 w-3.5" aria-hidden />
                            {t("admin.boards.action.archive")}
                          </DropdownMenuItem>
                        ) : (
                          <DropdownMenuItem
                            onSelect={() =>
                              setPending({ kind: "unarchive", board })
                            }
                          >
                            <ArchiveRestore
                              className="h-3.5 w-3.5"
                              aria-hidden
                            />
                            {t("admin.boards.action.unarchive")}
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuItem
                          onSelect={() => setPending({ kind: "delete", board })}
                          className="text-danger focus:text-danger"
                        >
                          <Trash2 className="h-3.5 w-3.5" aria-hidden />
                          {t("admin.boards.action.delete")}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}

        {list.items.length > 0 ? (
          <Pagination
            total={list.total}
            limit={list.limit}
            offset={list.offset}
            onChange={list.setOffset}
          />
        ) : null}
      </Panel>

      <CreateBoardDialog
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={list.reload}
      />

      <ConfirmDialog
        open={pending !== null}
        title={confirmText(pending).title}
        body={confirmText(pending).body}
        confirmLabel={confirmText(pending).label}
        destructive={pending?.kind !== "unarchive"}
        onClose={() => setPending(null)}
        onConfirm={() => void run(pending)}
      />
    </>
  );
}
