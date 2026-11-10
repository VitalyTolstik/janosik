import { useEffect, useState } from "react";
import { Bot } from "lucide-react";

import { api, isApiEnabled } from "@/api/client";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useI18n } from "@/i18n";
import { useBoardLive } from "@/store/board-live";
import { useBoardAccess, useBoardState } from "@/store/BoardContext";

/**
 * Header entry to the agent-control dialog (TASK-166.14), shown to a board
 * ADMIN in server mode only. The pending-approval badge is loaded from the
 * board queue and refreshed by `approval` SSE frames, so a request created by
 * an agent appears without a page reload.
 */
export function AgentControlButton({ onOpen }: { onOpen: () => void }) {
  const { t } = useI18n();
  const { board } = useBoardState();
  const { role } = useBoardAccess();
  const live = useBoardLive();
  const [pending, setPending] = useState(0);
  const [revision, setRevision] = useState(0);
  const boardId = board?.id;

  useEffect(
    () => live.agentControl.subscribeApproval(() => setRevision((v) => v + 1)),
    [live],
  );

  useEffect(() => {
    if (boardId === undefined || role !== "ADMIN" || !isApiEnabled()) return;
    let alive = true;
    void api
      .listApprovals(boardId, { status: "pending", limit: 50 })
      .then((rows) => {
        if (alive) setPending(rows.length);
      })
      .catch(() => {
        /* the badge is an affordance, not a data surface: hide it on failure */
      });
    return () => {
      alive = false;
    };
  }, [boardId, role, revision]);

  if (!isApiEnabled() || boardId === undefined || role !== "ADMIN") {
    return null;
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={t("agentControl.button")}
          data-testid="agent-control-trigger"
          onClick={onOpen}
          className="relative"
        >
          <Bot className="h-5 w-5" aria-hidden />
          {pending > 0 ? (
            <span
              data-testid="agent-control-pending-count"
              className="absolute -right-0.5 -top-0.5 min-w-4 rounded-full bg-danger px-1 text-[10px] font-semibold leading-4 text-white"
            >
              {pending > 99 ? "99+" : pending}
            </span>
          ) : null}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{t("agentControl.button")}</TooltipContent>
    </Tooltip>
  );
}
