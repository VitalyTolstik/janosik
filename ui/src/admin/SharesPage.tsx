import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Copy, ExternalLink, RefreshCw, Trash2 } from "lucide-react";
import { Link } from "react-router-dom";
import type { AdminShareRowDto } from "@janosik/shared";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/Toast";
import { formatDate, useHour12, useI18n } from "@/i18n";
import { appPath, appShareUrl } from "@/utils/app-path";
import { adminApi } from "./admin-client";
import { useAdminT } from "./admin-i18n";
import { EntityListSkeleton } from "./skeletons";
import { useAdminList } from "./use-admin-list";
import {
  Badge,
  ConfirmDialog,
  ErrorState,
  PageHeader,
  Pagination,
  Panel,
  SearchInput,
  Table,
  Td,
  Th,
} from "./ui";

/** `1–50` / `51` / `0` — the visible window inside the server total. */
function visibleRange(offset: number, count: number): string {
  if (count === 0) return "0";
  const start = offset + 1;
  const end = offset + count;
  return start === end ? String(start) : `${start}–${end}`;
}

/**
 * Public shares (TASK-58) — every read-only link minted against any board,
 * with its mode/flags/views/expiry and a one-click revoke. The token is shown
 * so an operator can re-copy a link for support; a link whose board is gone is
 * flagged (a live share of a deleted board no longer resolves).
 *
 * The list pages over the server's `total/offset/limit`, so the count always
 * describes every link, not just the loaded page. Search mirrors the rest of
 * the panel: the shared `useAdminList` debounce plus `SearchInput`, not a
 * separate button; the debounced commit resets the offset like every admin
 * list.
 */
export function SharesPage() {
  const t = useAdminT();
  const { lang } = useI18n();
  const hour12 = useHour12();
  const toast = useToast();
  const list = useAdminList<AdminShareRowDto>(
    (params) => adminApi.listShares(params),
    { clampOutOfRange: true },
  );
  const { items: rows, reload } = list;
  // Freeze `now` on mount: an expiry badge must not start ticking while the
  // table is open (the row data is a snapshot from the last request).
  const [now] = useState(() => Date.now());
  const [busy, setBusy] = useState<string | null>(null);
  const [pendingRevoke, setPendingRevoke] = useState<AdminShareRowDto | null>(
    null,
  );
  // Inline "copied" feedback (icon flips to a check), like the app's copy
  // chips — no toast for a copy.
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (copyTimer.current) clearTimeout(copyTimer.current);
    },
    [],
  );

  const markCopied = useCallback((id: string) => {
    setCopiedId(id);
    if (copyTimer.current) clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => setCopiedId(null), 1600);
  }, []);

  const revoke = useCallback(
    async (id: string) => {
      setBusy(id);
      try {
        await adminApi.revokeShare(id);
        toast.success(t("admin.shares.revoked"));
        reload();
      } catch {
        toast.error(t("admin.common.error"));
      } finally {
        setBusy(null);
      }
    },
    [reload, t, toast],
  );

  return (
    <div className="w-full max-w-5xl space-y-4 p-4">
      <PageHeader
        title={t("admin.shares.title")}
        subtitle={t("admin.shares.subtitle")}
        meta={
          list.loading || list.error ? undefined : (
            <span
              className="tabular-nums"
              data-testid="admin-shares-total"
              aria-live="polite"
            >
              {t("admin.common.ofTotal", {
                shown: visibleRange(list.pageOffset, rows.length),
                total: list.total,
              })}
            </span>
          )
        }
        actions={<SearchInput value={list.search} onChange={list.setSearch} />}
      />

      <Panel className="p-0" aria-busy={list.loading || list.refreshing}>
        {list.loading ? (
          <EntityListSkeleton columns={7} testId="admin-shares-skeleton" />
        ) : list.error ? (
          <div className="p-4">
            <ErrorState onRetry={reload} />
          </div>
        ) : rows.length === 0 ? (
          list.refreshing ? null : (
            <p className="p-4 text-sm text-muted-foreground">
              {list.total > 0
                ? t("admin.filters.emptyPage.moderation")
                : list.effectiveSearch !== ""
                  ? t("admin.common.emptyFiltered")
                  : t("admin.shares.empty")}
            </p>
          )
        ) : (
          <div data-testid="admin-shares-table">
            <Table>
              <thead>
                <tr>
                  <Th>{t("admin.shares.col.board")}</Th>
                  <Th>{t("admin.shares.col.mode")}</Th>
                  <Th>{t("admin.shares.col.flags")}</Th>
                  <Th>{t("admin.shares.col.views")}</Th>
                  <Th>{t("admin.shares.col.created")}</Th>
                  <Th>{t("admin.shares.col.expires")}</Th>
                  <Th className="text-right">
                    {t("admin.shares.col.actions")}
                  </Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <Td label={t("admin.shares.col.board")}>
                      <div className="flex flex-col">
                        {row.boardDeleted ? (
                          <div className="flex max-w-[20rem] min-w-0 items-center gap-2 text-muted-foreground">
                            <span
                              className="truncate"
                              title={row.boardTitle ?? undefined}
                            >
                              {row.boardTitle ?? row.boardId}
                            </span>
                            {row.revokedAt === null ? (
                              <span
                                className="inline-flex shrink-0"
                                title={
                                  row.mode === "live"
                                    ? t("admin.shares.boardGone.hint")
                                    : t("admin.shares.boardGone.snapshotHint")
                                }
                              >
                                <Badge
                                  variant={
                                    row.mode === "live" ? "danger" : "neutral"
                                  }
                                >
                                  {t("admin.shares.boardGone")}
                                </Badge>
                              </span>
                            ) : null}
                          </div>
                        ) : (
                          <Link
                            to={`/admin/boards/${row.boardId}`}
                            title={row.boardTitle ?? undefined}
                            className="block max-w-[20rem] truncate text-foreground hover:underline"
                          >
                            {row.boardTitle ?? row.boardId}
                          </Link>
                        )}
                        <code className="font-mono text-[11px] text-muted-foreground">
                          /s/{row.token}
                        </code>
                      </div>
                    </Td>
                    <Td label={t("admin.shares.col.mode")}>
                      <Badge variant="neutral">
                        {row.mode === "live"
                          ? t("admin.shares.mode.live")
                          : t("admin.shares.mode.snapshot")}
                      </Badge>
                    </Td>
                    <Td
                      label={t("admin.shares.col.flags")}
                      className="text-xs text-muted-foreground"
                    >
                      {[
                        (row.effectiveIncludeComments ?? row.includeComments)
                          ? t("admin.shares.flag.comments")
                          : null,
                        (row.effectiveIncludeAttachments ??
                        row.includeAttachments)
                          ? t("admin.shares.flag.attachments")
                          : null,
                      ]
                        .filter(Boolean)
                        .join(" · ") || "—"}
                    </Td>
                    <Td
                      label={t("admin.shares.col.views")}
                      className="tabular-nums text-muted-foreground"
                    >
                      {row.views}
                    </Td>
                    <Td
                      label={t("admin.shares.col.created")}
                      className="text-xs text-muted-foreground"
                    >
                      {formatDate(row.createdAt, lang, hour12)}
                    </Td>
                    <Td
                      label={t("admin.shares.col.expires")}
                      className="text-xs text-muted-foreground"
                    >
                      <span data-testid={`admin-share-expires-${row.id}`}>
                        {row.expiresAt === null ? (
                          <span title={t("admin.shares.noExpiry")}>
                            <span aria-hidden>—</span>
                            <span className="sr-only">
                              {t("admin.shares.noExpiry")}
                            </span>
                          </span>
                        ) : (
                          <span className="inline-flex flex-wrap items-center gap-1.5">
                            {formatDate(row.expiresAt, lang, hour12)}
                            {row.revokedAt === null && row.expiresAt <= now ? (
                              <Badge
                                variant="danger"
                                data-testid={`admin-share-expired-${row.id}`}
                              >
                                {t("admin.shares.expiredLabel")}
                              </Badge>
                            ) : null}
                          </span>
                        )}
                      </span>
                    </Td>
                    <Td className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0"
                          aria-label={t("admin.shares.copy")}
                          title={t("admin.shares.copy")}
                          data-testid={`admin-share-copy-${row.id}`}
                          onClick={() => {
                            const url = appShareUrl(`/s/${row.token}`);
                            void navigator.clipboard
                              ?.writeText(url)
                              .then(() => markCopied(row.id))
                              .catch(() => undefined);
                          }}
                        >
                          {copiedId === row.id ? (
                            <Check
                              className="h-3.5 w-3.5 text-success"
                              aria-hidden
                            />
                          ) : (
                            <Copy className="h-3.5 w-3.5" aria-hidden />
                          )}
                        </Button>
                        <a
                          href={appPath(`/s/${row.token}`)}
                          target="_blank"
                          rel="noreferrer"
                          aria-label={t("admin.shares.open")}
                          title={t("admin.shares.open")}
                          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-hover hover:text-foreground"
                        >
                          <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                        </a>
                        {row.revokedAt !== null ? (
                          <Badge variant="danger">
                            {t("admin.shares.revokedLabel")}
                          </Badge>
                        ) : (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0 text-destructive"
                            aria-label={t("admin.shares.revoke")}
                            title={t("admin.shares.revoke")}
                            disabled={busy === row.id}
                            data-testid={`admin-share-revoke-${row.id}`}
                            onClick={() => setPendingRevoke(row)}
                          >
                            {busy === row.id ? (
                              <RefreshCw
                                className="h-3.5 w-3.5 animate-spin"
                                aria-hidden
                              />
                            ) : (
                              <Trash2 className="h-3.5 w-3.5" aria-hidden />
                            )}
                          </Button>
                        )}
                      </div>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        )}
        {!list.loading && !list.error && (rows.length > 0 || list.total > 0) ? (
          <Pagination
            total={list.total}
            limit={list.limit}
            offset={list.offset}
            statusLimit={list.pageLimit}
            statusOffset={list.pageOffset}
            onChange={list.setOffset}
            onLimitChange={list.setLimit}
          />
        ) : null}
      </Panel>

      <ConfirmDialog
        open={pendingRevoke !== null}
        title={t("admin.shares.confirm.title")}
        body={t("admin.shares.confirm.body")}
        confirmLabel={t("admin.shares.revoke")}
        busy={pendingRevoke !== null && busy === pendingRevoke.id}
        onConfirm={() => {
          const id = pendingRevoke?.id;
          setPendingRevoke(null);
          if (id !== undefined) void revoke(id);
        }}
        onClose={() => setPendingRevoke(null)}
      />
    </div>
  );
}
