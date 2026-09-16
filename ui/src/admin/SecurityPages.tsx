import { useState } from "react";
import { KeyRound, ShieldOff } from "lucide-react";
import type { AdminSessionRowDto, AdminTokenRowDto } from "@janosik/shared";
import { formatDate, useHour12, useI18n } from "@/i18n";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/Toast";
import { adminApi } from "./admin-client";
import { useAdminT } from "./admin-i18n";
import { useAdminList } from "./use-admin-list";
import {
  Badge,
  ConfirmDialog,
  EmptyState,
  ErrorState,
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
 * Security review (TASK-43): active sessions and personal API tokens across
 * every account, each revocable individually. This is the page to open when
 * something looks compromised.
 */

export function SessionsPage() {
  const t = useAdminT();
  const { lang } = useI18n();
  const hour12 = useHour12();
  const toast = useToast();

  const list = useAdminList<AdminSessionRowDto>((params) =>
    adminApi.listSessions(params),
  );
  const [pending, setPending] = useState<AdminSessionRowDto | null>(null);

  const revoke = async () => {
    if (pending === null) return;
    try {
      await adminApi.revokeSession(pending.id);
      toast.success(t("admin.sessions.toast.revoked"));
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
        title={t("admin.sessions.title")}
        subtitle={t("admin.sessions.subtitle", { total: list.total })}
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
          <EmptyState message={t("admin.sessions.empty")} />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>{t("admin.common.id")}</Th>
                <Th>{t("admin.sessions.col.user")}</Th>
                <Th>{t("admin.sessions.col.created")}</Th>
                <Th>{t("admin.sessions.col.expires")}</Th>
                <Th className="w-40" />
              </tr>
            </thead>
            <tbody>
              {list.items.map((session) => (
                <tr
                  key={session.id}
                  className="transition-colors hover:bg-hover/50"
                >
                  <Td>
                    <IdChip id={session.id} />
                  </Td>
                  <Td className="font-medium">{session.userEmail}</Td>
                  <Td className="text-muted-foreground">
                    {formatDate(session.createdAt, lang, hour12)}
                  </Td>
                  <Td className="text-muted-foreground">
                    {formatDate(session.expiresAt, lang, hour12)}
                  </Td>
                  <Td className="text-right">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2 text-xs text-danger hover:text-danger"
                      data-testid={`admin-session-revoke-${session.id}`}
                      onClick={() => setPending(session)}
                    >
                      <ShieldOff className="h-3.5 w-3.5" aria-hidden />
                      {t("admin.sessions.action.revoke")}
                    </Button>
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
        title={t("admin.sessions.confirm.title", {
          email: pending?.userEmail ?? "",
        })}
        body={t("admin.sessions.confirm.body")}
        confirmLabel={t("admin.sessions.action.revoke")}
        onClose={() => setPending(null)}
        onConfirm={() => void revoke()}
      />
    </>
  );
}

export function TokensPage() {
  const t = useAdminT();
  const { lang } = useI18n();
  const hour12 = useHour12();
  const toast = useToast();

  const list = useAdminList<AdminTokenRowDto>((params) =>
    adminApi.listTokens(params),
  );
  const [pending, setPending] = useState<AdminTokenRowDto | null>(null);

  const revoke = async () => {
    if (pending === null) return;
    try {
      await adminApi.revokeToken(pending.id);
      toast.success(t("admin.tokens.toast.revoked"));
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
        title={t("admin.tokens.title")}
        subtitle={t("admin.tokens.subtitle", { total: list.total })}
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
                <Th>{t("admin.tokens.col.user")}</Th>
                <Th>{t("admin.tokens.col.name")}</Th>
                <Th>{t("admin.tokens.col.created")}</Th>
                <Th>{t("admin.tokens.col.lastUsed")}</Th>
                <Th>{t("admin.tokens.col.expires")}</Th>
                <Th>{t("admin.tokens.col.status")}</Th>
                <Th className="w-24" />
              </tr>
            </thead>
            <tbody>
              {list.items.map((token) => (
                <tr
                  key={token.id}
                  className="transition-colors hover:bg-hover/50"
                >
                  <Td>
                    <IdChip id={token.id} />
                  </Td>
                  <Td className="font-medium">{token.userEmail}</Td>
                  <Td>
                    <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                      <KeyRound className="h-3 w-3" aria-hidden />
                      {token.name}
                    </span>
                  </Td>
                  <Td className="text-muted-foreground">
                    {formatDate(token.createdAt, lang, hour12)}
                  </Td>
                  <Td className="text-muted-foreground">
                    {token.lastUsedAt === null
                      ? t("admin.common.never")
                      : formatDate(token.lastUsedAt, lang, hour12)}
                  </Td>
                  <Td className="text-muted-foreground">
                    {token.expiresAt === null
                      ? "—"
                      : formatDate(token.expiresAt, lang, hour12)}
                  </Td>
                  <Td>
                    {token.revokedAt === null ? (
                      <Badge variant="success">
                        {t("admin.tokens.status.active")}
                      </Badge>
                    ) : (
                      <Badge variant="danger">
                        {t("admin.tokens.status.revoked")}
                      </Badge>
                    )}
                  </Td>
                  <Td className="text-right">
                    {token.revokedAt === null ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2 text-xs text-danger hover:text-danger"
                        data-testid={`admin-token-revoke-${token.id}`}
                        onClick={() => setPending(token)}
                      >
                        {t("admin.tokens.action.revoke")}
                      </Button>
                    ) : null}
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
        title={t("admin.tokens.confirm.title", {
          name: pending?.name ?? "",
        })}
        body={t("admin.tokens.confirm.body")}
        confirmLabel={t("admin.tokens.action.revoke")}
        onClose={() => setPending(null)}
        onConfirm={() => void revoke()}
      />
    </>
  );
}
