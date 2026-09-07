import { Plus } from "lucide-react";
import { useState, type KeyboardEvent } from "react";

import { useI18n } from "@/i18n";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

interface CardComposerProps {
  /** Called with the trimmed title when the user commits. */
  onSubmit: (title: string) => void;
  placeholder?: string;
}

/**
 * Inline composer for creating a card inside a column.
 * Idle state shows a subtle "+ Add a card" row; clicking swaps it for a
 * textarea. Enter commits, Shift+Enter inserts a newline, Escape cancels.
 * After commit the composer stays open for rapid entry of several cards.
 */
export function CardComposer({ onSubmit, placeholder }: CardComposerProps) {
  const { t } = useI18n();
  const [composing, setComposing] = useState(false);
  const [title, setTitle] = useState("");

  const reset = () => {
    setTitle("");
    setComposing(false);
  };

  const commit = () => {
    const trimmed = title.trim();
    if (trimmed) onSubmit(trimmed);
    setTitle("");
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
