import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import { shortId } from "./agent-model";

interface AgentAttributionProps {
  apiTokenId?: string | null;
  agentSessionId?: string | null;
  runId?: string | null;
  /** Token-name snapshot captured at write time. */
  agentName?: string | null;
  className?: string;
  /** Hide the labels and keep only the compact `token:abc` chips. */
  compact?: boolean;
}

/**
 * The TASK-166 identity line: which personal token, agent session and run
 * issued a record. Human records pass no fields and render nothing, so the
 * existing human attribution is untouched.
 */
export function AgentAttribution({
  apiTokenId,
  agentSessionId,
  runId,
  agentName,
  className,
  compact = false,
}: AgentAttributionProps) {
  const { t } = useI18n();
  const chips = [
    apiTokenId
      ? {
          key: "token",
          label: t("agents.attribution.token"),
          value: apiTokenId,
        }
      : null,
    agentSessionId
      ? {
          key: "session",
          label: t("agents.attribution.session"),
          value: agentSessionId,
        }
      : null,
    runId
      ? {
          key: "run",
          label: t("agents.attribution.run"),
          value: runId,
        }
      : null,
  ].filter((chip): chip is NonNullable<typeof chip> => chip !== null);

  if (chips.length === 0 && !agentName) return null;

  return (
    <span
      data-testid="agent-attribution"
      className={cn(
        "inline-flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-muted-foreground",
        className,
      )}
    >
      {agentName ? (
        <span
          data-testid="agent-attribution-name"
          className="max-w-[12rem] truncate font-medium text-foreground/80"
          title={agentName}
        >
          {agentName}
        </span>
      ) : null}
      {chips.length > 0 ? (
        <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-0.5">
          {chips.map((chip) => (
            <span
              key={chip.key}
              data-testid={`agent-attribution-${chip.key}`}
              className="inline-flex items-baseline gap-1 font-mono"
              title={`${chip.label}: ${chip.value}`}
            >
              {compact ? null : (
                <span className="font-sans text-muted-foreground/70">
                  {chip.label}
                </span>
              )}
              <span className="text-foreground/70">{shortId(chip.value)}</span>
            </span>
          ))}
        </span>
      ) : null}
    </span>
  );
}
