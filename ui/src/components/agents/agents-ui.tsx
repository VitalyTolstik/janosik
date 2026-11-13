import type { AgentSessionStatus } from "@janosik/shared";

import { formatRelative, useHour12, useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import { StatusBadge, type StatusTone } from "./status-badge";

const STATUS_TONE: Record<AgentSessionStatus, StatusTone> = {
  active: "ok",
  idle: "muted",
  waiting_approval: "warn",
  completed: "primary",
  failed: "bad",
  cancelled: "muted",
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
    <StatusBadge
      label={t(`agents.status.${status}`)}
      tone={STATUS_TONE[status]}
      status={status}
      testId={`agent-status-${status}`}
      className={className}
    />
  );
}

export function AgentStaleBadge({ className }: { className?: string }) {
  const { t } = useI18n();
  return (
    <StatusBadge
      label={t("agents.status.stale")}
      tone="warn"
      testId="agent-stale-badge"
      className={className}
    />
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
    <StatusBadge
      label={t(`agents.pause.scope.${scope}`)}
      tone="warn"
      withDot={false}
      title={title}
      testId={`agent-pause-badge-${scope}`}
      className={className}
    />
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
      {prefix ? <span className="text-muted-foreground">{prefix}</span> : null}
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
