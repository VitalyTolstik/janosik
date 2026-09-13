import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";

/**
 * Whether the "N characters left" counter is visible: only near the limit
 * (last ~20%, at least 10 chars) — a constant character count is noise.
 */
export function showRemaining(length: number, limit: number): boolean {
  return length > limit - Math.max(10, Math.round(limit * 0.2));
}

interface LimitCounterProps {
  /** Current input length in characters. */
  length: number;
  /** The field's LIMITS bound. */
  limit: number;
  /** Stable test hook (e.g. "card-title-counter"). */
  testId?: string;
  /** For a11y: pair the counter with its input via aria-describedby. */
  id?: string;
  /**
   * "static" renders a block under the input (dialogs, forms);
   * "below" absolutely positions it just under a compact inline input
   * (header title, checklist rows, search bars) without layout shift —
   * the nearest positioned ancestor must be the input's wrapper.
   */
  position?: "static" | "below";
  className?: string;
}

/**
 * The "осталось N символов / N characters left" hint shared by every
 * text input (TASK-20). Turns red when the remainder gets critical.
 */
export function LimitCounter({
  length,
  limit,
  testId,
  id,
  position = "static",
  className,
}: LimitCounterProps) {
  const { t } = useI18n();
  if (!showRemaining(length, limit)) return null;

  const remaining = Math.max(0, limit - length);
  const danger = remaining <= Math.max(5, Math.round(limit * 0.1));
  return (
    <p
      aria-live="polite"
      className={cn(
        "text-[11px] tabular-nums",
        position === "below" &&
          "absolute left-0 top-full z-10 mt-0.5 max-w-full rounded bg-background/90 px-1 backdrop-blur-sm",
        danger ? "font-medium text-danger" : "text-muted-foreground",
        className,
      )}
      data-testid={testId}
      id={id}
    >
      {t("limits.remaining", { count: remaining })}
    </p>
  );
}
