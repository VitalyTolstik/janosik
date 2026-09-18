import { ChevronDown, ChevronUp } from "lucide-react";
import { useState } from "react";

import { useI18n } from "@/i18n";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { LIMITS } from "@janosik/shared";
import { clamp } from "@janosik/shared";

interface WipLimitDialogProps {
  open: boolean;
  columnTitle: string;
  /** The column's current limit, or `undefined` when unset. */
  initialLimit?: number;
  onOpenChange: (open: boolean) => void;
  onSave: (wipLimit?: number) => void;
}

/**
 * WIP-limit dialog for a column (TASK-13): a numeric input (1…
 * LIMITS.wipLimitMax). Saving an empty value removes the limit; the
 * explicit "Remove limit" button does the same in one click.
 */
export function WipLimitDialog({
  open,
  columnTitle,
  initialLimit,
  onOpenChange,
  onSave,
}: WipLimitDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        {/* Draft inside `DialogContent`: Radix unmounts it on close, so each
            open gets a fresh draft (AGENT.md: reset by remount). */}
        <WipLimitForm
          columnTitle={columnTitle}
          initialLimit={initialLimit}
          onOpenChange={onOpenChange}
          onSave={onSave}
        />
      </DialogContent>
    </Dialog>
  );
}

interface WipLimitFormProps {
  columnTitle: string;
  initialLimit?: number;
  onOpenChange: (open: boolean) => void;
  onSave: (wipLimit?: number) => void;
}

function WipLimitForm({
  columnTitle,
  initialLimit,
  onOpenChange,
  onSave,
}: WipLimitFormProps) {
  const { t } = useI18n();
  const [draft, setDraft] = useState(
    initialLimit === undefined ? "" : String(initialLimit),
  );

  const save = () => {
    const trimmed = draft.trim();
    if (!trimmed) {
      onSave(undefined);
    } else {
      const parsed = Number.parseInt(trimmed, 10);
      const value = Number.isFinite(parsed)
        ? clamp(parsed, 1, LIMITS.wipLimitMax)
        : undefined;
      onSave(value);
    }
    onOpenChange(false);
  };

  // Steps keep the draft inside 1…LIMITS.wipLimitMax; stepping from an empty
  // field starts the count at 1.
  const step = (delta: number) => {
    const current = draft.trim() ? Number.parseInt(draft, 10) : 0;
    setDraft(String(clamp(current + delta, 1, LIMITS.wipLimitMax)));
  };

  const stepButtonClass =
    "flex flex-1 items-center justify-center text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

  return (
    <>
      <DialogHeader>
        <DialogTitle>
          {t("column.wipLimitDialogTitle", { title: columnTitle })}
        </DialogTitle>
      </DialogHeader>
      {/* A text input plus themed steppers: the native number spinners are
          unstyleable and render dark-on-dark in the dark theme. */}
      <div className="relative">
        <Input
          autoFocus
          name="wip-limit"
          type="text"
          inputMode="numeric"
          value={draft}
          maxLength={String(LIMITS.wipLimitMax).length}
          onChange={(e) => setDraft(e.target.value.replace(/\D/g, ""))}
          onKeyDown={(e) => {
            if (e.key === "Enter") save();
            if (e.key === "Escape") onOpenChange(false);
            if (e.key === "ArrowUp") {
              e.preventDefault();
              step(1);
            }
            if (e.key === "ArrowDown") {
              e.preventDefault();
              step(-1);
            }
          }}
          onFocus={(e) => e.target.select()}
          aria-label={t("column.wipLimit")}
          placeholder={t("column.wipLimitPlaceholder")}
          className="pr-10"
        />
        <div className="absolute inset-y-1 right-1 flex w-7 flex-col overflow-hidden rounded-sm border border-input bg-muted/50">
          <button
            type="button"
            tabIndex={-1}
            aria-label={t("column.wipLimitIncrease")}
            onClick={() => step(1)}
            className={stepButtonClass}
          >
            <ChevronUp className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            tabIndex={-1}
            aria-label={t("column.wipLimitDecrease")}
            onClick={() => step(-1)}
            className={stepButtonClass}
          >
            <ChevronDown className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        {t("column.wipLimitHint")}
      </p>
      <DialogFooter className="mt-2">
        {initialLimit !== undefined && (
          <Button
            variant="outline"
            className="text-destructive focus:text-destructive"
            onClick={() => {
              onSave(undefined);
              onOpenChange(false);
            }}
          >
            {t("column.wipLimitRemove")}
          </Button>
        )}
        <Button variant="outline" onClick={() => onOpenChange(false)}>
          {t("common.cancel")}
        </Button>
        <Button onClick={save}>{t("common.save")}</Button>
      </DialogFooter>
    </>
  );
}
