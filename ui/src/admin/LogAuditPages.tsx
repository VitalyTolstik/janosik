import { Command, History, ScrollText } from "lucide-react";
import type { AdminAuditRowDto, AdminCommandRowDto } from "@janosik/shared";
import { formatDate, useHour12, useI18n } from "@/i18n";
import { adminApi } from "./admin-client";
import { useAdminT } from "./admin-i18n";
import { useAdminList } from "./use-admin-list";
import {
  Badge,
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

/** Cross-board command log (TASK-36) — every `BoardAction` ever committed. */
export function LogPage() {
  const t = useAdminT();
  const { lang } = useI18n();
  const hour12 = useHour12();
  const list = useAdminList<AdminCommandRowDto>((params) =>
    adminApi.listCommands(params),
  );

  return (
    <>
      <PageHeader
        title={t("admin.log.title")}
        subtitle={t("admin.log.subtitle", { total: list.total })}
      />

      <Panel>
        <div className="flex items-center justify-between gap-2 px-3 py-2.5">
          <SearchInput value={list.search} onChange={list.setSearch} />
          <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Command className="h-3.5 w-3.5" aria-hidden />
            {t("admin.log.col.type")}
          </span>
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
                <Th>{t("admin.log.col.time")}</Th>
                <Th>{t("admin.log.col.board")}</Th>
                <Th>{t("admin.log.col.actor")}</Th>
                <Th>{t("admin.log.col.type")}</Th>
                <Th className="text-right">{t("admin.log.col.seq")}</Th>
              </tr>
            </thead>
            <tbody>
              {list.items.map((command) => (
                <tr
                  key={command.id}
                  className="transition-colors hover:bg-hover/50"
                >
                  <Td>
                    <IdChip id={command.id} />
                  </Td>
                  <Td className="tabular-nums text-muted-foreground">
                    {formatDate(command.createdAt, lang, hour12)}
                  </Td>
                  <Td className="font-medium">{command.boardTitle}</Td>
                  <Td className="text-muted-foreground">
                    {command.actorEmail}
                  </Td>
                  <Td>
                    <Badge variant="primary">{command.type}</Badge>
                  </Td>
                  <Td className="text-right tabular-nums text-muted-foreground">
                    {command.seq}
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
    </>
  );
}

/** Audit trail (TASK-36) — who among the masters did what, when. */
export function AuditPage() {
  const t = useAdminT();
  const { lang } = useI18n();
  const hour12 = useHour12();
  const list = useAdminList<AdminAuditRowDto>((params) =>
    adminApi.listAudit(params),
  );

  return (
    <>
      <PageHeader
        title={t("admin.audit.title")}
        subtitle={t("admin.audit.subtitle", { total: list.total })}
      />

      <Panel>
        <div className="flex items-center justify-between gap-2 px-3 py-2.5">
          <SearchInput value={list.search} onChange={list.setSearch} />
          <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <ScrollText className="h-3.5 w-3.5" aria-hidden />
            {t("admin.audit.col.action")}
          </span>
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
                <Th>{t("admin.audit.col.time")}</Th>
                <Th>{t("admin.audit.col.admin")}</Th>
                <Th>{t("admin.audit.col.action")}</Th>
                <Th>{t("admin.audit.col.target")}</Th>
                <Th>{t("admin.audit.col.details")}</Th>
              </tr>
            </thead>
            <tbody>
              {list.items.map((entry) => (
                <tr
                  key={entry.id}
                  className="transition-colors hover:bg-hover/50"
                >
                  <Td>
                    <IdChip id={entry.id} />
                  </Td>
                  <Td className="tabular-nums text-muted-foreground">
                    {formatDate(entry.createdAt, lang, hour12)}
                  </Td>
                  <Td>{entry.adminEmail}</Td>
                  <Td>
                    <Badge
                      variant={
                        entry.action.includes("delete") ||
                        entry.action.includes("disable") ||
                        entry.action.includes("failed")
                          ? "danger"
                          : entry.action.includes("create")
                            ? "success"
                            : "primary"
                      }
                    >
                      {entry.action}
                    </Badge>
                  </Td>
                  <Td className="text-muted-foreground">
                    {entry.targetType ? (
                      <span className="inline-flex items-center gap-1">
                        <History className="h-3 w-3" aria-hidden />
                        {entry.targetType}
                        {entry.targetId ? `:${entry.targetId.slice(0, 8)}` : ""}
                      </span>
                    ) : (
                      "—"
                    )}
                  </Td>
                  <Td className="max-w-[22rem] truncate text-[11px] text-muted-foreground">
                    {entry.details === null
                      ? "—"
                      : JSON.stringify(entry.details)}
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
    </>
  );
}
