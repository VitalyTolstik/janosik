import { AlignLeft, CalendarClock, ListTodo } from "lucide-react";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useI18n, formatDate, formatDateOnly, formatTime } from "@/i18n";
import { dueStatus, type DueStatus } from "@/utils/due-date";
import { LABEL_COLOR_CHIP, type Card, type Label } from "@/types/kanban";

interface CardItemProps {
  card: Card;
  /** Labels resolved from the board — the card can carry several. */
  labels: Label[];
  /** True while the card is being dragged (hides the source copy). */
  isDragging?: boolean;
  /** Fired on click — opens the card detail dialog. */
  onClick?: () => void;
}

/**
 * A single card inside a column.
 * Hover uses border/shadow changes (no transform) so it stays compatible
 * with the drag layer that @dnd-kit applies on top of it.
 *
 * The description itself is not rendered on the front (Trello-style):
 * a compact badge only signals that the card has one — full text lives
 * in the card dialog.
 */
export function CardItem({ card, labels, isDragging, onClick }: CardItemProps) {
  const { t, lang } = useI18n();
  const hasDescription = Boolean(card.description?.trim());
  // Checklist progress summed across all of the card's checklists.
  const items = (card.checklists ?? []).flatMap((c) => c.items);
  const done = items.filter((item) => item.done).length;
  const total = items.length;

  // Due-date badge state: overdue (red) / due within 24h (yellow) / later.
  const hasDueDate = typeof card.dueDate === "number";
  const status = hasDueDate ? dueStatus(card.dueDate as number) : null;
  const dueTime = hasDueDate
    ? formatTime(
        `${String(new Date(card.dueDate as number).getHours()).padStart(2, "0")}:${String(new Date(card.dueDate as number).getMinutes()).padStart(2, "0")}`,
        lang,
      )
    : "";

  return (
    <article
      onClick={onClick}
      className={cn(
        "group animate-card-in cursor-pointer rounded-lg border border-border/70 bg-card px-3 py-2.5 shadow-sm transition-[border-color,box-shadow] hover:border-primary/40 hover:shadow-md",
        isDragging && "opacity-40",
      )}
    >
      {labels.length > 0 ? (
        <div className="mb-1.5 flex flex-wrap items-center gap-1">
          {labels.map((label) => (
            <span
              key={label.id}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                LABEL_COLOR_CHIP[label.color],
              )}
            >
              <span
                className="h-1.5 w-1.5 rounded-full bg-current"
                aria-hidden
              />
              {label.name}
            </span>
          ))}
        </div>
      ) : null}
      <p className="break-words text-sm leading-snug text-foreground/90">
        {card.title}
      </p>
      {hasDescription || total > 0 || hasDueDate ? (
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          {hasDueDate ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <span
                  className={cn(
                    "inline-flex h-5 items-center gap-1 rounded-md border px-1.5 text-[11px] font-medium tabular-nums transition-colors",
                    status === "overdue" &&
                      "border-danger/40 bg-danger/10 text-danger",
                    status === "soon" &&
                      "border-warning/40 bg-warning/10 text-warning",
                    status === "later" &&
                      "border-border/60 bg-muted/50 text-muted-foreground group-hover:border-primary/40 group-hover:text-primary",
                  )}
                  data-testid="card-due-badge"
                  data-due-status={status}
                >
                  <CalendarClock className="h-3.5 w-3.5" aria-hidden />
                  {formatDateOnly(card.dueDate as number, lang)}
                  {" · "}
                  {dueTime}
                </span>
              </TooltipTrigger>
              <TooltipContent>
                {t(`dueDate.${status as DueStatus}`, {
                  date: formatDate(card.dueDate as number, lang),
                })}
              </TooltipContent>
            </Tooltip>
          ) : null}
          {total > 0 ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <span
                  className={cn(
                    "inline-flex h-5 items-center gap-1 rounded-md border px-1.5 text-[11px] font-medium tabular-nums transition-colors",
                    done === total
                      ? "border-success/40 bg-success/10 text-success"
                      : "border-border/60 bg-muted/50 text-muted-foreground group-hover:border-primary/40 group-hover:text-primary",
                  )}
                  data-testid="card-checklist-badge"
                >
                  <ListTodo className="h-3.5 w-3.5" aria-hidden />
                  {done}/{total}
                </span>
              </TooltipTrigger>
              <TooltipContent>
                {t("checklist.badgeTooltip", { done, total })}
              </TooltipContent>
            </Tooltip>
          ) : null}
          {hasDescription ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <span
                  className="inline-flex h-5 items-center rounded-md border border-border/60 bg-muted/50 px-1.5 text-muted-foreground transition-colors group-hover:border-primary/40 group-hover:text-primary"
                  data-testid="card-description-badge"
                >
                  <AlignLeft className="h-3.5 w-3.5" aria-hidden />
                </span>
              </TooltipTrigger>
              <TooltipContent>{t("card.hasDescription")}</TooltipContent>
            </Tooltip>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}
