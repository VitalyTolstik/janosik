import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  BarChart3,
  CreditCard,
  Database,
  MessageSquare,
  ShieldCheck,
  Users,
  UserX,
  KanbanSquare,
} from "lucide-react";
import type { AdminAuditRowDto, AdminMetricsDto } from "@janosik/shared";
import { Button } from "@/components/ui/button";
import { useHour12, useI18n, formatDate } from "@/i18n";
import { cn } from "@/lib/utils";
import { adminApi } from "./admin-client";
import { useAdminT } from "./admin-i18n";
import { Chart } from "./chart/chart";
import { DashboardSkeleton } from "./skeletons";
import { ErrorState, PageHeader, Panel } from "./ui";

/**
 * Dashboard (TASK-36): platform counters, 14-day sparklines and the latest
 * admin activity — all produced by a single `GET /admin/metrics` plus a
 * small audit page.
 */

function StatCard({
  icon: Icon,
  label,
  value,
  hint,
  accent = "text-primary",
  testId,
}: {
  icon: typeof Users;
  label: string;
  value: number | string;
  hint?: string;
  accent?: string;
  testId: string;
}) {
  return (
    <Panel className="flex items-start gap-3 p-3.5" data-testid={testId}>
      <span
        className={cn(
          "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border bg-background/60",
          accent,
        )}
      >
        <Icon className="h-4 w-4" aria-hidden />
      </span>
      <div className="min-w-0">
        <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
          {label}
        </p>
        <p className="text-xl font-semibold tabular-nums tracking-tight text-foreground">
          {value}
        </p>
        {hint ? (
          <p className="truncate text-[11px] text-muted-foreground">{hint}</p>
        ) : null}
      </div>
    </Panel>
  );
}

function RuntimeItem({ label, value }: { label: string; value: string }) {
  return (
    <span className="flex items-baseline gap-1.5">
      <span className="text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
        {label}
      </span>
      <span className="font-mono text-[11px] text-foreground">{value}</span>
    </span>
  );
}

function AttentionItem({
  icon: Icon,
  label,
  value,
  hint,
  to,
}: {
  icon: typeof Users;
  label: string;
  value: number;
  hint: string;
  to: string;
}) {
  return (
    <Link
      to={to}
      className="group flex items-start gap-2.5 rounded-lg border border-border bg-card/60 px-3 py-2.5 transition-colors hover:border-primary/30 hover:bg-card"
      title={hint}
    >
      <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-warning/25 bg-warning/10 text-warning">
        <Icon className="h-3.5 w-3.5" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-2">
          <span className="truncate text-[11px] font-medium text-foreground">
            {label}
          </span>
          <span className="tabular-nums text-sm font-semibold text-foreground">
            {value}
          </span>
        </span>
        <span className="mt-0.5 flex items-center gap-1 text-[10px] text-muted-foreground">
          <span className="line-clamp-1">{hint}</span>
          <ArrowRight
            className="h-3 w-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
            aria-hidden
          />
        </span>
      </span>
    </Link>
  );
}

function formatUptime(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m ${seconds % 60}s`;
}

export function DashboardPage() {
  const t = useAdminT();
  const { lang } = useI18n();
  const hour12 = useHour12();
  const [metrics, setMetrics] = useState<AdminMetricsDto | null>(null);
  const [recent, setRecent] = useState<AdminAuditRowDto[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");

  const load = useCallback(() => {
    setState("loading");
    void Promise.all([adminApi.metrics(), adminApi.listAudit({ limit: 8 })])
      .then(([nextMetrics, audit]) => {
        setMetrics(nextMetrics);
        setRecent(audit.items);
        setState("ready");
      })
      .catch(() => setState("error"));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (state === "loading") return <DashboardSkeleton />;
  if (state === "error" || metrics === null)
    return <ErrorState onRetry={load} />;

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-4">
      <PageHeader
        eyebrow={t("admin.dashboard.eyebrow")}
        title={t("admin.title")}
        subtitle={t("admin.subtitle")}
        actions={
          <Button size="sm" variant="outline" onClick={load}>
            {t("admin.common.refresh")}
          </Button>
        }
      />

      <Panel
        className="flex flex-wrap items-center gap-x-6 gap-y-1.5 px-3 py-2 text-[11px] text-muted-foreground"
        role="status"
      >
        <span className="inline-flex items-center gap-1.5 text-foreground">
          <span className="h-1.5 w-1.5 rounded-full bg-success" aria-hidden />
          {t("admin.dashboard.status.ok")}
        </span>
        <span className="hidden h-3 w-px bg-border sm:block" aria-hidden />
        <RuntimeItem
          label={t("admin.dashboard.version")}
          value={metrics.runtime.version}
        />
        <RuntimeItem
          label={t("admin.dashboard.uptime")}
          value={formatUptime(metrics.runtime.uptimeSec)}
        />
        <RuntimeItem
          label={t("admin.dashboard.database")}
          value={`${metrics.runtime.databaseLatencyMs} ms`}
        />
        <RuntimeItem
          label={t("admin.dashboard.environment")}
          value={metrics.runtime.nodeEnv}
        />
      </Panel>

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">
        <StatCard
          icon={Users}
          label={t("admin.dashboard.users")}
          value={metrics.users.total}
          hint={t("admin.dashboard.usersHint", { count: metrics.users.last7d })}
          testId="admin-stat-users"
        />
        <StatCard
          icon={KanbanSquare}
          label={t("admin.dashboard.boards")}
          value={metrics.boards.active}
          hint={t("admin.dashboard.boardsHint", {
            archived: metrics.boards.archived,
          })}
          accent="text-secondary"
          testId="admin-stat-boards"
        />
        <StatCard
          icon={CreditCard}
          label={t("admin.dashboard.cards")}
          value={metrics.cards.active}
          hint={t("admin.dashboard.cardsHint", {
            archived: metrics.cards.archived,
          })}
          accent="text-secondary"
          testId="admin-stat-cards"
        />
        <StatCard
          icon={Activity}
          label={t("admin.dashboard.commands")}
          value={metrics.commands.last24h}
          hint={t("admin.dashboard.commandsHint", {
            count: metrics.commands.last7d,
          })}
          accent="text-warning"
          testId="admin-stat-commands"
        />
        <StatCard
          icon={Database}
          label={t("admin.dashboard.sessions")}
          value={metrics.sessions.active}
          accent="text-success"
          testId="admin-stat-sessions"
        />
        <StatCard
          icon={ShieldCheck}
          label={t("admin.dashboard.admins")}
          value={metrics.admins.total}
          accent="text-primary"
          testId="admin-stat-admins"
        />
      </div>

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          icon={UserX}
          label={t("admin.dashboard.disabled")}
          value={metrics.users.disabled}
          accent="text-danger"
          testId="admin-stat-disabled"
        />
        <StatCard
          icon={MessageSquare}
          label={t("admin.dashboard.comments")}
          value={metrics.comments.total}
          testId="admin-stat-comments"
        />
        <AttentionItem
          icon={AlertTriangle}
          label={t("admin.dashboard.attention.blocked")}
          value={metrics.users.disabled}
          hint={t("admin.dashboard.attention.blockedHint")}
          to="/admin/users?status=disabled"
        />
        <AttentionItem
          icon={KanbanSquare}
          label={t("admin.dashboard.attention.archived")}
          value={metrics.boards.archived}
          hint={t("admin.dashboard.attention.archivedHint")}
          to="/admin/boards?status=archived"
        />
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <Panel className="space-y-3 p-4">
          <div className="flex items-center gap-2">
            <BarChart3 className="h-3.5 w-3.5 text-primary" aria-hidden />
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {t("admin.dashboard.registrations")}
            </h2>
          </div>
          <Chart
            x={metrics.registrationsByDay.map((_, index) => index)}
            series={[
              {
                label: t("admin.dashboard.registrations"),
                values: metrics.registrationsByDay.map((point) => point.count),
                colorToken: "--primary",
              },
            ]}
            xFormat={(value) =>
              metrics.registrationsByDay[value]?.date.slice(5) ?? ""
            }
            xTicks={[0, 4, 8, 13]}
            xLabel={t("admin.chart.day")}
            height={160}
            ariaLabel={t("admin.dashboard.registrations")}
            testId="admin-chart-registrations"
          />
        </Panel>
        <Panel className="space-y-3 p-4">
          <div className="flex items-center gap-2">
            <Activity className="h-3.5 w-3.5 text-secondary" aria-hidden />
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {t("admin.dashboard.activity")}
            </h2>
          </div>
          <Chart
            x={metrics.commandsByDay.map((_, index) => index)}
            series={[
              {
                label: t("admin.dashboard.activity"),
                values: metrics.commandsByDay.map((point) => point.count),
                colorToken: "--secondary",
              },
            ]}
            xFormat={(value) =>
              metrics.commandsByDay[value]?.date.slice(5) ?? ""
            }
            xTicks={[0, 4, 8, 13]}
            xLabel={t("admin.chart.day")}
            height={160}
            ariaLabel={t("admin.dashboard.activity")}
            testId="admin-chart-commands"
          />
        </Panel>
      </div>

      <Panel>
        <div className="flex items-center justify-between px-4 py-3">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t("admin.dashboard.recentAudit")}
          </h2>
          <Link
            to="/admin/audit"
            className="text-[11px] text-primary transition-colors hover:text-primary/80"
          >
            {t("admin.dashboard.openAudit")}
          </Link>
        </div>
        <ul className="divide-y divide-border/60 border-t border-border">
          {recent.map((entry) => (
            <li
              key={entry.id}
              className="flex items-center justify-between gap-3 px-4 py-2"
            >
              <div className="flex min-w-0 items-center gap-2">
                <span className="truncate text-xs text-foreground">
                  {entry.action}
                </span>
                <span className="truncate text-[11px] text-muted-foreground">
                  {entry.adminEmail}
                </span>
              </div>
              <time className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                {formatDate(entry.createdAt, lang, hour12)}
              </time>
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}
