import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";

const DANGER_CONFIRM =
  "!bg-[var(--agent-danger-strong)] shadow-[inset_0_1px_0_rgb(255_255_255/0.12)] hover:!bg-[color-mix(in_oklab,var(--agent-danger-strong)_88%,#000)]";
const PRIMARY_CONFIRM =
  "!bg-[var(--agent-primary-strong)] shadow-[inset_0_1px_0_rgb(255_255_255/0.16)] hover:!bg-[color-mix(in_oklab,var(--agent-primary-strong)_88%,#fff)]";

/**
 * The mockup confirmation shell: 440 px, p0, 10 px radius, inline 30 px icon
 * tile, 14/650 title and 28 px footer row (44 px touch targets below the
 * 1280 px desktop breakpoint, where tablets are still touch surfaces).
 */
export function AgentConfirmDialog({
  open,
  onOpenChange,
  icon: Icon,
  tone,
  title,
  description,
  children,
  confirmLabel,
  onConfirm,
  busy = false,
  error = null,
  errorTestId,
  testId,
  confirmTestId,
  cancelTestId,
  confirmClassName,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  icon: LucideIcon;
  tone: "primary" | "danger";
  title: string;
  description: string;
  children?: ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  busy?: boolean;
  error?: string | null;
  errorTestId?: string;
  testId?: string;
  confirmTestId?: string;
  cancelTestId?: string;
  /** Mockup-width override for the primary button. */
  confirmClassName?: string;
}) {
  const { t } = useI18n();
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!busy) onOpenChange(next);
      }}
    >
      <DialogContent
        hideClose
        data-testid={testId}
        className="w-[min(440px,calc(100vw-1.5rem))] max-w-[440px] gap-0 overflow-hidden rounded-[10px] border-border bg-surface p-0 font-agent-surface !shadow-[var(--agent-shadow-lg)] sm:rounded-[10px]"
      >
        <div className="flex items-start gap-2.5 px-4 pt-3.5 pb-2.5">
          <span
            className={cn(
              "grid h-[30px] w-[30px] shrink-0 place-items-center rounded-[7px] border bg-surface",
              tone === "danger"
                ? "border-danger/40 text-[color:var(--agent-tone-danger)]"
                : "border-border text-muted-foreground",
            )}
            aria-hidden
          >
            <Icon className="h-[15px] w-[15px]" />
          </span>
          <div className="min-w-0">
            <DialogTitle className="text-[14px] font-[650] leading-[1.3] tracking-normal">
              {title}
            </DialogTitle>
            <DialogDescription className="mt-[3px] text-[11.5px] leading-[1.5] text-muted-foreground">
              {description}
            </DialogDescription>
          </div>
        </div>
        {children !== undefined ? (
          <div className="px-4 pb-0.5">{children}</div>
        ) : null}
        {error !== null ? (
          <p
            role="alert"
            data-testid={errorTestId}
            className="mx-4 mt-2 rounded-[5px] border border-danger/40 bg-danger/10 px-2 py-1.5 text-[11px] text-[color:var(--agent-tone-danger)]"
          >
            {error}
          </p>
        ) : null}
        <DialogFooter className="!flex-row justify-end gap-[7px] px-4 pt-3 pb-3.5">
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={busy}
            data-testid={cancelTestId}
            className="h-7 min-w-[61px] gap-[6px] rounded-[6px] px-[9px] text-[11px] font-[650] leading-none text-muted-foreground max-[1279px]:min-h-11"
          >
            {t("common.cancel")}
          </Button>
          <Button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            data-testid={confirmTestId}
            className={cn(
              "h-7 gap-[6px] rounded-[6px] px-[9px] text-[11px] font-[650] leading-none max-[1279px]:min-h-11",
              tone === "danger" ? DANGER_CONFIRM : PRIMARY_CONFIRM,
              confirmClassName,
            )}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
