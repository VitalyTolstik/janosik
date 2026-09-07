import { cn } from "@/lib/utils";
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
 */
export function CardItem({ card, labels, isDragging, onClick }: CardItemProps) {
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
      {card.description ? (
        <p className="mt-1.5 line-clamp-2 break-words text-xs leading-relaxed text-muted-foreground/90">
          {card.description}
        </p>
      ) : null}
    </article>
  );
}
