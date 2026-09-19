import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n";
import type { CardPriority } from "@janosik/shared";
import { PRIORITY_META } from "@/utils/priority";

/**
 * The colored priority badge (TASK-45): the Jira-style icon in the
 * priority's color with an accessible name. On the card face it renders
 * only when the card deviates from the default — a board of "medium"
 * cards stays quiet.
 */
export function PriorityBadge({
  priority,
  className,
  showLabel = false,
}: {
  priority: CardPriority;
  className?: string;
  /** Render the localized name after the icon (pickers, table cells). */
  showLabel?: boolean;
}) {
  const { t } = useI18n();
  const meta = PRIORITY_META[priority];
  const Icon = meta.icon;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-xs font-medium",
        meta.iconClass,
        className,
      )}
      data-priority={priority}
      data-testid="card-priority-badge"
      title={t(`priority.${priority}`)}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden />
      {showLabel ? <span>{t(`priority.${priority}`)}</span> : null}
      <span className="sr-only">{t(`priority.${priority}`)}</span>
    </span>
  );
}
