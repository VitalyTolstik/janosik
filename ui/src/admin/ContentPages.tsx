import { useState } from "react";
import {
  Archive,
  ArchiveRestore,
  ExternalLink,
  MoreHorizontal,
  Trash2,
} from "lucide-react";
import type { AdminCardRowDto, AdminCommentRowDto } from "@janosik/shared";
import { formatDate, useHour12, useI18n } from "@/i18n";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/components/Toast";
import { routes } from "@/routes";
import { adminApi } from "./admin-client";
import { useAdminT } from "./admin-i18n";
import { useAdminList } from "./use-admin-list";
import {
  Badge,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  FilterTabs,
  IdChip,
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
 * Content moderation (TASK-43): every card and every comment on the
 * platform, with archive/restore/soft-delete for cards and soft-delete for
 * comments. Client-side gating is UX only — the server re-checks and audits.
 */

type CardAction =
  | { kind: "archive"; card: AdminCardRowDto }
  | { kind: "unarchive"; card: AdminCardRowDto }
  | { kind: "delete"; card: AdminCardRowDto }
  | null;

export function CardsPage() {
  const t = useAdminT();
  const { lang } = useI18n();
  const hour12 = useHour12();
  const toast = useToast();

  const list = useAdminList<AdminCardRowDto>((params) =>
    adminApi.listCards(params),
  );
  const [pending, setPending] = useState<CardAction>(null);

  const run = async (action: CardAction) => {
    if (action === null) return;
    try {
      if (action.kind === "archive") {
        await adminApi.archiveCard(action.card.id);
        toast.success(t("admin.cards.toast.archived"));
      } else if (action.kind === "unarchive") {
        await adminApi.unarchiveCard(action.card.id);
        toast.success(t("admin.cards.toast.unarchived"));
      } else {
        await adminApi.deleteCard(action.card.id);
        toast.success(t("admin.cards.toast.deleted"));
      }
      list.reload();
    } catch {
      toast.error(t("admin.common.error"));
    } finally {
      setPending(null);
    }
  };

  const statusBadge = (card: AdminCardRowDto) => {
    if (card.deletedAt !== null) {
      return <Badge variant="danger">{t("admin.cards.status.deleted")}</Badge>;
    }
    if (card.archivedAt !== null) {
      return (
        <Badge variant="warning">{t("admin.cards.status.archived")}</Badge>
      );
    }
    return <Badge variant="success">{t("admin.cards.status.active")}</Badge>;
  };

  const confirmText = (action: CardAction) => {
    if (action === null) return { title: "", body: "", label: "" };
    if (action.kind === "archive") {
      return {
        title: t("admin.cards.confirm.archive.title", {
          title: action.card.title,
        }),
        body: t("admin.cards.confirm.archive.body"),
        label: t("admin.cards.action.archive"),
      };
    }
    if (action.kind === "unarchive") {
      return {
        title: t("admin.cards.action.unarchive"),
        body: t("admin.cards.confirm.archive.body"),
        label: t("admin.cards.action.unarchive"),
      };
    }
    return {
      title: t("admin.cards.confirm.delete.title", {
        title: action.card.title,
      }),
      body: t("admin.cards.confirm.delete.body"),
      label: t("admin.cards.action.delete"),
    };
  };

  return (
    <>
      <PageHeader
        title={t("admin.cards.title")}
        subtitle={t("admin.cards.subtitle", { total: list.total })}
      />

      <Panel>
        <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5">
          <SearchInput value={list.search} onChange={list.setSearch} />
          <FilterTabs
            value={list.status}
            onChange={list.setStatus}
            options={[
              { value: "all", label: t("admin.cards.filter.all") },
              { value: "active", label: t("admin.cards.filter.active") },
              { value: "archived", label: t("admin.cards.filter.archived") },
              { value: "deleted", label: t("admin.cards.filter.deleted") },
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
                <Th>{t("admin.common.id")}</Th>
                <Th>{t("admin.cards.col.title")}</Th>
                <Th>{t("admin.cards.col.board")}</Th>
                <Th>{t("admin.cards.col.column")}</Th>
                <Th className="text-right">{t("admin.cards.col.comments")}</Th>
                <Th>{t("admin.cards.col.updated")}</Th>
                <Th>{t("admin.cards.col.status")}</Th>
                <Th className="w-10" />
              </tr>
            </thead>
            <tbody>
              {list.items.map((card) => (
                <tr
                  key={card.id}
                  className="transition-colors hover:bg-hover/50"
                >
                  <Td>
                    <IdChip id={card.id} />
                  </Td>
                  <Td className="max-w-[18rem] truncate font-medium">
                    {card.title}
                  </Td>
                  <Td className="text-muted-foreground">{card.boardTitle}</Td>
                  <Td className="text-muted-foreground">{card.columnTitle}</Td>
                  <Td className="text-right tabular-nums">{card.comments}</Td>
                  <Td className="text-muted-foreground">
                    {formatDate(card.updatedAt, lang, hour12)}
                  </Td>
                  <Td>{statusBadge(card)}</Td>
                  <Td>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          type="button"
                          aria-label={t("admin.common.actions")}
                          data-testid={`admin-card-menu-${card.id}`}
                          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-hover hover:text-foreground"
                        >
                          <MoreHorizontal className="h-3.5 w-3.5" aria-hidden />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-52 text-xs">
                        <DropdownMenuItem asChild>
                          <a href={routes.board(card.boardId)}>
                            <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                            {t("admin.cards.action.open")}
                          </a>
                        </DropdownMenuItem>
                        {card.archivedAt === null ? (
                          <DropdownMenuItem
                            onSelect={() =>
                              setPending({ kind: "archive", card })
                            }
                          >
                            <Archive className="h-3.5 w-3.5" aria-hidden />
                            {t("admin.cards.action.archive")}
                          </DropdownMenuItem>
                        ) : (
                          <DropdownMenuItem
                            onSelect={() =>
                              setPending({ kind: "unarchive", card })
                            }
                          >
                            <ArchiveRestore
                              className="h-3.5 w-3.5"
                              aria-hidden
                            />
                            {t("admin.cards.action.unarchive")}
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuItem
                          onSelect={() => setPending({ kind: "delete", card })}
                          className="text-danger focus:text-danger"
                        >
                          <Trash2 className="h-3.5 w-3.5" aria-hidden />
                          {t("admin.cards.action.delete")}
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

export function CommentsPage() {
  const t = useAdminT();
  const { lang } = useI18n();
  const hour12 = useHour12();
  const toast = useToast();

  const list = useAdminList<AdminCommentRowDto>((params) =>
    adminApi.listComments(params),
  );
  const [pending, setPending] = useState<AdminCommentRowDto | null>(null);

  const remove = async () => {
    if (pending === null) return;
    try {
      await adminApi.deleteComment(pending.id);
      toast.success(t("admin.comments.toast.deleted"));
      list.reload();
    } catch {
      toast.error(t("admin.common.error"));
    } finally {
      setPending(null);
    }
  };

  return (
    <>
      <PageHeader
        title={t("admin.comments.title")}
        subtitle={t("admin.comments.subtitle", { total: list.total })}
      />

      <Panel>
        <div className="flex items-center justify-between gap-2 px-3 py-2.5">
          <SearchInput value={list.search} onChange={list.setSearch} />
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
                <Th>{t("admin.common.id")}</Th>
                <Th>{t("admin.comments.col.text")}</Th>
                <Th>{t("admin.comments.col.author")}</Th>
                <Th>{t("admin.comments.col.card")}</Th>
                <Th>{t("admin.comments.col.board")}</Th>
                <Th>{t("admin.comments.col.created")}</Th>
                <Th className="w-16" />
              </tr>
            </thead>
            <tbody>
              {list.items.map((comment) => (
                <tr
                  key={comment.id}
                  className="transition-colors hover:bg-hover/50"
                >
                  <Td>
                    <IdChip id={comment.id} />
                  </Td>
                  <Td className="max-w-[26rem] truncate">{comment.text}</Td>
                  <Td className="text-muted-foreground">
                    {comment.authorEmail}
                  </Td>
                  <Td className="max-w-[12rem] truncate text-muted-foreground">
                    {comment.cardTitle}
                  </Td>
                  <Td className="text-muted-foreground">
                    {comment.boardTitle}
                  </Td>
                  <Td className="text-muted-foreground">
                    {formatDate(comment.createdAt, lang, hour12)}
                  </Td>
                  <Td>
                    {comment.deletedAt === null ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2 text-xs text-danger hover:text-danger"
                        data-testid={`admin-comment-delete-${comment.id}`}
                        onClick={() => setPending(comment)}
                      >
                        {t("admin.comments.action.delete")}
                      </Button>
                    ) : (
                      <Badge variant="danger">
                        {t("admin.comments.status.deleted")}
                      </Badge>
                    )}
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

      <ConfirmDialog
        open={pending !== null}
        title={t("admin.comments.confirm.title")}
        body={t("admin.comments.confirm.body")}
        confirmLabel={t("admin.comments.action.delete")}
        onClose={() => setPending(null)}
        onConfirm={() => void remove()}
      />
    </>
  );
}
