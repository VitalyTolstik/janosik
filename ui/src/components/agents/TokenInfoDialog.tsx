import { useEffect, useRef } from "react";
import { KeyRound } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useI18n } from "@/i18n";

/**
 * The prototype's token-info dialog: 440 px, short owner-only explanation and
 * Cancel / Open Account. Board Live and approval links both use it, so a token
 * name never opens the full Account surface by accident.
 */
export function TokenInfoDialog({
  open,
  onOpenChange,
  tokenName,
  onOpenAccount,
  testIdPrefix = "token-info",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tokenName: string;
  onOpenAccount: () => void;
  /** Preserve the caller's existing test ids (approval-token-*). */
  testIdPrefix?: string;
}) {
  const { t } = useI18n();
  const returnFocusRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const active = document.activeElement;
    returnFocusRef.current = active instanceof HTMLElement ? active : null;
  }, [open]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="w-[min(440px,calc(100vw-1.5rem))] max-w-[440px] gap-0 overflow-hidden rounded-[10px] border-border bg-surface p-0 font-agent-surface !shadow-[var(--agent-shadow-lg)] sm:rounded-[10px]"
        data-testid={`${testIdPrefix}-dialog`}
        onCloseAutoFocus={(event) => {
          const target = returnFocusRef.current;
          if (target !== null && target.isConnected) {
            event.preventDefault();
            target.focus();
          }
        }}
        hideClose
      >
        <DialogHeader className="flex flex-row items-start gap-2.5 px-4 pt-3.5 pb-2.5 text-left">
          <span
            data-testid={`${testIdPrefix}-icon`}
            className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-[7px] border border-border bg-surface text-muted-foreground"
          >
            <KeyRound className="h-[15px] w-[15px]" aria-hidden />
          </span>
          <div className="min-w-0">
            <DialogTitle className="text-ui-heading font-[650] leading-[1.3] tracking-normal">
              {t("agents.approvals.tokenInfoTitle", { token: tokenName })}
            </DialogTitle>
            <DialogDescription className="mt-[3px] text-ui-body leading-[1.5] text-muted-foreground">
              {t("agents.approvals.tokenInfoDescription")}
            </DialogDescription>
          </div>
        </DialogHeader>
        <div className="px-4 pb-[3px]">
          <p
            data-testid={`${testIdPrefix}-impact`}
            className="mt-2.5 rounded-r-[5px] border-l-2 border-warning bg-[color-mix(in_oklab,var(--warning)_6%,transparent)] px-[9px] py-[7px] text-ui-body leading-[1.5] text-foreground"
          >
            {t("agents.approvals.tokenInfoBody")}
          </p>
        </div>
        <DialogFooter className="!flex-row items-center justify-end gap-[7px] px-4 pt-3 pb-3.5">
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
            data-testid={`${testIdPrefix}-cancel`}
            className="h-7 min-h-0 min-w-[61px] rounded-[6px] px-[9px] text-ui-label font-[650] leading-none text-muted-foreground max-md:min-h-11"
          >
            {t("common.cancel")}
          </Button>
          <Button
            type="button"
            data-testid={`${testIdPrefix}-open-account`}
            onClick={() => {
              onOpenChange(false);
              onOpenAccount();
            }}
            className="h-7 min-h-0 min-w-[176px] justify-center rounded-[6px] px-[9px] text-ui-label font-[650] leading-none max-md:min-h-11"
          >
            {t("agents.approvals.tokenInfoOpen")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
