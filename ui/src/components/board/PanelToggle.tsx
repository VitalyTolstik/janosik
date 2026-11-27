import { PanelRight } from "lucide-react";

import {
  BOARD_INSPECTOR_ID,
  useBoardInspector,
} from "@/hooks/use-board-inspector";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useI18n } from "@/i18n";

export function PanelToggle() {
  const { t } = useI18n();
  const panel = useBoardInspector();
  if (!panel) return null;
  const { open, dragging, cardOpen, triggerRef, toggle } = panel;
  const label = t(open ? "inspector.hide" : "inspector.show");

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          ref={triggerRef}
          variant="ghost"
          size="icon"
          className="inspector-control shrink-0 aria-expanded:bg-primary/10 aria-expanded:text-foreground"
          aria-label={label}
          aria-expanded={open}
          aria-controls={BOARD_INSPECTOR_ID}
          aria-keyshortcuts="]"
          disabled={dragging || cardOpen}
          onClick={(event) => {
            event.currentTarget.focus();
            toggle(event.detail === 0);
          }}
        >
          <PanelRight aria-hidden />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
