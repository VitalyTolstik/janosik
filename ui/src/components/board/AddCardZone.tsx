import { Plus } from "lucide-react";
import { memo } from "react";

import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n";

/**
 * Trello-style hover zone in a card gap: an 8px strip that expands to a
 * "+ Add card" ghost on hover. Collapsed, the button ignores pointer
 * events (a click in the gap must not open a composer by accident) — only
 * the revealed button is clickable. The reveal is deliberately delayed and
 * eased (no border, just a soft hover surface) so brushing past cards
 * never flashes the ghost.
 *
 * The zone is ALSO the column's spacing unit: it renders (as an inert
 * spacer via `interactive=false`) even while dragging/filtering. Swapping
 * zones for `space-y` margins there shifted every card 8px up on drag
 * start — space-y never adds a margin before the first card.
 */
function AddCardZoneBody({
  index,
  onInsert,
  interactive = true,
  touchVisible = false,
}: {
  index: number;
  /** Receives the gap index, so one stable handler serves every zone. */
  onInsert?: (index: number) => void;
  /** False = plain 8px spacer (drag/filter/WIP override): same geometry,
   *  no hover reveal, no button. */
  interactive?: boolean;
  /** Touch has no hover: the zone would stay inert there. The column's
   *  end zone (and the empty-column one) is the only card-creation path
   *  on touch, so it renders as a persistent ghost instead. */
  touchVisible?: boolean;
}) {
  const { t } = useI18n();
  if (!interactive) {
    return <li className="h-2 shrink-0" aria-hidden />;
  }
  return (
    <li
      data-testid={`card-insert-zone-${index}`}
      className={cn(
        "group/zone flex h-2 shrink-0 items-center transition-[height] duration-200 hover:delay-150 hover:h-8",
        touchVisible && "no-hover:h-8",
      )}
    >
      <button
        type="button"
        data-testid={`card-insert-${index}`}
        aria-label={t("composer.add")}
        // Hover-only ghost (TASK-152, C16): keeping it in the tab order made
        // every gap (~2400 on a full board) a keyboard stop. Pointer users
        // still reach it; keyboard users create cards via the column menu.
        tabIndex={-1}
        onClick={onInsert ? () => onInsert(index) : undefined}
        className={cn(
          "pointer-events-none flex h-8 w-full items-center gap-1.5 rounded-lg px-2 text-xs text-muted-foreground opacity-0 transition-opacity duration-200 group-hover/zone:pointer-events-auto group-hover/zone:delay-150 group-hover/zone:opacity-100 hover:bg-hover/60 hover:text-foreground",
          touchVisible && "no-hover:pointer-events-auto no-hover:opacity-100",
        )}
      >
        <Plus className="h-3 w-3" />
        <span className="truncate">{t("composer.add")}</span>
      </button>
    </li>
  );
}

/**
 * Memoized: with `memo` on the column, a keystroke in another column stops
 * here — and a column carries one zone per card gap, so these were the
 * single biggest source of renders on the board (TASK-21.4.1).
 */
export const AddCardZone = memo(AddCardZoneBody);
