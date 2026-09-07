import { Plus } from "lucide-react";
import { useState, type KeyboardEvent } from "react";

import { useI18n } from "@/i18n";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { LABEL_COLOR_DOT, type Label } from "@/types/kanban";

interface CardComposerProps {
  /** Called with the trimmed title and the labels picked before adding. */
  onSubmit: (title: string, labelIds?: string[]) => void;
  /** Board labels to offer inline — picked before the card is created. */
  labels?: Label[];
  placeholder?: string;
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
}: CardComposerProps) {
  const { t } = useI18n();
  const [composing, setComposing] = useState(false);
  const [title, setTitle] = useState("");
  const [selectedLabels, setSelectedLabels] = useState<string[]>([]);

  const reset = () => {
    setTitle("");
    setSelectedLabels([]);
    setComposing(false);
  };

  const commit = () => {
    const trimmed = title.trim();
    if (trimmed) onSubmit(trimmed, selectedLabels);
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

  if (!composing) {
    return (
      <button
        type="button"
        onClick={() => setComposing(true)}
        className="group flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-hover hover:text-foreground"
      >
        <Plus className="h-4 w-4 transition-transform group-hover:scale-110" />
        <span>{t("composer.add")}</span>
      </button>
    );
  }

  return (
    <div className="space-y-1.5">
      <Textarea
        autoFocus
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={reset}
        placeholder={placeholder ?? t("composer.placeholder")}
        rows={2}
        className="min-h-0 resize-none"
      />
      {labels && labels.length > 0 ? (
        <div
          className="flex flex-wrap items-center gap-1"
          data-testid="composer-labels"
        >
          {labels.map((label) => {
            const isSelected = selectedLabels.includes(label.id);
            return (
              <button
                key={label.id}
                type="button"
                aria-pressed={isSelected}
                onClick={() => toggleLabel(label.id)}
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
      ) : null}
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          onClick={commit}
          disabled={!title.trim()}
          // Keep focus in the textarea so its onBlur (reset) never fires
          // before the click lands.
          onMouseDown={(event) => event.preventDefault()}
        >
          {t("composer.submit")}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setComposing(false)}
          className="text-muted-foreground hover:text-foreground"
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