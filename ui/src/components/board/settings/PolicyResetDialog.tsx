import { RotateCcw } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { useI18n } from "@/i18n";

interface PolicyResetDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  impact: string;
  confirmLabel: string;
  onConfirm: () => void;
}

/**
 * The reset-policy confirmation from the agent-surfaces prototype: a 440 px
 * dialog with the rotate icon, a warning impact strip and Cancel / Reset
 * policy buttons. It is deliberately separate from the generic
 * `ConfirmDialog` so the prototype typography and spacing stay exact.
 */
export function PolicyResetDialog({
  open,
  onOpenChange,
  title,
  description,
  impact,
  confirmLabel,
  onConfirm,
}: PolicyResetDialogProps) {
  const { t } = useI18n();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        hideClose
        data-testid="agent-policy-reset-dialog"
        className="w-[calc(100vw-24px)] max-w-[440px] gap-0 overflow-hidden rounded-[10px] border-border bg-popover p-0 shadow-xl"
      >
        <div className="flex items-start gap-2.5 px-4 pb-2.5 pt-3.5">
          <span
            aria-hidden
            className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-[7px] border border-[color-mix(in_oklab,var(--danger)_30%,var(--border))] bg-surface text-danger"
          >
            <RotateCcw className="h-[15px] w-[15px]" />
          </span>
          <div className="min-w-0">
            <DialogTitle className="m-0 text-[14px] font-[650] leading-[1.3] tracking-normal">
              {title}
            </DialogTitle>
            <DialogDescription className="mt-[3px] text-[11.5px] leading-[1.5] text-muted-foreground">
              {description}
            </DialogDescription>
          </div>
        </div>

        <div className="px-4 pb-0.5">
          <div
            data-testid="agent-policy-reset-impact"
            className="mt-2.5 rounded-r-[5px] border-l-2 border-warning bg-warning/[0.06] px-[9px] py-[7px] text-[11px] leading-[1.55] text-foreground"
          >
            {impact}
          </div>
        </div>

        <div className="flex items-center justify-end gap-[7px] px-4 pb-3.5 pt-3">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            data-testid="agent-policy-reset-cancel"
            className="inline-flex h-7 items-center justify-center rounded-[6px] border border-transparent px-[9px] text-[11px] font-[650] leading-none text-muted-foreground transition-colors hover:bg-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none max-md:h-11 max-md:px-3"
          >
            {t("common.cancel")}
          </button>
          <button
            type="button"
            onClick={() => {
              onConfirm();
              onOpenChange(false);
            }}
            data-testid="agent-policy-reset-confirm"
            className="inline-flex h-7 items-center justify-center rounded-[6px] bg-[#b91c1c] px-[9px] text-[11px] font-[650] leading-none text-white shadow-[inset_0_1px_rgba(255,255,255,0.12)] transition-colors hover:bg-[#991b1b] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-popover motion-reduce:transition-none max-md:h-11 max-md:px-3"
          >
            {confirmLabel}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
