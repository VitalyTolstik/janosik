import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

import { CardItem } from "@/components/board/CardItem";
import type { Card, Label } from "@/types/kanban";

interface SortableCardProps {
  card: Card;
  /** Labels resolved from the board (multi-label support). */
  labels: Label[];
  /** Filter/search query highlighted on the card front. */
  highlight?: string;
  /** True when this card holds the j/k keyboard cursor (focus ring). */
  isCursor?: boolean;
  /** Fired when the rendered card is clicked — opens the card dialog. */
  onCardClick?: () => void;
  /** Fired by the hover duplicate button on the card. */
  onCardDuplicate?: () => void;
}

/**
 * Makes a CardItem draggable/sortable via @dnd-kit. The sortable transform
 * (the lift + gap animation while dragging) is applied to the wrapper div,
 * not to the CardItem itself, so the card keeps its own styling intact.
 */
export function SortableCard({ card, labels, highlight, isCursor, onCardClick, onCardDuplicate }: SortableCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: card.id, data: { type: "card" } });

  return (
    <div
      ref={setNodeRef}
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
    >
      <CardItem
        card={card}
        labels={labels}
        isDragging={isDragging}
        highlight={highlight}
        isCursor={isCursor}
        onClick={onCardClick}
        onDuplicate={onCardDuplicate}
      />
    </div>
  );
}
