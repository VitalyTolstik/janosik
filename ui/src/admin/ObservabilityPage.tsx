import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { AdminObservabilityDto } from "@janosik/shared";
import { adminApi } from "./admin-client";
import { useAdminT } from "./admin-i18n";
import { formatDate, useHour12, useI18n } from "@/i18n";
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
 * background jobs and health. The announcement history lives on its own
 * entity page (`/admin/announcements`), linked from here.
 */
export function ObservabilityPage() {
  const t = useAdminT();
  const { lang } = useI18n();
  const hour12 = useHour12();
  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");
  const [data, setData] = useState<AdminObservabilityDto | null>(null);

  // TASK-94: a retry must re-fetch, not just flip the phase back to loading
  // (which left a permanent spinner).
  const load = useCallback(() => {
    setPhase("loading");
    adminApi
      .getObservability()
      .then((snapshot) => {
        setData(snapshot);
        setPhase("ready");
      })
      .catch(() => setPhase("error"));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (phase === "loading") return <LoadingState />;
  if (phase === "error" || !data) {
    return <ErrorState onRetry={load} />;
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
            value={formatDate(data.deploy.startedAt, lang, hour12)}
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
        {data.jobs.queues.length > 0 ? (
          <div className="mt-4">
            <p className="mb-2 text-xs text-muted-foreground">
              {t("admin.observability.queues")}
            </p>
            <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
              {data.jobs.queues.map((queue) => (
                <div
                  key={queue.name}
                  className="rounded border border-border p-2"
                  data-testid={`admin-queue-${queue.name}`}
                >
                  <p className="font-medium">{queue.name}</p>
                  <p className="text-muted-foreground">
                    {t("admin.observability.queue.counts", {
                      pending: queue.pending,
                      done: queue.processed,
                      failed: queue.failed,
                    })}
                  </p>
                  <Badge
                    variant={queue.backend === "redis" ? "success" : "neutral"}
                  >
                    {queue.backend}
                  </Badge>
                </div>
              ))}
            </div>
          </div>
        ) : null}
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

      <Panel className="flex items-center justify-between gap-3 p-4">
        <div>
          <h2 className="text-sm font-medium">
            {t("admin.observability.news")}
          </h2>
          <p className="text-xs text-muted-foreground">
            {t("admin.observability.news.hint")}
          </p>
        </div>
        <Link
          className="text-xs underline underline-offset-2"
          to="/admin/announcements"
        >
          {t("admin.announcements.title")}
        </Link>
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
