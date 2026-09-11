import { Plus, X } from "lucide-react";
import { useState, type KeyboardEvent } from "react";

import { useI18n } from "@/i18n";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Input } from "@/components/ui/input";
import { LIMITS } from "@/types/kanban";
import { LimitCounter } from "@/components/ui/limit-counter";

interface AddColumnControlProps {
  /** Called with the trimmed title when the user commits. */
  onSubmit: (title: string) => void;
  /** Blocks the trigger (board already has LIMITS.columnsPerBoard). */
  disabled?: boolean;
  /** Tooltip text shown while blocked. */
  disabledReason?: string;
}

/**
 * Dashed "+ Add column" control shown at the end of the column strip.
 * Clicking swaps the button for a compact input; Enter commits, Escape
 * cancels, blur cancels.
 */
export function AddColumnControl({
  onSubmit,
  disabled,
  disabledReason,
}: AddColumnControlProps) {
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
    reset();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      commit();
    } else if (event.key === "Escape") {
      reset();
    }
  };

  if (!composing) {
    const button = (
      <button
        type="button"
        disabled={disabled}
        onClick={() => setComposing(true)}
        data-add-column-trigger
        className="flex w-[80vw] max-w-72 shrink-0 self-start items-center gap-2 rounded-xl border border-dashed border-border px-4 py-3 text-sm text-muted-foreground transition-colors enabled:hover:border-primary/40 enabled:hover:bg-hover/60 enabled:hover:text-foreground disabled:pointer-events-none disabled:opacity-50 sm:w-72 sm:max-w-none"
      >
        <Plus className="h-4 w-4" />
        <span>{t("column.add")}</span>
      </button>
    );
    return disabled ? (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="flex w-[80vw] shrink-0 self-start sm:w-72 sm:max-w-none">
            {button}
          </span>
        </TooltipTrigger>
        <TooltipContent>{disabledReason}</TooltipContent>
      </Tooltip>
    ) : (
      button
    );
  }

  return (
    <div className="flex w-[80vw] max-w-72 shrink-0 self-start flex-col gap-2 rounded-xl border border-border bg-card/60 p-3 sm:w-72 sm:max-w-none">
      <Input
        autoFocus
        value={title}
        maxLength={LIMITS.columnTitle}
        onChange={(event) => setTitle(event.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={reset}
        placeholder={t("column.placeholder")}
        className="h-9"
      />
      <LimitCounter length={title.length} limit={LIMITS.columnTitle} testId="add-column-limit" />
      <div className="flex items-center gap-1.5">
        <Button
          size="sm"
          onClick={commit}
          disabled={!title.trim()}
          // Keep focus in the input so its onBlur (reset) never fires
          // before the click lands.
          onMouseDown={(event) => event.preventDefault()}
        >
          {t("column.add")}
        </Button>
        <Button
          size="icon"
          variant="ghost"
          onClick={() => setComposing(false)}
          aria-label={t("common.cancel")}
          className="h-8 w-8 text-muted-foreground hover:text-foreground"
          onMouseDown={(event) => event.preventDefault()}
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
