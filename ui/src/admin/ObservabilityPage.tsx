import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { AdminObservabilityDto } from "@janosik/shared";
import { adminApi } from "./admin-client";
import { useAdminT, type AdminMessageKey } from "./admin-i18n";
import { formatDate, useHour12, useI18n } from "@/i18n";
import { useTheme } from "@/hooks/use-theme";
import {
  useOnline,
  useServiceWorkerStatus,
  useStandalone,
  type ServiceWorkerStatus,
} from "@/hooks/use-client-state";
import { useAppVersion } from "@/utils/app-version";
import { Badge, ErrorState, PageHeader, Panel, Table, Td, Th } from "./ui";
import { SettingsSkeleton } from "./skeletons";

/** Localised labels for the "frontend" panel's enumerated states. */
const THEME_LABEL: Record<"light" | "dark", AdminMessageKey> = {
  light: "admin.observability.frontend.theme.light",
  dark: "admin.observability.frontend.theme.dark",
};
const SERVICE_WORKER_LABEL: Record<ServiceWorkerStatus, AdminMessageKey> = {
  unsupported: "admin.observability.frontend.sw.unsupported",
  unregistered: "admin.observability.frontend.sw.unregistered",
  installing: "admin.observability.frontend.sw.installing",
  active: "admin.observability.frontend.sw.active",
};

/**
 * TASK-185.6: human-readable text bytes for the comment-history panel.
 * The API sends counts and byte sizes only, never comment text.
 */
function formatBytes(bytes: number): string {
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

/**
 * Observability (TASK-64): version/deploy, database size + biggest tables,
 * background jobs, health, and the state of the frontend serving the panel.
 * The announcement history lives on its own entity page
 * (`/admin/announcements`), linked from here.
 */
export function ObservabilityPage() {
  const t = useAdminT();
  const { lang } = useI18n();
  const hour12 = useHour12();
  const { theme } = useTheme();
  const appVersion = useAppVersion();
  const serviceWorker = useServiceWorkerStatus();
  const standalone = useStandalone();
  const online = useOnline();
  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");
  const [data, setData] = useState<AdminObservabilityDto | null>(null);

  // The fetch itself never sets the phase synchronously, so the mount effect
  // stays lint-clean; the retry wrapper flips back to "loading" first.
  const fetchData = useCallback(() => {
    adminApi
      .getObservability()
      .then((snapshot) => {
        setData(snapshot);
        setPhase("ready");
      })
      .catch(() => setPhase("error"));
  }, []);

  // TASK-94: a retry must re-fetch, not just flip the phase back to loading
  // (which left a permanent spinner).
  const load = useCallback(() => {
    setPhase("loading");
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  if (phase === "loading")
    return (
      <SettingsSkeleton testId="admin-observability-skeleton" panels={3} wide />
    );
  if (phase === "error" || !data) {
    return <ErrorState onRetry={load} />;
  }

  // A failed/timed-out aggregate must not look like a healthy zero.
  const historyValue = (value: string): string =>
    data.commentHistory.available ? value : "—";

  return (
    <div className="w-full max-w-4xl space-y-4 p-4">
      <PageHeader
        title={t("admin.observability.title")}
        subtitle={t("admin.observability.subtitle")}
      />

      <Panel className="p-4">
        <div className="grid grid-cols-2 gap-3 text-ui-body sm:grid-cols-4">
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

      <Panel className="p-4" data-testid="admin-observability-frontend">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-ui-body font-medium">
            {t("admin.observability.frontend")}
          </h2>
          <span className="text-ui-label text-muted-foreground">
            {t("admin.observability.frontend.hint")}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-3 text-ui-body sm:grid-cols-4">
          <Field
            label={t("admin.observability.frontend.appVersion")}
            value={appVersion?.version ?? "—"}
          />
          <Field
            label={t("admin.observability.frontend.build")}
            value={appVersion?.build ?? "—"}
          />
          <Field
            label={t("admin.observability.frontend.commit")}
            value={appVersion?.commit ?? "—"}
          />
          <Field
            label={t("admin.observability.frontend.theme")}
            value={t(THEME_LABEL[theme])}
          />
          <StateField
            label={t("admin.observability.frontend.sw")}
            value={t(SERVICE_WORKER_LABEL[serviceWorker])}
            ok={serviceWorker === "active"}
          />
          <Field
            label={t("admin.observability.frontend.display")}
            value={t(
              standalone
                ? "admin.observability.frontend.display.standalone"
                : "admin.observability.frontend.display.browser",
            )}
          />
          <StateField
            label={t("admin.observability.frontend.connection")}
            value={t(
              online
                ? "admin.observability.frontend.connection.online"
                : "admin.observability.frontend.connection.offline",
            )}
            ok={online}
          />
        </div>
      </Panel>

      <Panel className="p-4">
        <h2 className="mb-3 text-ui-body font-medium">
          {t("admin.observability.jobs")}
        </h2>
        <div className="grid grid-cols-2 gap-3 text-ui-body sm:grid-cols-3">
          <Field
            label={t("admin.observability.jobs.transcode")}
            value={`${data.jobs.transcode.pending} / ${data.jobs.transcode.done} / ${data.jobs.transcode.failed}`}
          />
          <Field
            label={t("admin.observability.jobs.realtime")}
            value={`${data.jobs.realtime.boards} / ${data.jobs.realtime.clients} / ${data.jobs.realtime.slowDrops}`}
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
            <p className="mb-2 text-ui-label text-muted-foreground">
              {t("admin.observability.queues")}
            </p>
            <div className="grid grid-cols-2 gap-2 text-ui-label sm:grid-cols-4">
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

      <Panel className="p-4" data-testid="admin-observability-comment-history">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-ui-body font-medium">
            {t("admin.observability.history")}
          </h2>
          <span className="text-ui-label text-muted-foreground">
            {t("admin.observability.history.hint")}
          </span>
        </div>
        {!data.commentHistory.available ? (
          <p
            className="mb-3 rounded border border-border p-2 text-ui-label text-muted-foreground"
            data-testid="admin-observability-history-unavailable"
          >
            {t("admin.observability.history.unavailable")}
          </p>
        ) : null}
        <p
          className="mb-3 text-ui-label text-muted-foreground"
          data-testid="admin-observability-history-cache"
        >
          {t("admin.observability.history.cache")}
        </p>
        <div className="grid grid-cols-1 gap-3 text-ui-body sm:grid-cols-2">
          <MetricRow
            testId="history-revisions"
            label={t("admin.observability.history.revisions")}
            value={historyValue(String(data.commentHistory.revisions.count))}
          />
          <MetricRow
            testId="history-revision-bytes"
            label={t("admin.observability.history.revisionBytes")}
            value={historyValue(
              formatBytes(data.commentHistory.revisions.bytes),
            )}
          />
          <MetricRow
            testId="history-activity"
            label={t("admin.observability.history.activity")}
            value={historyValue(String(data.commentHistory.activity.count))}
          />
          <MetricRow
            testId="history-activity-bytes"
            label={t("admin.observability.history.activityBytes")}
            value={historyValue(
              formatBytes(data.commentHistory.activity.bytes),
            )}
          />
          <MetricRow
            testId="history-derived-trims"
            label={t("admin.observability.history.derivedTrims")}
            value={historyValue(
              String(data.commentHistory.derivedTrimmedRevisions),
            )}
          />
          <MetricRow
            testId="history-incomplete"
            label={t("admin.observability.history.incomplete")}
            value={historyValue(String(data.commentHistory.incompleteComments))}
          />
          <MetricRow
            testId="history-over-budget"
            label={t("admin.observability.history.overBudget")}
            value={historyValue(
              `${data.commentHistory.overBudget.revisions} / ${data.commentHistory.overBudget.activity}`,
            )}
          />
        </div>
        <div
          className="mt-4 grid grid-cols-1 gap-3 text-ui-body sm:grid-cols-2"
          data-testid="admin-observability-history-reasons"
        >
          <MetricRow
            testId="history-reason-legacy_cutover"
            label={t("admin.observability.history.reason.legacy_cutover")}
            value={historyValue(
              String(data.commentHistory.reasons.legacy_cutover),
            )}
          />
          <MetricRow
            testId="history-reason-revision_limit"
            label={t("admin.observability.history.reason.revision_limit")}
            value={historyValue(
              String(data.commentHistory.reasons.revision_limit),
            )}
          />
          <MetricRow
            testId="history-reason-gdpr_erase"
            label={t("admin.observability.history.reason.gdpr_erase")}
            value={historyValue(String(data.commentHistory.reasons.gdpr_erase))}
          />
          <MetricRow
            testId="history-reason-writer_gap"
            label={t("admin.observability.history.reason.writer_gap")}
            value={historyValue(String(data.commentHistory.reasons.writer_gap))}
          />
        </div>
      </Panel>

      <Panel className="p-0">
        <h2 className="p-4 text-ui-body font-medium">
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
                <Td label={t("admin.observability.table.name")}>
                  {table.name}
                </Td>
                <Td
                  label={t("admin.observability.table.rows")}
                  className="tabular-nums"
                >
                  {table.rows}
                </Td>
                <Td
                  label={t("admin.observability.table.size")}
                  className="tabular-nums"
                >
                  {(table.sizeBytes / 1024).toFixed(0)} KB
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Panel>

      <Panel className="p-4">
        <h2 className="mb-3 text-ui-body font-medium">
          {t("admin.observability.health")}
        </h2>
        <div className="space-y-2">
          {data.health.map((check) => (
            <div
              key={check.name}
              className="flex items-center gap-3 text-ui-body"
            >
              <Badge variant={check.ok ? "success" : "danger"}>
                {check.ok
                  ? t("admin.observability.ok")
                  : t("admin.observability.fail")}
              </Badge>
              <span className="font-mono text-ui-label">{check.name}</span>
              <span className="text-ui-label text-muted-foreground">
                {check.detail}
              </span>
            </div>
          ))}
        </div>
      </Panel>

      <Panel className="flex items-center justify-between gap-3 p-4">
        <div>
          <h2 className="text-ui-body font-medium">
            {t("admin.observability.news")}
          </h2>
          <p className="text-ui-label text-muted-foreground">
            {t("admin.observability.news.hint")}
          </p>
        </div>
        <Link
          className="text-ui-label underline underline-offset-2"
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
      <p className="text-ui-label text-muted-foreground">{label}</p>
      <p className="font-medium break-words [overflow-wrap:anywhere]">
        {value}
      </p>
    </div>
  );
}

/**
 * Comment-history metric row: the value shares the label's first-line
 * baseline, so a wrapped label never pushes the value out of line with its
 * neighbour. Scoped to the history panel; the runtime/frontend/jobs fields
 * keep the stacked layout that lets long commits wrap.
 */
function MetricRow({
  label,
  value,
  testId,
}: {
  label: string;
  value: string;
  testId: string;
}) {
  return (
    <div
      data-testid={testId}
      className="flex items-baseline justify-between gap-3"
    >
      <p className="min-w-0 text-ui-label text-muted-foreground">{label}</p>
      <p
        className="shrink-0 text-right font-medium tabular-nums"
        data-testid={`${testId}-value`}
      >
        {value}
      </p>
    </div>
  );
}

/** A field whose value is a status pill (ok = healthy / on). */
function StateField({
  label,
  value,
  ok,
}: {
  label: string;
  value: string;
  ok: boolean;
}) {
  return (
    <div>
      <p className="text-ui-label text-muted-foreground">{label}</p>
      <div className="mt-1">
        <Badge variant={ok ? "success" : "neutral"}>{value}</Badge>
      </div>
    </div>
  );
}
