import { Link, matchPath, useLocation, useNavigate } from "react-router-dom";
import { ChevronRight, Info, Loader2 } from "lucide-react";

import { AccountDialog } from "@/components/account/AccountDialog";
import { BrandMark } from "@/components/BrandMark";
import { AgentControlButton } from "@/components/agent-control/AgentControlButton";
import type { AgentControlTab } from "@/components/agent-control/AgentControlDialog";
import { usePendingApprovals } from "@/components/agents/use-pending-approvals";
import { BoardMembersDialog } from "@/components/board/BoardMembersDialog";
import { BoardScopeSelect } from "@/components/agents/BoardScopeSelect";
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
import { cn } from "@/lib/utils";
import { PresenceStack } from "@/components/board/PresenceStack";
import {
  useBoard,
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
  const { boards } = useBoard();
  const pendingApprovals = usePendingApprovals(undefined, isAgentsRoute);
  const scopeParam = new URLSearchParams(location.search).get("board");
  const pendingAll = Object.values(pendingApprovals.counts).reduce(
    (total, count) => total + count,
    0,
  );
  const pendingForScope =
    scopeParam === null
      ? pendingAll
      : (pendingApprovals.counts[scopeParam] ?? 0);
  const pendingBadge = pendingApprovals.error ? 0 : pendingForScope;
  // A VIEWER has no mutating affordances, undo included: a stale local stack
  // after a live demotion would only offer commands the server refuses.
  const readOnly = role === "VIEWER";
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSection, setSettingsSection] = useState<"workflow" | "agents">(
    "workflow",
  );
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
    <header
      className={cn(
        "sticky top-0 z-40 flex min-h-14 shrink-0 flex-col gap-1 border-b bg-background/80 bg-gradient-to-br from-primary/15 via-secondary/10 to-transparent px-3 py-1.5 backdrop-blur-md sm:h-14 sm:flex-row sm:flex-nowrap sm:items-center sm:justify-between sm:gap-0 sm:px-6 sm:py-0",
        isAgentsRoute &&
          "min-h-[52px] flex-row flex-nowrap items-center px-[10px] font-agent-surface sm:h-[52px] sm:px-[14px]",
      )}
    >
      <div
        className={cn(
          "group flex w-full min-w-0 items-center gap-1 sm:w-auto sm:flex-1 sm:gap-3",
          isAgentsRoute && "w-auto flex-1 gap-[10px]",
        )}
      >
        {isAgentsRoute ? (
          <Link
            to={routes.home}
            aria-label={t("agents.home")}
            data-testid="agents-home"
            className="flex shrink-0 items-center gap-2 rounded-md focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            <BrandMark size="compact" />
            <span className="hidden font-display text-[14px] font-bold leading-none tracking-[-0.02em] sm:inline">
              Janosik
            </span>
          </Link>
        ) : (
          <BrandMark />
        )}
        {isAgentsRoute ? (
          <span
            aria-hidden
            className="hidden h-5 w-px shrink-0 bg-border sm:block"
          />
        ) : null}
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
            <div className="max-w-[150px] min-w-0 sm:max-w-[240px]">
              <BoardScopeSelect
                value={
                  new URLSearchParams(location.search).get("board") ?? "all"
                }
                boards={boards
                  .filter((board) => !board.archivedAt)
                  .map((board) => ({ id: board.id, title: board.title }))}
                onChange={(boardId) => {
                  const query = new URLSearchParams(location.search);
                  if (boardId === "all") query.delete("board");
                  else query.set("board", boardId);
                  query.delete("approval");
                  query.delete("run");
                  query.delete("session");
                  navigate({
                    pathname: routes.agents,
                    search: query.toString(),
                  });
                }}
                ariaLabel={t("agents.filters.board")}
                testId="agents-header-scope"
                variant="header"
                counts={pendingApprovals.counts}
                totalCount={pendingAll}
              />
            </div>
            <span
              aria-hidden
              className="hidden text-muted-foreground sm:inline-flex"
            >
              <ChevronRight className="h-3 w-3" />
            </span>
            <span className="hidden font-agent-surface text-[12px] font-medium leading-[1.45] text-foreground sm:inline">
              {t("agents.open")}
            </span>
            <span className="hidden items-center gap-1 rounded border border-primary/40 bg-primary/10 px-2 py-1 text-[11px] text-primary lg:inline-flex">
              <Info className="h-3 w-3" aria-hidden />
              {t("agents.shell.globalView")}
            </span>
          </nav>
        ) : null}
        {!isAgentsRoute ? <NotificationsBell /> : null}
        {isBoardRoute ? (
          <>
            <BoardMembersDialog />
            <ShareDialog />
            <AgentControlButton
              onOpen={(trigger) => {
                agentTrigger.current = trigger;
                // Members start on read-only Live; admins start in Inbox.
                setAgentControlTab(role === "ADMIN" ? "approvals" : "pause");
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
                    onClick={() => {
                      setSettingsSection("workflow");
                      setSettingsOpen(true);
                    }}
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

      <div
        className={cn(
          "ml-auto flex w-full shrink-0 items-center justify-end gap-0.5 sm:w-auto sm:justify-start",
          isAgentsRoute && "w-auto",
        )}
      >
        {isAgentsRoute ? (
          <div className="hidden sm:block">
            <GlobalSearch iconOnly />
          </div>
        ) : (
          <GlobalSearch />
        )}
        {isAgentsRoute ? <NotificationsBell /> : <HelpMenu />}
        {isAgentsRoute ? (
          <Link
            to={routes.agents}
            ref={agentsLink}
            data-testid="agents-trigger"
            aria-label={t("agents.open")}
            aria-current="page"
            className="inline-flex min-h-11 items-center gap-1.5 rounded-md border border-primary/40 bg-primary/10 px-2 font-agent-surface text-[11.5px] font-semibold leading-[1.45] text-foreground hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:min-h-[30px]"
          >
            <LazyAnimatedIcon name="bot" size={15} aria-hidden />
            <span className="hidden sm:inline">{t("agents.open")}</span>
            {pendingBadge > 0 ? (
              <span
                data-testid="agents-pending-count"
                className="inline-grid h-[17px] min-w-[17px] place-items-center rounded-full bg-warning px-1 text-[10.5px] font-bold leading-none tabular-nums text-[#1b1305]"
              >
                {pendingBadge > 99 ? "99+" : pendingBadge}
              </span>
            ) : null}
          </Link>
        ) : null}

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

        <AccountDialog onOpenAgents={openAllAgents} compact={isAgentsRoute} />
      </div>

      {settingsOpen ? (
        <BoardSettingsDialog
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
          initialSection={settingsSection}
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
            onOpenPolicy={() => {
              setAgentControlOpen(false);
              setSettingsSection("agents");
              setSettingsOpen(true);
            }}
            onCloseAutoFocus={restoreAgentTrigger}
          />
        </Suspense>
      ) : null}
    </header>
  );
}
