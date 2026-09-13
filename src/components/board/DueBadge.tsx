import { CalendarClock } from "lucide-react";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  formatDate,
  formatDateOnly,
  formatTime,
  useHour12,
  useI18n,
} from "@/i18n";
import { dueStatus, type DueStatus } from "@/utils/due-date";

interface DueBadgeProps {
  /** The card's due date (Unix ms) — always defined here. */
  dueDate: number;
}

/**
 * The due-date badge shared by the card front and the table view:
 * overdue (red) / due within 24h (yellow) / later (muted),
 * `date · time` text and a full-timestamp tooltip.
 */
export function DueBadge({ dueDate }: DueBadgeProps) {
  const { t, lang } = useI18n();
  const hour12 = useHour12();
  const status = dueStatus(dueDate);
  const due = new Date(dueDate);
  const dueTime = formatTime(
    `${String(due.getHours()).padStart(2, "0")}:${String(due.getMinutes()).padStart(2, "0")}`,
    lang,
    hour12,
  );

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={cn(
            "inline-flex h-5 items-center gap-1 rounded-md border px-1.5 text-[11px] font-medium tabular-nums transition-colors",
            status === "overdue" && "border-danger/40 bg-danger/10 text-danger",
            status === "soon" && "border-warning/40 bg-warning/10 text-warning",
            status === "later" &&
              "border-border/60 bg-muted/50 text-muted-foreground group-hover:border-primary/40 group-hover:text-primary",
          )}
          data-testid="card-due-badge"
          data-due-status={status}
        >
          <CalendarClock className="h-3.5 w-3.5" aria-hidden />
          {formatDateOnly(dueDate, lang)}
          {" · "}
          {dueTime}
        </span>
      </TooltipTrigger>
      <TooltipContent>
        {t(`dueDate.${status as DueStatus}`, {
          date: formatDate(dueDate, lang, hour12),
        })}
      </TooltipContent>
    </Tooltip>
  );
}
