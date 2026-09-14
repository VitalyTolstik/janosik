import { Plus } from "lucide-react";
import { useRef, useState, type FocusEvent, type KeyboardEvent } from "react";

import { useI18n } from "@/i18n";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ComposerLabelPicker } from "@/components/board/ComposerLabelPicker";
import { LIMITS, type Label } from "@/types/kanban";
import { LimitCounter } from "@/components/ui/limit-counter";

interface CardComposerProps {
  /** Called with the trimmed title and the labels picked before adding. */
  onSubmit: (title: string, labelIds?: string[], atIndex?: number) => void;
  /** Board labels to offer inline — picked before the card is created. */
  labels?: Label[];
  placeholder?: string;
  /**
   * Column id exposed as `data-composer-trigger` on the idle button —
   * the `n` shortcut opens the composer by "clicking" this trigger.
   */
  columnId?: string;
  /** Blocks the idle "+ Add card" button (e.g. column at its card limit). */
  disabled?: boolean;
  /** Tooltip text shown while blocked. */
  disabledReason?: string;
  /** Insert position passed to onSubmit (inline hover-zone composer). */
  atIndex?: number;
  /** Start in the open (textarea) state — inline zones open in place. */
  defaultComposing?: boolean;
  /** Called whenever the composer returns to the idle state. */
  onClose?: () => void;
}

/**
 * Inline composer for creating a card inside a column.
 * Idle state shows a subtle "+ Add a card" row; clicking swaps it for a
 * textarea. Enter commits, Shift+Enter inserts a newline, Escape cancels.
 * Below the input, board labels appear as compact toggle chips — tap one
 * to attach it to the card being created (styled like the dialog picker
 * but mini, since this is the quick-add row).
 * After commit the composer stays open for rapid entry of several cards.
 */
export function CardComposer({
  onSubmit,
  labels,
  placeholder,
  columnId,
  disabled,
  disabledReason,
  atIndex,
  defaultComposing = false,
  onClose,
}: CardComposerProps) {
  const { t } = useI18n();
  const [composing, setComposing] = useState(defaultComposing);
  const [title, setTitle] = useState("");
  const [selectedLabels, setSelectedLabels] = useState<string[]>([]);
  // The composer's own region — blur inside it (label chips, buttons) is
  // not a cancel, only focus leaving the whole composer is.
  const rootRef = useRef<HTMLDivElement>(null);

  const reset = () => {
    setTitle("");
    setSelectedLabels([]);
    setComposing(false);
    onClose?.();
  };

  const commit = () => {
    const trimmed = title.trim();
    if (trimmed) {
      // Keep the 2-arg call for plain appends (assert-friendly for tests).
      if (atIndex === undefined) onSubmit(trimmed, selectedLabels);
      else onSubmit(trimmed, selectedLabels, atIndex);
    }
    setTitle("");
    setSelectedLabels([]);
  };

  const toggleLabel = (labelId: string) => {
    setSelectedLabels((prev) =>
      prev.includes(labelId)
        ? prev.filter((id) => id !== labelId)
        : [...prev, labelId],
    );
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      commit();
    } else if (event.key === "Escape") {
      reset();
    }
  };

  const handleBlur = (event: FocusEvent<HTMLTextAreaElement>) => {
    // Blur fires when focus moves to a label chip or an action button
    // inside the composer — that must NOT close it. Only reset when focus
    // leaves the composer entirely (relatedTarget outside or null).
    const next = event.relatedTarget;
    if (next && rootRef.current?.contains(next as Node)) return;
    reset();
  };

  const addCardDisabled = Boolean(disabled && disabledReason);

  if (!composing) {
    const button = (
      <button
        type="button"
        disabled={addCardDisabled}
        onClick={() => setComposing(true)}
        {...(columnId ? { "data-composer-trigger": columnId } : {})}
        className="group flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-hover hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
      >
        <Plus className="h-4 w-4 transition-transform group-hover:scale-110" />
        <span>{t("composer.add")}</span>
      </button>
    );
    return addCardDisabled ? (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="block w-full">{button}</span>
        </TooltipTrigger>
        <TooltipContent>{disabledReason}</TooltipContent>
      </Tooltip>
    ) : (
      button
    );
  }

  return (
    <div ref={rootRef} className="space-y-1.5">
      <Textarea
        autoFocus
        name="card-composer"
        value={title}
        maxLength={LIMITS.cardTitle}
        onChange={(event) => setTitle(event.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
        placeholder={placeholder ?? t("composer.placeholder")}
        rows={2}
        // Opaque surface: the composer scrolls flush with the card list and
        // a transparent input would let the last card's edge bleed through
        // the top border.
        className="min-h-0 resize-none bg-card"
      />
      <LimitCounter
        length={title.length}
        limit={LIMITS.cardTitle}
        testId="composer-limit"
      />
      <ComposerLabelPicker
        labels={labels}
        selected={selectedLabels}
        onToggle={toggleLabel}
      />
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          onClick={commit}
          disabled={!title.trim()}
          // Keep focus in the textarea so its onBlur (reset) never fires
          // before the click lands.
          onMouseDown={(event) => event.preventDefault()}
          className="h-7 flex-1 text-xs"
        >
          {t("composer.submit")}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            setComposing(false);
            onClose?.();
          }}
          className="h-7 text-xs text-muted-foreground hover:text-foreground"
          onMouseDown={(event) => event.preventDefault()}
        >
          {t("common.cancel")}
        </Button>
      </div>
      <p className="text-[11px] text-muted-foreground/80">
        {t("composer.hint")}
      </p>
    </div>
  );
}
