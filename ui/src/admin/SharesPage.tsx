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
import { useAdminList } from "./use-admin-list";
import {
  Badge,
  ErrorState,
  LoadingState,
  PageHeader,
  Panel,
  SearchInput,
} from "./ui";

/**
 * Public shares (TASK-58) — every read-only link minted against any board,
 * with its mode/flags/views and a one-click revoke. The token is shown so an
 * operator can re-copy a link for support; a link whose board is gone is
 * flagged (a live share of a deleted board no longer resolves).
 *
 * Search mirrors the rest of the panel: the shared `useAdminList` debounce
 * plus `SearchInput`, not a separate button.
 */
export function SharesPage() {
  const t = useAdminT();
  const { lang } = useI18n();
  const hour12 = useHour12();
  const toast = useToast();
  const list = useAdminList<AdminShareRowDto>(
    (params) => adminApi.listShares({ ...params, limit: 100 }),
    { limit: 100 },
  );
  const { items: rows, reload } = list;
  const [busy, setBusy] = useState<string | null>(null);
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

  if (list.loading && rows.length === 0) return <LoadingState />;
  if (list.error) {
    return <ErrorState onRetry={reload} />;
  }

  return (
    <div className="w-full max-w-5xl space-y-4 p-4">
      <PageHeader
        title={t("admin.shares.title")}
        subtitle={t("admin.shares.subtitle")}
        actions={<SearchInput value={list.search} onChange={list.setSearch} />}
      />

      <Panel className="p-0">
        {rows.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">
            {t("admin.shares.empty")}
          </p>
        ) : (
          <table className="w-full text-sm" data-testid="admin-shares-table">
            <thead className="border-b text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-3 py-2">{t("admin.shares.col.board")}</th>
                <th className="px-3 py-2">{t("admin.shares.col.mode")}</th>
                <th className="px-3 py-2">{t("admin.shares.col.flags")}</th>
                <th className="px-3 py-2">{t("admin.shares.col.views")}</th>
                <th className="px-3 py-2">{t("admin.shares.col.created")}</th>
                <th className="px-3 py-2 text-right">
                  {t("admin.shares.col.actions")}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b last:border-0">
                  <td className="px-3 py-2">
                    <div className="flex flex-col">
                      {row.boardDeleted ? (
                        <span className="text-muted-foreground">
                          {row.boardTitle ?? row.boardId}
                          {row.revokedAt === null ? (
                            <span
                              className="ml-2 inline-flex"
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
                        </span>
                      ) : (
                        <Link
                          to={`/admin/boards/${row.boardId}`}
                          className="text-foreground hover:underline"
                        >
                          {row.boardTitle ?? row.boardId}
                        </Link>
                      )}
                      <code className="font-mono text-[11px] text-muted-foreground">
                        /s/{row.token}
                      </code>
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <Badge variant="neutral">
                      {row.mode === "live"
                        ? t("admin.shares.mode.live")
                        : t("admin.shares.mode.snapshot")}
                    </Badge>
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {[
                      row.includeComments
                        ? t("admin.shares.flag.comments")
                        : null,
                      row.includeAttachments
                        ? t("admin.shares.flag.attachments")
                        : null,
                    ]
                      .filter(Boolean)
                      .join(" · ") || "—"}
                  </td>
                  <td className="px-3 py-2 tabular-nums text-muted-foreground">
                    {row.views}
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {formatDate(row.createdAt, lang, hour12)}
                  </td>
                  <td className="px-3 py-2">
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
                          onClick={() => void revoke(row.id)}
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
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </div>
  );
}
