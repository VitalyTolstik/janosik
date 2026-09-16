import { cn } from "@/lib/utils";
import { LABEL_COLOR_DOT, type Label } from "@janosik/shared";

interface ComposerLabelPickerProps {
  /** Board labels to offer (hidden entirely when empty/omitted). */
  labels?: Label[];
  /** Currently picked label ids. */
  selected: string[];
  onToggle: (labelId: string) => void;
  testId?: string;
}

/**
 * The compact label chip row shared by every quick-add composer (board
 * footer, inline hover zones, table popover, calendar day/unscheduled).
 * Tap a chip to attach the label to the card being created (styled like
 * the dialog picker but mini). Clicks don't move focus out of the
 * composer's input, so composers that close on blur stay open while
 * picking.
 */
export function ComposerLabelPicker({
  labels,
  selected,
  onToggle,
  testId = "composer-labels",
}: ComposerLabelPickerProps) {
  if (!labels || labels.length === 0) return null;
  return (
    <div
      className="flex flex-wrap items-center gap-1"
      data-testid={testId}
      // Clicking a chip (or the gap between chips) must not move focus
      // out of the composer input — keep it inside the composer.
      onMouseDown={(event) => event.preventDefault()}
    >
      {labels.map((label) => {
        const isSelected = selected.includes(label.id);
        return (
          <button
            key={label.id}
            type="button"
            aria-pressed={isSelected}
            onClick={() => onToggle(label.id)}
            className={cn(
              "inline-flex h-5 items-center gap-1 rounded-full border px-1.5 text-[10px] font-medium transition-colors",
              isSelected
                ? "border-primary/50 bg-primary/10 text-foreground"
                : "border-border text-muted-foreground hover:border-foreground/30 hover:text-foreground",
            )}
          >
            <span
              aria-hidden
              className={cn(
                "h-1.5 w-1.5 shrink-0 rounded-full",
                LABEL_COLOR_DOT[label.color],
              )}
            />
            {label.name}
          </button>
        );
      })}
    </div>
  );
}
