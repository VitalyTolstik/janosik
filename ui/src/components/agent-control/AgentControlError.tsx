import { AlertTriangle, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n";

/**
 * The mockup's error state for the board-scoped Agent control tabs: a
 * red-tinted card with an alert icon, a title, a descriptive body and one
 * Retry next to the error. It replaces the bare centered text and dashed
 * placeholders that used to leave stale list/detail chrome around them.
 */
export function AgentControlError({
  title,
  body,
  onRetry,
  testId,
  retryTestId,
}: {
  title: string;
  body: string;
  onRetry: () => void;
  testId?: string;
  retryTestId?: string;
}) {
  const { t } = useI18n();
  return (
    <div
      role="alert"
      data-testid={testId}
      className="mx-4 mt-3 flex items-start gap-2.5 rounded-[8px] border border-danger/35 bg-danger/6 p-3.5 max-md:mx-3"
    >
      <AlertTriangle
        className="mt-px h-4 w-4 shrink-0 text-[color:var(--agent-tone-danger)]"
        aria-hidden
      />
      <div className="min-w-0">
        <h3 className="m-0 mb-0.5 text-[12px] font-[650] leading-[1.3]">
          {title}
        </h3>
        <p className="m-0 mb-2 text-[11px] leading-[1.5] text-muted-foreground">
          {body}
        </p>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={onRetry}
          data-testid={retryTestId}
          className="h-7 min-h-0 rounded-[6px] px-[9px] text-[11px] font-[650] leading-none max-md:h-11 max-md:min-h-11"
        >
          <RefreshCw className="h-3.5 w-3.5" aria-hidden />
          {t("agentControl.retry")}
        </Button>
      </div>
    </div>
  );
}
