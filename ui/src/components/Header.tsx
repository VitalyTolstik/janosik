import { Link, matchPath, useLocation, useNavigate } from "react-router-dom";
import { Loader2 } from "lucide-react";

import { AccountDialog } from "@/components/account/AccountDialog";
import { BrandMark } from "@/components/BrandMark";
import { AgentControlButton } from "@/components/agent-control/AgentControlButton";
import type { AgentControlTab } from "@/components/agent-control/AgentControlDialog";
import { BoardMembersDialog } from "@/components/board/BoardMembersDialog";
import { BoardSettingsDialog } from "@/components/board/BoardSettingsDialog";
import { ShareDialog } from "@/components/board/ShareDialog";
import { BoardSwitcher } from "@/components/board/BoardSwitcher";
import { BoardTitle } from "@/components/board/BoardTitle";
import { DataMenu } from "@/components/DataMenu";
import { GlobalSearch } from "@/components/GlobalSearch";
import { HelpMenu } from "@/components/HelpMenu";
import { NotificationsBell } from "@/components/NotificationsBell";
import { LazyAnimatedIcon } from "@/components/ui/lazy-animated-icon";
import { Button } from "@/components/ui/button";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useI18n } from "@/i18n";
import { routes } from "@/routes";
import { PresenceStack } from "@/components/board/PresenceStack";
import {
  useBoardAccess,
  useBoardActions,
  useBoardHistory,
} from "@/store/BoardContext";

/**
 * The approvals/pause dialog is its own lazy chunk: the board loads on the
 * critical path, and most sessions never open agent control at all.
 */
const AgentControlDialog = lazy(() =>
  import("@/components/agent-control/AgentControlDialog").then((module) => ({
    default: module.AgentControlDialog,
  })),
);

/** Header: brand, board switcher, search, undo/redo, data and the account. */
export function Header() {
  const { t } = useI18n();
  const location = useLocation();
  const navigate = useNavigate();
  const isBoardRoute =
    matchPath(routes.boardPattern, location.pathname) !== null;
  const isAgentsRoute =
    matchPath(routes.agents, location.pathname) !== null ||
    matchPath(routes.agentPattern, location.pathname) !== null;
  // Narrow subscriptions on purpose (TASK-21.4): the actions never change
  // and the flags flip rarely, so typing in a card leaves the header alone.
  const { undo, redo } = useBoardActions();
  const { canUndo, canRedo } = useBoardHistory();
  const { role } = useBoardAccess();
  // A VIEWER has no mutating affordances, undo included: a stale local stack
  // after a live demotion would only offer commands the server refuses.
  const readOnly = role === "VIEWER";
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [agentControlOpen, setAgentControlOpen] = useState(false);
  const agentTrigger = useRef<HTMLButtonElement | null>(null);
  const agentsLink = useRef<HTMLAnchorElement | null>(null);
  const [agentControlTab, setAgentControlTab] =
    useState<AgentControlTab>("approvals");

  const restoreAgentTrigger = (event: Event) => {
    if (agentTrigger.current?.isConnected) {
      event.preventDefault();
      agentTrigger.current.focus();
    }
  };
  const openAllAgents = () => {
    setAgentControlOpen(false);
    navigate(routes.agents, { state: { focusAgentsEntry: true } });
  };

  useEffect(() => {
    if (isAgentsRoute && location.state?.focusAgentsEntry === true) {
      agentsLink.current?.focus();
    }
  }, [isAgentsRoute, location.key, location.state]);

  return (
    <header className="sticky top-0 z-40 flex min-h-14 shrink-0 flex-col gap-1 border-b bg-background/80 bg-gradient-to-br from-primary/15 via-secondary/10 to-transparent px-3 py-1.5 backdrop-blur-md sm:h-14 sm:flex-row sm:flex-nowrap sm:items-center sm:justify-between sm:gap-0 sm:px-6 sm:py-0">
      <div className="group flex w-full min-w-0 items-center gap-1 sm:w-auto sm:flex-1 sm:gap-3">
        <BrandMark />
        {isBoardRoute ? (
          <>
            <BoardTitle />
            <BoardSwitcher />
          </>
        ) : isAgentsRoute ? (
          <nav
            aria-label={t("agents.breadcrumb")}
            className="flex min-w-0 items-center gap-2 text-sm"
          >
            <Link
              to={routes.boards}
              className="text-muted-foreground hover:text-foreground"
            >
              {t("search.boards")}
            </Link>
            <span aria-hidden className="text-muted-foreground">
              /
            </span>
            <Link
              to={routes.agents}
              ref={agentsLink}
              data-testid="agents-trigger"
              className="inline-flex items-center gap-1.5 font-medium text-foreground"
            >
              <LazyAnimatedIcon name="bot" size={16} aria-hidden />
              {t("agents.open")}
            </Link>
          </nav>
        ) : null}
        <NotificationsBell />
        {isBoardRoute ? (
          <>
            <BoardMembersDialog />
            <ShareDialog />
            <AgentControlButton
              onOpen={(trigger) => {
                agentTrigger.current = trigger;
                // A member/VIEWER starts on the read-only runs view; an ADMIN
                // keeps the approvals-first flow from TASK-166.14.
                setAgentControlTab(role === "ADMIN" ? "approvals" : "runs");
                setAgentControlOpen(true);
              }}
            />
            {role === "ADMIN" ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={t("board.settings.button")}
                    data-testid="board-settings-trigger"
                    onClick={() => setSettingsOpen(true)}
                  >
                    <LazyAnimatedIcon name="settings" size={20} />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{t("board.settings.button")}</TooltipContent>
              </Tooltip>
            ) : null}
            {/* The presence stack needs more width than a phone header can
            give; the roster stays reachable from the members dialog. */}
            <div className="hidden sm:block">
              <PresenceStack />
            </div>
          </>
        ) : null}
      </div>

      <div className="ml-auto flex w-full shrink-0 items-center justify-end gap-0.5 sm:w-auto sm:justify-start">
        <GlobalSearch />
        <HelpMenu />

        {isBoardRoute && !readOnly ? (
          <>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={t("undo.aria")}
                  disabled={!canUndo}
                  onClick={undo}
                >
                  <LazyAnimatedIcon name="arrow-left" size={20} />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t("undo.tooltip")}</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={t("redo.aria")}
                  disabled={!canRedo}
                  onClick={redo}
                >
                  <LazyAnimatedIcon name="arrow-right" size={20} />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t("redo.tooltip")}</TooltipContent>
            </Tooltip>
          </>
        ) : null}

        {isBoardRoute ? <DataMenu /> : null}

        <AccountDialog onOpenAgents={openAllAgents} />
      </div>

      {settingsOpen ? (
        <BoardSettingsDialog
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
        />
      ) : null}

      {agentControlOpen ? (
        <Suspense
          fallback={
            <Dialog open onOpenChange={setAgentControlOpen}>
              <DialogContent onCloseAutoFocus={restoreAgentTrigger}>
                <DialogTitle>{t("agentControl.title")}</DialogTitle>
                <DialogDescription
                  className="flex items-center gap-2"
                  role="status"
                >
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                  {t("common.loading")}
                </DialogDescription>
              </DialogContent>
            </Dialog>
          }
        >
          <AgentControlDialog
            open={agentControlOpen}
            onOpenChange={setAgentControlOpen}
            initialTab={agentControlTab}
            onOpenAllAgents={openAllAgents}
            onCloseAutoFocus={restoreAgentTrigger}
          />
        </Suspense>
      ) : null}
    </header>
  );
}
