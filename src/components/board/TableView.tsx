import { HighlightedText } from "@/components/ui/highlight";
import { DueBadge } from "@/components/board/DueBadge";
import { useI18n } from "@/i18n";
import { useBoard } from "@/store/BoardContext";
import { LABEL_COLOR_CHIP, type Label } from "@/types/kanban";

interface TableViewProps {
  /** Per-column card ids with a filter applied — overrides the stored
   *  order while the filter is active. */
  filteredCardIds?: Record<string, string[]>;
  /** True while a board filter is active (chooses the empty-state text). */
  isFiltering?: boolean;
  /** Search query highlighted inside titles. */
  highlight?: string;
  /** Fired on a row click — opens the card detail dialog. */
  onCardClick: (cardId: string) => void;
}

/**
 * Table view — the same cards as flat rows (title, column, labels, due
 * date), grouped by column in board order. A read-only projection
 * (TASK-14): a row click opens the card dialog, all editing happens there.
 * The active filter applies exactly as on the board.
 */
export function TableView({
  filteredCardIds,
  isFiltering = false,
  highlight,
  onCardClick,
}: TableViewProps) {
  const { board } = useBoard();
  const { t } = useI18n();

  if (!board) return null;

  const rows = board.columns.flatMap((column) => {
    const ids = filteredCardIds?.[column.id] ?? column.cardIds;
    return ids
      .map((id) => board.cards[id])
      .filter((card) => card !== undefined)
      .map((card) => ({ card, column }));
  });

  const labelsOf = (labelIds: string[]): Label[] =>
    labelIds
      .map((labelId) => board.labels.find((l) => l.id === labelId))
      .filter((l): l is Label => Boolean(l));

  return (
    <div className="flex-1 overflow-y-auto rounded-xl border border-border/60 bg-card/60 backdrop-blur-sm">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-border/60">
            <th scope="col" className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              {t("view.table.title")}
            </th>
            <th scope="col" className="w-40 px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              {t("view.table.column")}
            </th>
            <th scope="col" className="w-48 px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              {t("dueDate.label")}
            </th>
            <th scope="col" className="w-44 px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              {t("view.table.labels")}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={4} className="px-3 py-8 text-center text-muted-foreground">
                {isFiltering ? t("filter.noMatch") : t("view.table.empty")}
              </td>
            </tr>
          ) : (
            rows.map(({ card, column }) => (
              <tr
                key={card.id}
                onClick={() => onCardClick(card.id)}
                className="cursor-pointer border-b border-border/40 transition-colors last:border-b-0 hover:bg-muted/40"
              >
                <td className="max-w-0 px-3 py-2">
                  <span className="block truncate font-medium text-foreground/90">
                    <HighlightedText text={card.title} query={highlight ?? ""} />
                  </span>
                </td>
                <td className="px-3 py-2">
                  <span className="inline-flex max-w-full items-center truncate rounded-md bg-muted/50 px-1.5 py-0.5 text-xs text-muted-foreground">
                    {column.title}
                  </span>
                </td>
                <td className="px-3 py-2">
                  {typeof card.dueDate === "number" ? (
                    <DueBadge dueDate={card.dueDate} />
                  ) : (
                    <span className="text-xs text-muted-foreground/60">—</span>
                  )}
                </td>
                <td className="px-3 py-2">
                  <div className="flex flex-wrap gap-1">
                    {labelsOf(card.labelIds).map((label) => (
                      <span
                        key={label.id}
                        className={
                          "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide " +
                          LABEL_COLOR_CHIP[label.color]
                        }
                      >
                        <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />
                        {label.name}
                      </span>
                    ))}
                  </div>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
