import type { ReactNode } from "react";

import { useI18n } from "@/i18n";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description?: string;
  /** Extra content between the description and the actions (TASK-177.17). */
  children?: ReactNode;
  /** Label for the confirm button, e.g. "Delete column". */
  confirmLabel: string;
  /** Renders the confirm button in the destructive style. */
  destructive?: boolean;
  onConfirm: () => void;
  onOpenChange: (open: boolean) => void;
  /**
   * Runs after the dialog closes, with Radix's default body-focus prevented.
   * Callers use it to restore focus to a control that survives the action
   * (the trigger is often unmounted by the command itself).
   */
  onClosed?: () => void;
}

/**
 * A small generic confirmation dialog (used for destructive actions like
 * deleting a card or a column).
 */
export function ConfirmDialog({
  open,
  title,
  description,
  children,
  confirmLabel,
  destructive = false,
  onConfirm,
  onOpenChange,
  onClosed,
}: ConfirmDialogProps) {
  const { t } = useI18n();

  const handleConfirm = () => {
    onConfirm();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-sm"
        onCloseAutoFocus={(event) => {
          if (onClosed === undefined) return;
          event.preventDefault();
          onClosed();
        }}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? (
            <DialogDescription>{description}</DialogDescription>
          ) : null}
        </DialogHeader>
        {children}
        <DialogFooter className="mt-2">
          <Button
            variant="outline"
            className="max-md:min-h-11 no-hover:min-h-11"
            onClick={() => onOpenChange(false)}
          >
            {t("common.cancel")}
          </Button>
          <Button
            variant={destructive ? "destructive" : "default"}
            className="max-md:min-h-11 no-hover:min-h-11"
            onClick={handleConfirm}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
