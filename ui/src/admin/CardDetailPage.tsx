import { useEffect, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { ArrowLeft, ArrowDownLeft, ArrowUpRight, Clock } from "lucide-react";
import { ADMIN_DETAIL_LIMITS } from "@janosik/shared";
import type {
  AdminCardDetailDto,
  AdminCardDetailSection,
} from "@janosik/shared";
import { formatDate, useHour12, useI18n } from "@/i18n";
import { Button } from "@/components/ui/button";
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
import {
  AttachmentDownloadButton,
  AttachmentThumb,
  DateCell,
  EntityLink,
  IdCell,
  JsonCell,
  LabelChip,
  SizeCell,
} from "./cells";

const userHref = (id: string) => `/admin/users/${id}`;
import {
  Badge,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  FilterTabs,
  ListWindowFooter,
  PageHeader,
  Panel,
  Table,
  Td,
  Th,
} from "./ui";
import { AdminDetailSkeleton } from "./skeletons";

/**
 * Card detail (TASK-48) — the full card graph: meta, labels, checklists,
 * links in both directions, comments, attachments and a merged timeline of
 * Activity rows (membership/comment feed) and board commands.
 */

const cardHref = (id: string) => `/admin/cards/${id}`;
const boardHref = (id: string) => `/admin/boards/${id}`;

function MetaItem({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0 space-y-0.5">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <div className="truncate text-xs">{children}</div>
    </div>
  );
}

/** Merge one refreshed section without dropping the other windows. */
function mergeSection(
  previous: AdminCardDetailDto,
  page: AdminCardDetailDto,
  section: AdminCardDetailSection,
  append: boolean,
): AdminCardDetailDto {
  const pageWindow = page.windows[section];
  // `Load more` requests the next page without re-sending the anchor (the
  // server would centre again). Keep the marker so the highlighted row and
  // the "linked from search" note survive appending.
  const mergedWindow =
    append && pageWindow.anchor === null
      ? { ...pageWindow, anchor: previous.windows[section].anchor }
      : pageWindow;
  const next: AdminCardDetailDto = {
    ...previous,
    hidden: page.hidden,
    windows: { ...previous.windows, [section]: mergedWindow },
  };
  switch (section) {
    case "comments":
      return {
        ...next,
        comments: append
          ? [...previous.comments, ...page.comments]
          : page.comments,
      };
    case "attachments":
      return {
        ...next,
        attachments: append
          ? [...previous.attachments, ...page.attachments]
          : page.attachments,
      };
    case "timeline":
      return {
        ...next,
        timeline: append
          ? [...previous.timeline, ...page.timeline]
          : page.timeline,
      };
  }
}

export function CardDetailPage() {
  const { cardId = "" } = useParams();
  const t = useAdminT();
  const toast = useToast();
  const { lang } = useI18n();
  const hour12 = useHour12();
  const [detail, setDetail] = useState<AdminCardDetailDto | null>(null);
  const [error, setError] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [sectionLoading, setSectionLoading] =
    useState<AdminCardDetailSection | null>(null);

  const [reloadKey, setReloadKey] = useState(0);
  const [dismissedAnchor, setDismissedAnchor] = useState<string | null>(null);
  const scrolledAnchor = useRef<string | null>(null);
  const [searchParams] = useSearchParams();
  const commentAnchor = searchParams.get("comment");
  const attachmentAnchor = searchParams.get("attachment");
  const anchor = commentAnchor ?? attachmentAnchor;
  const anchorDismissed = anchor !== null && dismissedAnchor === anchor;
  const anchorParamSection: AdminCardDetailSection | null = commentAnchor
    ? "comments"
    : attachmentAnchor
      ? "attachments"
      : null;

  const load = () => {
    setError(false);
    setReloadKey((key) => key + 1);
  };

  useEffect(() => {
    let active = true;
    adminApi
      .cardDetail(cardId, anchor ? { anchor } : {})
      .then((page) => {
        if (active) setDetail(page);
      })
      .catch(() => {
        if (active) setError(true);
      });
    return () => {
      active = false;
    };
  }, [cardId, reloadKey, anchor]);

  // A centred window can put the highlighted row below the 24rem table
  // viewport. Scroll it into view once per anchor, not on every page append.
  useEffect(() => {
    if (anchor === null || anchorDismissed) return;
    if (scrolledAnchor.current === anchor) return;
    const row = document.querySelector('[data-anchor="true"]');
    if (row === null) return;
    scrolledAnchor.current = anchor;
    row.scrollIntoView?.({ block: "center" });
  }, [detail, anchor, anchorDismissed]);

  /** Refresh one section window; `Load more` appends, a filter resets. */
  const loadSection = async (
    section: AdminCardDetailSection,
    params: { offset: number; includeDeleted?: boolean; append: boolean },
  ) => {
    setSectionLoading(section);
    try {
      const page = await adminApi.cardDetail(cardId, {
        section,
        offset: params.offset,
        limit: ADMIN_DETAIL_LIMITS.card,
        ...(params.includeDeleted ? { includeDeleted: true } : {}),
      });
      setDetail((previous) =>
        previous === null
          ? page
          : mergeSection(previous, page, section, params.append),
      );
    } catch {
      toast.error(t("admin.common.actionFailed"));
    } finally {
      setSectionLoading(null);
    }
  };

  const clearAnchor = (section: AdminCardDetailSection) => {
    if (anchor !== null) setDismissedAnchor(anchor);
    void loadSection(section, {
      offset: 0,
      includeDeleted: detail?.windows[section].includeDeleted,
      append: false,
    });
  };

  if (error) {
    return (
      <div className="p-4">
        <ErrorState onRetry={load} />
      </div>
    );
  }
  if (detail === null) {
    return <AdminDetailSkeleton variant="card" />;
  }

  const { card } = detail;
  const reload = load;

  const footer = (section: AdminCardDetailSection, shown: number) => {
    const window = detail.windows[section];
    return (
      <ListWindowFooter
        shown={shown}
        total={window.total}
        hasMore={window.hasMore}
        loading={sectionLoading === section}
        onLoadMore={() =>
          void loadSection(section, {
            offset: window.offset + window.limit,
            includeDeleted: window.includeDeleted,
            append: true,
          })
        }
        testId={`admin-card-${section}`}
      />
    );
  };

  const moderationFilter = (section: "comments" | "attachments") => {
    const window = detail.windows[section];
    const hidden = detail.hidden[section];
    if (hidden === 0 && !window.includeDeleted) return null;
    return (
      <div
        className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2"
        data-testid={`admin-card-filter-${section}`}
      >
        <FilterTabs<"live" | "all">
          value={window.includeDeleted ? "all" : "live"}
          options={[
            { value: "live", label: t("admin.common.live") },
            {
              value: "all",
              label: `${t("admin.common.showDeleted")} (${hidden})`,
            },
          ]}
          onChange={(value) => {
            // Changing the population invalidates the centred slice; drop
            // the anchor marker instead of claiming the row disappeared.
            if (anchor !== null) setDismissedAnchor(anchor);
            void loadSection(section, {
              offset: 0,
              includeDeleted: value === "all",
              append: false,
            });
          }}
        />
      </div>
    );
  };

  const anchorNote = (section: AdminCardDetailSection) => {
    const window = detail.windows[section];
    if (anchorDismissed) return null;
    if (window.anchor !== null) {
      return (
        <div
          className="flex flex-wrap items-center gap-2 border-b border-warning/30 bg-warning/5 px-3 py-1.5 text-[11px] text-muted-foreground"
          data-testid={`admin-card-anchor-${section}`}
        >
          <span>{t("admin.common.anchorHint")}</span>
          <Button
            size="sm"
            variant="ghost"
            className="h-6 px-2 text-[11px]"
            onClick={() => clearAnchor(section)}
          >
            {t("admin.common.showFromStart")}
          </Button>
        </div>
      );
    }
    if (anchorParamSection === section) {
      return (
        <p
          className="border-b border-warning/30 bg-warning/5 px-3 py-1.5 text-[11px] text-muted-foreground"
          data-testid={`admin-card-anchor-missing-${section}`}
        >
          {t("admin.common.anchorMissing")}
        </p>
      );
    }
    return null;
  };

  const run = async (label: string, action: () => Promise<unknown>) => {
    try {
      await action();
      toast.success(label);
      reload();
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 403) {
        toast.error(t("admin.common.forbidden"));
      } else {
        toast.error(t("admin.common.actionFailed"));
      }
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto p-4">
      <div className="flex items-center gap-2">
        <Button size="icon" variant="ghost" className="h-7 w-7" asChild>
          <Link
            to={boardHref(card.boardId)}
            aria-label={t("admin.common.back")}
          >
            <ArrowLeft className="h-4 w-4" aria-hidden />
          </Link>
        </Button>
        <PageHeader
          title={card.title}
          subtitle={`${card.boardTitle} · ${card.columnTitle}`}
          actions={
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  size="sm"
                  variant="outline"
                  data-testid="admin-card-detail-actions"
                >
                  {t("admin.common.actions")}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {card.archivedAt === null ? (
                  <DropdownMenuItem
                    onSelect={() =>
                      void run(t("admin.cards.action.archive"), () =>
                        adminApi.archiveCard(card.id),
                      )
                    }
                  >
                    {t("admin.cards.action.archive")}
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem
                    onSelect={() =>
                      void run(t("admin.cards.action.unarchive"), () =>
                        adminApi.unarchiveCard(card.id),
                      )
                    }
                  >
                    {t("admin.cards.action.unarchive")}
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem
                  className="text-danger focus:text-danger"
                  onSelect={() => setConfirmDelete(true)}
                >
                  {t("admin.cards.action.delete")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          }
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <IdCell id={card.id} />
        {card.deletedAt !== null ? (
          <Badge variant="danger" data-testid="admin-card-status">
            {t("admin.status.deleted")}
          </Badge>
        ) : card.archivedAt !== null ? (
          <Badge variant="warning" data-testid="admin-card-status">
            {t("admin.status.archived")}
          </Badge>
        ) : (
          <Badge variant="success" data-testid="admin-card-status">
            {t("admin.status.active")}
          </Badge>
        )}
        {card.priority !== null ? (
          <Badge variant="primary">{card.priority}</Badge>
        ) : null}
        {card.dueDate !== null ? (
          <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
            <Clock className="h-3 w-3" aria-hidden />
            {formatDate(card.dueDate, lang, hour12)}
          </span>
        ) : null}
      </div>

      <Panel
        className="grid grid-cols-2 gap-3 p-3 sm:grid-cols-4 lg:grid-cols-6"
        data-testid="admin-card-detail-meta"
      >
        <MetaItem label={t("admin.cardDetail.board")}>
          <EntityLink to={boardHref(card.boardId)}>
            {card.boardTitle}
          </EntityLink>
        </MetaItem>
        <MetaItem label={t("admin.cardDetail.column")}>
          {card.columnTitle}
        </MetaItem>
        <MetaItem label={t("admin.cardDetail.created")}>
          <DateCell value={card.createdAt} />
        </MetaItem>
        <MetaItem label={t("admin.cardDetail.updated")}>
          <DateCell value={card.updatedAt} />
        </MetaItem>
        <MetaItem label={t("admin.cardDetail.version")}>
          <span className="tabular-nums">{card.version}</span>
        </MetaItem>
        <MetaItem label={t("admin.cardDetail.createdBy")}>
          {detail.createdBy ? (
            <EntityLink to={userHref(detail.createdBy.actorId)}>
              {detail.createdBy.actorEmail}
            </EntityLink>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </MetaItem>
        <MetaItem label={t("admin.cardDetail.assignee")}>
          {card.assigneeId ? (
            <EntityLink
              to={userHref(card.assigneeId)}
              copyValue={card.assigneeEmail ?? undefined}
            >
              {card.assigneeDisplayName ?? card.assigneeEmail}
            </EntityLink>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </MetaItem>
        <MetaItem label={t("admin.cardDetail.lastActor")}>
          {card.lastActorEmail ?? "—"}
        </MetaItem>
      </Panel>

      {card.description ? (
        <Panel className="p-3" data-testid="admin-card-detail-description">
          <p className="pb-1 text-[10px] uppercase tracking-wide text-muted-foreground">
            {t("admin.cardDetail.description")}
          </p>
          <p className="whitespace-pre-wrap break-words text-xs text-foreground">
            {card.description}
          </p>
        </Panel>
      ) : null}

      {detail.labels.length > 0 ? (
        <div
          className="flex flex-wrap items-center gap-1.5"
          data-testid="admin-card-detail-labels"
        >
          {detail.labels.map((label) => (
            <LabelChip key={label.id} name={label.name} color={label.color} />
          ))}
        </div>
      ) : null}

      {detail.checklists.length > 0 ? (
        <Panel
          className="space-y-2.5 p-3"
          data-testid="admin-card-detail-checklists"
        >
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
            {t("admin.cardDetail.checklists")}
          </p>
          {detail.checklists.map((checklist) => {
            const live = checklist.items.filter(
              (item) => item.deletedAt === null,
            );
            const done = live.filter((item) => item.done).length;
            return (
              <div key={checklist.id} className="space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-medium">{checklist.title}</p>
                  <span className="tabular-nums text-[11px] text-muted-foreground">
                    {done}/{live.length}
                  </span>
                </div>
                <ul className="space-y-0.5 pl-3">
                  {live.map((item) => (
                    <li
                      key={item.id}
                      className="flex items-center gap-1.5 text-xs"
                    >
                      <span
                        className={
                          item.done ? "text-success" : "text-muted-foreground"
                        }
                        aria-hidden
                      >
                        {item.done ? "☑" : "☐"}
                      </span>
                      <span
                        className={
                          item.done ? "text-muted-foreground line-through" : ""
                        }
                      >
                        {item.text}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </Panel>
      ) : null}

      {detail.linksOut.length + detail.linksIn.length > 0 ? (
        <Panel className="p-3" data-testid="admin-card-detail-links">
          <p className="pb-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
            {t("admin.cardDetail.links")}
          </p>
          <ul className="space-y-1">
            {detail.linksOut.map((link) => (
              <li key={link.id} className="flex items-center gap-2 text-xs">
                <ArrowUpRight
                  className="h-3.5 w-3.5 text-muted-foreground"
                  aria-hidden
                />
                <span className="rounded border border-border bg-hover/40 px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
                  {link.type}
                </span>
                <EntityLink to={cardHref(link.otherCardId)}>
                  {link.otherCardTitle}
                </EntityLink>
                {link.deletedAt !== null ? (
                  <Badge variant="danger">{t("admin.status.deleted")}</Badge>
                ) : null}
              </li>
            ))}
            {detail.linksIn.map((link) => (
              <li key={link.id} className="flex items-center gap-2 text-xs">
                <ArrowDownLeft
                  className="h-3.5 w-3.5 text-muted-foreground"
                  aria-hidden
                />
                <span className="rounded border border-border bg-hover/40 px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
                  {link.type}
                </span>
                <EntityLink to={cardHref(link.otherCardId)}>
                  {link.otherCardTitle}
                </EntityLink>
                {link.deletedAt !== null ? (
                  <Badge variant="danger">{t("admin.status.deleted")}</Badge>
                ) : null}
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}

      {detail.attachments.length > 0 ||
      detail.windows.attachments.total + detail.hidden.attachments > 0 ||
      anchorParamSection === "attachments" ? (
        <Panel
          className="shrink-0 overflow-hidden"
          data-testid="admin-card-detail-attachments"
        >
          {anchorNote("attachments")}
          {moderationFilter("attachments")}
          {detail.attachments.length === 0 ? (
            <EmptyState />
          ) : (
            <Table maxHeight="20rem">
              <thead>
                <tr>
                  <Th>{t("admin.attachments.column.file")}</Th>
                  <Th>{t("admin.attachments.column.size")}</Th>
                  <Th>{t("admin.attachments.column.uploader")}</Th>
                  <Th>{t("admin.attachments.column.created")}</Th>
                  <Th>{t("admin.attachments.column.status")}</Th>
                </tr>
              </thead>
              <tbody>
                {detail.attachments.map((file) => {
                  const anchored =
                    !anchorDismissed &&
                    detail.windows.attachments.anchor === file.id;
                  return (
                    <tr
                      key={file.id}
                      data-anchor={anchored ? "true" : undefined}
                      aria-current={anchored ? "true" : undefined}
                      className={anchored ? "bg-warning/10" : undefined}
                    >
                      <Td>
                        <span className="inline-flex items-center gap-2">
                          <AttachmentThumb
                            attachmentId={file.id}
                            mimeType={file.mimeType}
                            fileName={file.fileName}
                          />
                          {file.fileName}
                          <AttachmentDownloadButton
                            attachmentId={file.id}
                            fileName={file.fileName}
                          />
                        </span>
                      </Td>
                      <Td>
                        <SizeCell bytes={file.sizeBytes} />
                      </Td>
                      <Td>
                        <EntityLink
                          to={userHref(file.uploadedById)}
                          copyValue={file.uploadedByEmail}
                        >
                          {file.uploadedByEmail}
                        </EntityLink>
                      </Td>
                      <Td>
                        <DateCell value={file.createdAt} />
                      </Td>
                      <Td>
                        {file.deletedAt !== null ? (
                          <Badge variant="danger">
                            {t("admin.status.deleted")}
                          </Badge>
                        ) : (
                          <Badge variant="success">
                            {t("admin.status.active")}
                          </Badge>
                        )}
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          )}
          {detail.windows.attachments.total + detail.hidden.attachments > 0
            ? footer("attachments", detail.attachments.length)
            : null}
        </Panel>
      ) : null}

      {detail.comments.length > 0 ||
      detail.windows.comments.total + detail.hidden.comments > 0 ||
      anchorParamSection === "comments" ? (
        <Panel
          className="shrink-0 overflow-hidden"
          data-testid="admin-card-detail-comments"
        >
          {anchorNote("comments")}
          {moderationFilter("comments")}
          {detail.comments.length === 0 ? (
            <EmptyState />
          ) : (
            <Table maxHeight="24rem">
              <thead>
                <tr>
                  <Th>{t("admin.comments.column.text")}</Th>
                  <Th>{t("admin.comments.column.author")}</Th>
                  <Th>{t("admin.comments.column.created")}</Th>
                  <Th>{t("admin.comments.column.status")}</Th>
                </tr>
              </thead>
              <tbody>
                {detail.comments.map((comment) => {
                  const anchored =
                    !anchorDismissed &&
                    detail.windows.comments.anchor === comment.id;
                  return (
                    <tr
                      key={comment.id}
                      data-anchor={anchored ? "true" : undefined}
                      aria-current={anchored ? "true" : undefined}
                      className={anchored ? "bg-warning/10" : undefined}
                    >
                      <Td className="max-w-[30rem] whitespace-normal">
                        {comment.text}
                      </Td>
                      <Td>{comment.authorEmail}</Td>
                      <Td>
                        <DateCell value={comment.createdAt} />
                      </Td>
                      <Td>
                        {comment.deletedAt !== null ? (
                          <Badge variant="danger">
                            {t("admin.status.deleted")}
                          </Badge>
                        ) : (
                          <Badge variant="success">
                            {t("admin.status.active")}
                          </Badge>
                        )}
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          )}
          {detail.windows.comments.total + detail.hidden.comments > 0
            ? footer("comments", detail.comments.length)
            : null}
        </Panel>
      ) : null}

      <Panel className="p-3" data-testid="admin-card-detail-timeline">
        <p className="pb-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
          {t("admin.cardDetail.timeline")}
        </p>
        {detail.timeline.length === 0 ? (
          <EmptyState />
        ) : (
          <ul className="space-y-1.5">
            {detail.timeline.map((event) => (
              <li
                key={`${event.kind}-${event.id}`}
                className="flex items-start gap-2 text-xs"
              >
                <span
                  className={
                    event.kind === "command"
                      ? "rounded border border-border bg-hover/40 px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground"
                      : "rounded border border-primary/30 bg-primary/10 px-1.5 py-0.5 font-mono text-[11px] text-primary"
                  }
                >
                  {event.type}
                </span>
                <span className="text-muted-foreground">
                  {event.actorEmail}
                </span>
                {event.details ? <JsonCell value={event.details} /> : null}
                <span className="ml-auto tabular-nums text-[11px] text-muted-foreground">
                  {formatDate(event.createdAt, lang, hour12)}
                </span>
              </li>
            ))}
          </ul>
        )}
        {detail.windows.timeline.total > 0
          ? footer("timeline", detail.timeline.length)
          : null}
      </Panel>

      <ConfirmDialog
        open={confirmDelete}
        title={t("admin.cards.confirm.delete.title", { title: card.title })}
        body={t("admin.cards.confirm.delete.body")}
        confirmLabel={t("admin.cards.action.delete")}
        onConfirm={() => {
          setConfirmDelete(false);
          void run(t("admin.cards.action.delete"), () =>
            adminApi.deleteCard(card.id),
          );
        }}
        onClose={() => setConfirmDelete(false)}
      />
    </div>
  );
}
