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

  return (
    <>
      <DialogHeader>
        <DialogTitle>
          {t("column.wipLimitDialogTitle", { title: columnTitle })}
        </DialogTitle>
      </DialogHeader>
      <Input
        autoFocus
        name="wip-limit"
        type="number"
        inputMode="numeric"
        min={1}
        max={LIMITS.wipLimitMax}
        value={draft}
        maxLength={String(LIMITS.wipLimitMax).length}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") save();
          if (e.key === "Escape") onOpenChange(false);
        }}
        onFocus={(e) => e.target.select()}
        aria-label={t("column.wipLimit")}
        placeholder={t("column.wipLimitPlaceholder")}
      />
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
