import { useEffect, useState } from "react";
import type {
  AdminAnnouncementDto,
  AdminObservabilityDto,
} from "@janosik/shared";
import { adminApi } from "./admin-client";
import { useAdminT } from "./admin-i18n";
import {
  Badge,
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
  Panel,
  Table,
  Td,
  Th,
} from "./ui";

/**
 * Observability (TASK-64): version/deploy, database size + biggest tables,
 * background jobs, health — and the full announcements/news table (TASK-62),
 * which lives here as its own browsable entity so a large history stays
 * reviewable even when the composer is busy.
 */
export function ObservabilityPage() {
  const t = useAdminT();
  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");
  const [data, setData] = useState<AdminObservabilityDto | null>(null);
  const [announcements, setAnnouncements] = useState<AdminAnnouncementDto[]>(
    [],
  );

  useEffect(() => {
    adminApi
      .getObservability()
      .then((snapshot) => {
        setData(snapshot);
        setPhase("ready");
      })
      .catch(() => setPhase("error"));
    adminApi
      .listAnnouncements()
      .then(setAnnouncements)
      .catch(() => undefined);
  }, []);

  if (phase === "loading") return <LoadingState />;
  if (phase === "error" || !data) {
    return (
      <ErrorState
        onRetry={() => {
          setPhase("loading");
        }}
      />
    );
  }

  return (
    <div className="w-full max-w-4xl space-y-4 p-4">
      <PageHeader
        title={t("admin.observability.title")}
        subtitle={t("admin.observability.subtitle")}
      />

      <Panel className="p-4">
        <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <Field
            label={t("admin.observability.version")}
            value={data.version}
          />
          <Field label={t("admin.observability.node")} value={data.nodeEnv} />
          <Field
            label={t("admin.observability.uptime")}
            value={`${Math.round(data.uptimeSec / 60)} min`}
          />
          <Field
            label={t("admin.observability.started")}
            value={new Date(data.deploy.startedAt).toLocaleString()}
          />
          <Field
            label={t("admin.observability.dbSize")}
            value={data.database.sizePretty}
          />
          <Field
            label={t("admin.observability.commit")}
            value={data.deploy.commit ?? "—"}
          />
        </div>
      </Panel>

      <Panel className="p-4">
        <h2 className="mb-3 text-sm font-medium">
          {t("admin.observability.jobs")}
        </h2>
        <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
          <Field
            label={t("admin.observability.jobs.transcode")}
            value={`${data.jobs.transcode.pending} / ${data.jobs.transcode.done} / ${data.jobs.transcode.failed}`}
          />
          <Field
            label={t("admin.observability.jobs.realtime")}
            value={`${data.jobs.realtime.boards} / ${data.jobs.realtime.clients}`}
          />
          <Field
            label={t("admin.observability.jobs.demo")}
            value={
              data.jobs.demo.running
                ? t("admin.observability.on")
                : t("admin.observability.off")
            }
          />
        </div>
      </Panel>

      <Panel className="p-0">
        <h2 className="p-4 text-sm font-medium">
          {t("admin.observability.tables")}
        </h2>
        <Table maxHeight="22rem">
          <thead>
            <tr>
              <Th>{t("admin.observability.table.name")}</Th>
              <Th>{t("admin.observability.table.rows")}</Th>
              <Th>{t("admin.observability.table.size")}</Th>
            </tr>
          </thead>
          <tbody>
            {data.database.tables.map((table) => (
              <tr key={table.name} className="border-b last:border-0">
                <Td>{table.name}</Td>
                <Td className="tabular-nums">{table.rows}</Td>
                <Td className="tabular-nums">
                  {(table.sizeBytes / 1024).toFixed(0)} KB
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Panel>

      <Panel className="p-4">
        <h2 className="mb-3 text-sm font-medium">
          {t("admin.observability.health")}
        </h2>
        <div className="space-y-2">
          {data.health.map((check) => (
            <div key={check.name} className="flex items-center gap-3 text-sm">
              <Badge variant={check.ok ? "success" : "danger"}>
                {check.ok
                  ? t("admin.observability.ok")
                  : t("admin.observability.fail")}
              </Badge>
              <span className="font-mono text-xs">{check.name}</span>
              <span className="text-xs text-muted-foreground">
                {check.detail}
              </span>
            </div>
          ))}
        </div>
      </Panel>

      <Panel className="p-0">
        <h2 className="p-4 text-sm font-medium">
          {t("admin.observability.news")}
        </h2>
        {announcements.length === 0 ? (
          <EmptyState message={t("admin.comms.announcements.empty")} />
        ) : (
          <Table maxHeight="28rem">
            <thead>
              <tr>
                <Th>{t("admin.comms.col.title")}</Th>
                <Th>{t("admin.comms.col.level")}</Th>
                <Th>{t("admin.comms.col.audience")}</Th>
                <Th>{t("admin.comms.col.email")}</Th>
                <Th>{t("admin.comms.active")}</Th>
                <Th>{t("admin.comms.col.created")}</Th>
              </tr>
            </thead>
            <tbody>
              {announcements.map((row) => (
                <tr key={row.id}>
                  <Td>
                    <p className="font-medium">{row.title}</p>
                    <p className="max-w-md truncate text-xs text-muted-foreground">
                      {row.body}
                    </p>
                  </Td>
                  <Td>
                    <Badge
                      variant={row.level === "danger" ? "danger" : "neutral"}
                    >
                      {t(`admin.comms.level.${row.level}`)}
                    </Badge>
                  </Td>
                  <Td className="text-xs text-muted-foreground">
                    {row.audience === "all"
                      ? t("admin.comms.audience.all")
                      : (row.segment ?? t("admin.comms.audience.segment"))}
                  </Td>
                  <Td>
                    {row.sendEmail ? (
                      <Badge variant="primary">email</Badge>
                    ) : (
                      "—"
                    )}
                  </Td>
                  <Td>
                    {row.active ? (
                      <Badge variant="success">
                        {t("admin.observability.on")}
                      </Badge>
                    ) : (
                      <Badge variant="neutral">
                        {t("admin.observability.off")}
                      </Badge>
                    )}
                  </Td>
                  <Td className="text-xs text-muted-foreground">
                    {new Date(row.createdAt).toLocaleString()}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Panel>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="font-medium">{value}</p>
    </div>
  );
}
