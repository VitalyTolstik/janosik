import { AlignLeft, CalendarClock, CopyPlus, ListTodo } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { HighlightedText } from "@/components/ui/highlight";
import { cn } from "@/lib/utils";
import { useI18n, formatDate, formatDateOnly, formatTime } from "@/i18n";
import { dueStatus, type DueStatus } from "@/utils/due-date";
import { descriptionSnippet } from "@/utils/filter";
import { LABEL_COLOR_CHIP, coverBackground, type Card, type Label } from "@/types/kanban";

interface CardItemProps {
  card: Card;
  /** Labels resolved from the board — the card can carry several. */
  labels: Label[];
  /** True while the card is being dragged (hides the source copy). */
  isDragging?: boolean;
  /**
   * Active search/filter query — title matches are highlighted in place;
   * when only the description matched, the description badge lights up
   * with a snippet tooltip.
   */
  highlight?: string;
  /** Fired on click — opens the card detail dialog. */
  onClick?: () => void;
  /** Fired by the hover duplicate button — the dialog stays closed. */
  onDuplicate?: () => void;
}

/**
 * True while the title is visually clipped by `line-clamp-3` (scrollHeight
 * exceeds the clamped clientHeight). Mirrors Jira's behaviour: the native
 * `title` tooltip appears only when something is actually hidden — no
 * tooltip noise on short titles.
 */
function useClamped(): [
  React.RefCallback<HTMLParagraphElement>,
  boolean,
] {
  const elRef = useRef<HTMLParagraphElement | null>(null);
  const [clamped, setClamped] = useState(false);
  useEffect(() => {
    const el = elRef.current;
    if (!el) return;
    const check = () =>
      setClamped(el.scrollHeight > el.clientHeight + 1);
    check();
    // Re-check when the card content reflows (fonts, resize, label wrap).
    const observer = new ResizeObserver(check);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const ref: React.RefCallback<HTMLParagraphElement> = (node) => {
    elRef.current = node;
  };
  return [ref, clamped];
}

/**
 * A single card inside a column.
 * Hover uses border/shadow changes (no transform) so it stays compatible
 * with the drag layer that @dnd-kit applies on top of it.
 *
 * The title is clamped to 3 lines (Jira's budget — Linear clips at 1,
 * Trello/Notion don't clamp at all and grow runaway-tall cards). The clip
 * is purely visual: the full text stays in the accessibility tree and a
 * native `title` tooltip surfaces it on hover, only when truncated.
 *
 * The description itself is not rendered on the front (Trello-style):
 * a compact badge only signals that the card has one — full text lives
 * in the card dialog.
 */
export function CardItem({ card, labels, isDragging, highlight, onClick, onDuplicate }: CardItemProps) {
  const [titleRef, titleClamped] = useClamped();
  const { t, lang } = useI18n();
  const hasDescription = Boolean(card.description?.trim());
  // Checklist progress summed across all of the card's checklists.
  const items = (card.checklists ?? []).flatMap((c) => c.items);
  const done = items.filter((item) => item.done).length;
  const total = items.length;

  // Where the highlight query matched: the title renders <mark>s inline;
  // a description-only match lights up the description badge instead
  // (the text itself is not on the front — Trello-style).
  const query = highlight?.trim().toLowerCase() ?? "";
  const titleMatched = query !== "" && card.title.toLowerCase().includes(query);
  const labelMatched =
    query !== "" &&
    card.labelIds.some((id) =>
      labels.some(
        (label) => label.id === id && label.name.toLowerCase().includes(query),
      ),
    );
  const descriptionOnly = query !== "" && !titleMatched && !labelMatched && hasDescription;
  const snippet = descriptionOnly
    ? descriptionSnippet(card.description ?? "", query)
    : null;
  const snippetText = snippet
    ?.map((segment) => (typeof segment === "string" ? segment : segment.text))
    .join("");

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
        "group animate-card-in relative cursor-pointer overflow-hidden rounded-lg border border-border/70 bg-card px-3 py-2.5 shadow-sm transition-[border-color,box-shadow] hover:border-primary/40 hover:shadow-md",
        isDragging && "opacity-40",
      )}
    >
      {/* Hover duplicate (Trello quick-edit style): a compact icon in the
          top-right corner, visible only while hovered. Hidden while dragging
          and when there is nowhere to put the copy handler. */}
      {onDuplicate && !isDragging ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label={t("card.duplicate")}
              className="absolute right-1.5 top-1.5 z-10 flex h-6 w-6 items-center justify-center rounded-md border border-border/60 bg-card/90 text-muted-foreground opacity-0 shadow-sm backdrop-blur-sm transition-opacity focus-visible:opacity-100 hover:text-foreground group-hover:opacity-100"
              onClick={(e) => {
                // Don't let the click open the card dialog.
                e.stopPropagation();
                onDuplicate();
              }}
            >
              <CopyPlus className="h-3.5 w-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent>{t("card.duplicate")}</TooltipContent>
        </Tooltip>
      ) : null}
      {/* Cover: a slim top strip — same height for colors and gradients
          (matches the label chip row scale). Negative margins bleed it into
          the card padding; the card clips it (overflow-hidden). */}
      {card.cover ? (
        <div
          aria-hidden
          data-testid="card-cover"
          data-cover-type={card.cover.type}
          className="-mx-3 -mt-2.5 mb-2.5 h-1.5 w-[calc(100%+1.5rem)]"
          style={{ background: coverBackground(card.cover) }}
        />
      ) : null}
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
      {/* `overflow-wrap:anywhere` (not just break-words) so a pasted URL
          can't blow out the card's intrinsic width; `text-wrap:pretty`
          avoids orphan single-word last lines under the clamp. */}
      <p
        ref={titleRef}
        title={titleClamped ? card.title : undefined}
        className="line-clamp-3 break-words text-sm leading-snug text-foreground/90 [overflow-wrap:anywhere] [text-wrap:pretty]"
        data-testid="card-title"
      >
        <HighlightedText text={card.title} query={highlight ?? ""} />
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
                  className={cn(
                    "inline-flex h-5 items-center rounded-md border px-1.5 text-muted-foreground transition-colors group-hover:border-primary/40 group-hover:text-primary",
                    descriptionOnly &&
                      "border-primary/40 bg-primary/10 text-primary",
                  )}
                  data-testid="card-description-badge"
                  {...(descriptionOnly ? { "data-highlight": "description" } : {})}
                >
                  <AlignLeft className="h-3.5 w-3.5" aria-hidden />
                </span>
              </TooltipTrigger>
              <TooltipContent>
                {descriptionOnly && snippetText ? snippetText : t("card.hasDescription")}
              </TooltipContent>
            </Tooltip>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}
