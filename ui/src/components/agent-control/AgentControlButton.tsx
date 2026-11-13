import { useEffect } from "react";

import { isApiEnabled } from "@/api/client";
import { usePendingApprovals } from "@/components/agents/use-pending-approvals";
import { Button } from "@/components/ui/button";
import { LazyAnimatedIcon } from "@/components/ui/lazy-animated-icon";
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
 * read-only Live tab, with Runs available for inspection and dry-run preview
 * (applying a revert stays ADMIN-only).
 *
 * TASK-179.8: the badge comes from the session-only `/agents/overview`
 * aggregation (one exact scope count, no per-board fan-out and no lazy expiry
 * write). MEMBER/VIEWER never request approvals; a failure renders as unknown
 * rather than a false zero, and an `approval` SSE frame refreshes the count.
 */
export function AgentControlButton({
  onOpen,
}: {
  onOpen: (trigger: HTMLButtonElement) => void;
}) {
  const { t } = useI18n();
  const { board } = useBoardState();
  const { role } = useBoardAccess();
  const live = useBoardLive();
  const boardId = board?.id;
  const admin = role === "ADMIN";
  const pending = usePendingApprovals({
    boardId,
    canViewApprovals: admin,
    enabled: isApiEnabled() && boardId !== undefined,
  });
  const reload = pending.reload;

  useEffect(
    () => live.agentControl.subscribeApproval(() => reload()),
    [live, reload],
  );

  if (!isApiEnabled() || boardId === undefined) {
    return null;
  }

  const label = t("agents.open");
  const pendingCount = pending.pendingCount;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={label}
          data-testid={admin ? "agent-control-trigger" : "agent-runs-trigger"}
          onClick={(event) => onOpen(event.currentTarget)}
          className="relative"
        >
          <LazyAnimatedIcon name="bot" size={20} aria-hidden />
          {admin && pendingCount !== null && pendingCount > 0 ? (
            <span
              data-testid="agent-control-pending-count"
              data-state={pending.stale ? "stale" : "fresh"}
              title={pending.stale ? t("agents.pending.stale") : undefined}
              className="absolute -right-0.5 -top-0.5 min-w-4 rounded-full bg-danger px-1 text-[10px] font-semibold leading-4 text-white"
            >
              {pendingCount > 99 ? "99+" : pendingCount}
            </span>
          ) : null}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
