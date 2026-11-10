import type { AgentSessionStatus } from "@janosik/shared";

import { formatRelative, useHour12, useI18n } from "@/i18n";
import { cn } from "@/lib/utils";

const STATUS_CLASS: Record<AgentSessionStatus, string> = {
  active: "border-success/40 bg-success/10 text-success",
  idle: "border-border bg-hover text-muted-foreground",
  waiting_approval: "border-warning/40 bg-warning/10 text-warning",
  completed: "border-primary/30 bg-primary/10 text-primary",
  failed: "border-danger/40 bg-danger/10 text-danger",
  cancelled: "border-border bg-hover text-muted-foreground",
};

export function AgentStatusBadge({
  status,
  className,
}: {
  status: AgentSessionStatus;
  className?: string;
}) {
  const { t } = useI18n();
  return (
    <span
      data-testid={`agent-status-${status}`}
      className={cn(
        "inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide",
        STATUS_CLASS[status],
        className,
      )}
    >
      {t(`agents.status.${status}`)}
    </span>
  );
}

export function AgentStaleBadge({ className }: { className?: string }) {
  const { t } = useI18n();
  return (
    <span
      data-testid="agent-stale-badge"
      className={cn(
        "inline-flex items-center gap-1 rounded-md border border-warning/40 bg-warning/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-warning",
        className,
      )}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-warning" aria-hidden />
      {t("agents.status.stale")}
    </span>
  );
}

export function AgentPauseBadge({
  scope,
  className,
  title,
}: {
  scope: "board" | "token" | "session";
  className?: string;
  title?: string;
}) {
  const { t } = useI18n();
  return (
    <span
      data-testid={`agent-pause-badge-${scope}`}
      title={title}
      className={cn(
        "inline-flex items-center gap-1 rounded-md border border-warning/40 bg-warning/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-warning",
        className,
      )}
    >
      {t(`agents.pause.scope.${scope}`)}
    </span>
  );
}

/** A relative heartbeat timestamp with the exact time in its tooltip. */
export function AgentLastSeen({
  at,
  className,
  prefix,
}: {
  at: number;
  className?: string;
  /** Prefix such as "Last seen"; omitted when the caller renders its own. */
  prefix?: string;
}) {
  const { lang } = useI18n();
  const hour12 = useHour12();
  const exact = new Date(at).toLocaleString(lang === "ru" ? "ru-RU" : "en-US", {
    hour12,
  });
  return (
    <span
      className={cn("inline-flex min-w-0 items-baseline gap-1", className)}
      title={exact}
      data-testid="agent-last-seen"
    >
      {prefix ? (
        <span className="text-muted-foreground/70">{prefix}</span>
      ) : null}
      <span className="truncate">
        {/* eslint-disable-next-line react-hooks/purity -- relative time is refreshed on purpose */}
        {formatRelative(at, lang, Date.now(), hour12)}
      </span>
    </span>
  );
}

export function AgentLiveDot({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-block h-2 w-2 shrink-0 rounded-full bg-success shadow-[0_0_0_3px] shadow-success/15",
        className,
      )}
    />
  );
}
