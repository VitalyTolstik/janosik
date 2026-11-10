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
 * Header entry to the agent-control dialog (TASK-166.14/166.15), shown in
 * server mode. A board ADMIN gets the control-plane entry with a
 * pending-approval badge; a MEMBER/VIEWER gets the same dialog on its
 * read-only Runs tab, so any board member can inspect the timeline and run a
 * dry-run conflict preview (applying a revert stays ADMIN-only). The badge is
 * refreshed by `approval` SSE frames, so a request appears without a reload.
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

  if (!isApiEnabled() || boardId === undefined) {
    return null;
  }

  const admin = role === "ADMIN";
  const label = admin
    ? t("agentControl.button")
    : t("agentControl.runs.button");

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={label}
          data-testid={admin ? "agent-control-trigger" : "agent-runs-trigger"}
          onClick={onOpen}
          className="relative"
        >
          <Bot className="h-5 w-5" aria-hidden />
          {admin && pending > 0 ? (
            <span
              data-testid="agent-control-pending-count"
              className="absolute -right-0.5 -top-0.5 min-w-4 rounded-full bg-danger px-1 text-[10px] font-semibold leading-4 text-white"
            >
              {pending > 99 ? "99+" : pending}
            </span>
          ) : null}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
