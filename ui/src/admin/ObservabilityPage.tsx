import { useEffect, useState } from "react";
import type { AdminObservabilityDto } from "@janosik/shared";
import { adminApi } from "./admin-client";
import { useAdminT } from "./admin-i18n";
import {
  Badge,
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
 * background jobs and a compact health table.
 */
export function ObservabilityPage() {
  const t = useAdminT();
  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");
  const [data, setData] = useState<AdminObservabilityDto | null>(null);

  useEffect(() => {
    adminApi
      .getObservability()
      .then((snapshot) => {
        setData(snapshot);
        setPhase("ready");
      })
      .catch(() => setPhase("error"));
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
