import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { memo } from "react";

import { CardItem } from "@/components/board/CardItem";
import type { CardLinkFacts } from "@/utils/links";
import type { Card, Label } from "@janosik/shared";

interface SortableCardProps {
  card: Card;
  /** The board id — resolves the assignee badge's member (TASK-49). */
  boardId?: string;
  /** Labels resolved from the board (multi-label support). */
  labels: Label[];
  /** Filter/search query highlighted on the card front. */
  highlight?: string;
  /** True when this card holds the j/k keyboard cursor (focus ring). */
  isCursor?: boolean;
  /** Link facts for the card-front badges (TASK-46) — see CardItem. */
  linkFacts?: CardLinkFacts;
  /** Fired when the rendered card is clicked — opens the card dialog. */
  onCardClick?: (cardId: string) => void;
  /** Fired by the hover duplicate button on the card. */
  onCardDuplicate?: (cardId: string) => void;
  /** Fired by the hover archive button on the card (TASK-18.1). */
  onCardArchive?: (cardId: string) => void;
  /** Blocks the hover duplicate (the card's column is full). */
  duplicateDisabled?: boolean;
  /** Tooltip text shown while `duplicateDisabled`. */
  duplicateDisabledReason?: string;
  /** VIEWER mode: the card's context menu keeps read-only actions only. */
  readOnly?: boolean;
}

/**
 * Makes a CardItem draggable/sortable via @dnd-kit. The sortable transform
 * (the lift + gap animation while dragging) is applied to the wrapper div,
 * not to the CardItem itself, so the card keeps its own styling intact.
 */
function SortableCardView({
  card,
  boardId,
  labels,
  highlight,
  isCursor,
  linkFacts,
  onCardClick,
  onCardDuplicate,
  onCardArchive,
  duplicateDisabled = false,
  duplicateDisabledReason,
  readOnly = false,
}: SortableCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
    // TASK-116: a VIEWER cannot drag — disabling the sensor drops the
    // `role="button"`/`tabIndex` dnd-kit adds, so cards are not announced as
    // buttons and the keyboard can reach the card's own controls.
  } = useSortable({ id: card.id, data: { type: "card" }, disabled: readOnly });

  return (
    <div
      ref={setNodeRef}
      // `touch-manipulation` keeps native scroll alive on the card while
      // removing double-tap zoom, so the TouchSensor's long-press can win
      // the gesture without blocking the column's swipe scroll (TASK-21.10).
      className="touch-manipulation"
      style={{
        transform: CSS.Transform.toString(transform),
        // No transition while active — the dragged card must follow the
        // pointer instantly, otherwise it smears/lags as the list reorders
        // under it. The transition only applies for the settle animation
        // after the drop.
        transition: isDragging ? undefined : transition,
      }}
      {...attributes}
      {...listeners}
      // dnd-kit marks the wrapper `role="button"`; the card face already is
      // a button and carries its own controls, so nested buttons were
      // announced (TASK-152, C17). Keep focusability/keys and the
      // `aria-roledescription="sortable"` token, expose a group instead.
      role="group"
      // dnd-kit's draggable attributes also carry `aria-pressed`, which is
      // invalid on a group (TASK-156); a title gives the group its name.
      aria-pressed={undefined}
      aria-label={card.title}
      onKeyDown={(event) => {
        // dnd-kit's keyboard activator (Space) first; Enter on the focused
        // card itself opens it — never a drag (a11y). Keys typed into the
        // card's own controls are theirs.
        listeners?.onKeyDown?.(event);
        if (
          event.defaultPrevented ||
          event.key !== "Enter" ||
          event.target !== event.currentTarget ||
          isDragging
        ) {
          return;
        }
        event.preventDefault();
        onCardClick?.(card.id);
      }}
    >
      <CardItem
        card={card}
        boardId={boardId}
        labels={labels}
        isDragging={isDragging}
        highlight={highlight}
        isCursor={isCursor}
        linkFacts={linkFacts}
        onClick={onCardClick}
        onDuplicate={onCardDuplicate}
        onArchive={onCardArchive}
        duplicateDisabled={duplicateDisabled}
        duplicateDisabledReason={duplicateDisabledReason}
        readOnly={readOnly}
      />
    </div>
  );
}

/**
 * Memoized together with CardItem (TASK-21.4): the column list re-renders
 * on every board change, and dnd-kit's own subscription already re-renders
 * this wrapper whenever the drag state that concerns it changes.
 */
export const SortableCard = memo(SortableCardView);
