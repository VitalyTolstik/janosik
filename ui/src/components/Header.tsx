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
import { restoreBoardSettingsFocus } from "@/components/board/settings/focus";
import { ShareDialog } from "@/components/board/ShareDialog";
import { BoardSwitcher } from "@/components/board/BoardSwitcher";
import { BoardTitle } from "@/components/board/BoardTitle";
import { DataMenu } from "@/components/DataMenu";
import { GlobalSearch } from "@/components/GlobalSearch";
import { HelpMenu } from "@/components/HelpMenu";
import { useBoardView } from "@/components/board/BoardViewProvider";
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
import { copySearchParamsWithoutLanguageHandoff } from "@/utils/search-params";

/**
 * The approvals/pause dialog is its own lazy chunk: the board loads on the
 * critical path, and most sessions never open agent control at all.
 */
const AgentControlDialog = lazy(() =>
  import("@/components/agent-control/AgentControlDialog").then((module) => ({
    default: module.AgentControlDialog,
  })),
);

const AGENT_TRIGGER_SELECTOR =
  '[data-testid="agent-control-trigger"], [data-testid="agent-runs-trigger"]';

function findAgentTrigger(): HTMLButtonElement | null {
  return document.querySelector<HTMLButtonElement>(AGENT_TRIGGER_SELECTOR);
}

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
  // A mandatory card dialog makes the rest of the board inert (aria-hidden),
  // so header triggers behind it cannot be reached. Remember the state and
  // hide the Members trigger on archived deep links rather than leaving a
  // button that a keyboard or screen reader can focus but not activate.
  const cardOpen =
    isBoardRoute && new URLSearchParams(location.search).has("card");
  // Narrow subscriptions on purpose (TASK-21.4): the actions never change
  // and the flags flip rarely, so typing in a card leaves the header alone.
  const { undo, redo, roleOf } = useBoardActions();
  const { canUndo, canRedo } = useBoardHistory();
  const { role } = useBoardAccess();
  const { board, boards } = useBoard();
  const { view } = useBoardView();
  const settingsBoardId = isBoardRoute ? board?.id : undefined;
  const scopeParam = new URLSearchParams(location.search).get("board");
  // Opening a detail from All boards keeps `scope=all` and adds the row's
  // `board` for the deep link. The visible scope stays All boards; the board
  // param belongs to the detail, not to the header combobox or its counts.
  const allDetailScope =
    new URLSearchParams(location.search).get("scope") === "all";
  const headerBoardId = allDetailScope ? null : scopeParam;
  const pendingBoards = boards.map((board) => ({
    id: board.id,
    role: roleOf(board.id),
    archivedAt: board.archivedAt,
  }));
  // A member-only board scope keeps cross-board counts in the rail; the
  // header combobox must read the same ADMIN-board snapshot instead of
  // asking for an approvals scope the member cannot see.
  const scopedBoardReadable =
    headerBoardId !== null &&
    pendingBoards.some(
      (board) =>
        board.id === headerBoardId &&
        board.role === "ADMIN" &&
        board.archivedAt === undefined,
    );
  const hasAdminBoard = pendingBoards.some(
    (board) => board.role === "ADMIN" && board.archivedAt === undefined,
  );
  const needsCrossBoardCounts =
    headerBoardId !== null && !scopedBoardReadable && hasAdminBoard;
  const pendingApprovals = usePendingApprovals({
    boardId: needsCrossBoardCounts ? null : headerBoardId,
    boards: pendingBoards,
    enabled: isAgentsRoute,
    status: "pending",
  });
  const pendingAll = pendingApprovals.totalCount;
  const pendingForScope =
    headerBoardId === null
      ? pendingAll
      : (pendingApprovals.counts[headerBoardId] ?? null);
  const pendingBadge = pendingForScope;
  // A VIEWER has no mutating affordances, undo included: a stale local stack
  // after a live demotion would only offer commands the server refuses.
  // An archived board is read-only too — its card deep link is a view, not
  // an editing surface (the command path refuses writes for the same reason).
  const readOnly = role === "VIEWER" || board?.archivedAt !== undefined;
  // Archived boards keep the roster read-only for everyone, but the admin
  // surfaces (members, sharing, settings, agent control) would offer writes
  // that the command and REST guards refuse. Hide them until restore.
  const archived = board?.archivedAt !== undefined;
  const [settings, setSettings] = useState<{
    boardId: string;
    section: "workflow" | "agents";
  } | null>(null);
  // A board switch forcibly unmounts Settings without a close event. Remember
  // which board owned the last open dialog so focus can move to the new board
  // once its header is mounted, not fall to BODY with the discarded dialog.
  const settingsBoardRef = useRef<string | null>(null);
  if (settings !== null && settings.boardId !== settingsBoardId) {
    setSettings(null);
  }
  const openSettings = (section: "workflow" | "agents") => {
    if (settingsBoardId !== undefined)
      setSettings({ boardId: settingsBoardId, section });
  };
  useEffect(() => {
    if (settings !== null) {
      settingsBoardRef.current = settings.boardId;
      return;
    }
    const previousBoardId = settingsBoardRef.current;
    if (previousBoardId === null) return;
    if (!isBoardRoute) {
      settingsBoardRef.current = null;
      return;
    }
    // Still between aggregates: wait for the target board, so the gear/title
    // that receives focus belongs to the new board.
    if (settingsBoardId === undefined) return;
    settingsBoardRef.current = null;
    // A normal close keeps the same board; the shell already restored focus.
    if (settingsBoardId !== previousBoardId) restoreBoardSettingsFocus();
  }, [isBoardRoute, settings, settingsBoardId]);
  const [agentControlOpen, setAgentControlOpen] = useState(false);
  const agentTrigger = useRef<HTMLButtonElement | null>(null);
  const agentsLink = useRef<HTMLAnchorElement | null>(null);
  const [agentControlTab, setAgentControlTab] =
    useState<AgentControlTab>("approvals");

  const restoreAgentTrigger = (event: Event) => {
    const trigger = agentTrigger.current?.isConnected
      ? agentTrigger.current
      : findAgentTrigger();
    if (trigger !== null) {
      event.preventDefault();
      agentTrigger.current = trigger;
      trigger.focus();
      return;
    }
    // Browser Back replaced the board header: its trigger is detached. Hand
    // focus to the mounted global entry instead of letting Radix drop it on
    // BODY.
    if (isAgentsRoute) {
      event.preventDefault();
      agentsLink.current?.focus();
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

  const agentsParam = isBoardRoute
    ? new URLSearchParams(location.search).get("agents")
    : null;
  const tabForAgentsParam = (value: string): AgentControlTab =>
    value === "live" ? "pause" : value === "runs" ? "runs" : "approvals";
  const agentsValueForTab = (value: AgentControlTab): string =>
    value === "pause" ? "live" : value === "runs" ? "runs" : "inbox";
  const writeAgentsParam = (value: AgentControlTab | null) => {
    const next = copySearchParamsWithoutLanguageHandoff(location.search);
    if (value === null) {
      next.delete("agents");
      next.delete("approval");
    } else {
      next.set("agents", agentsValueForTab(value));
      if (value !== "approvals") next.delete("approval");
    }
    navigate(
      { pathname: location.pathname, search: next.toString() },
      { replace: true },
    );
  };
  const openAgentControl = (value: AgentControlTab) => {
    setAgentControlTab(value);
    setAgentControlOpen(true);
    writeAgentsParam(value);
  };
  const closeAgentControl = () => {
    setAgentControlOpen(false);
    writeAgentsParam(null);
  };

  // `Open board` on the agent surfaces deep-links into the board-scoped Agent
  // control dialog (TASK-179 pixel parity): `?agents=inbox|live|runs`.
  // The param stays in the URL so reload/back/forward reopen the same tab.
  const lastAgentsParam = useRef<string | null>(agentsParam);
  const restoreAgentsFocus = useRef(false);
  useEffect(() => {
    if (!isBoardRoute) {
      // The board header unmounts with its trigger; the dialog state lives on
      // this shared Header. Reset it so Back to /agents cannot orphan the
      // board-scoped modal over the global page.
      lastAgentsParam.current = null;
      return;
    }
    if (agentsParam === null) {
      // Browser Back from a pinned tab closes the dialog again; the initial
      // board load without a param must stay closed.
      if (lastAgentsParam.current !== null) {
        setAgentControlOpen(false);
      }
    } else {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- the deep link is the effect's purpose
      setAgentControlTab(tabForAgentsParam(agentsParam));
      setAgentControlOpen(true);
    }
    lastAgentsParam.current = agentsParam;
  }, [agentsParam, isBoardRoute]);

  // A route change away from a board is not a Dialog close event: Radix never
  // sees `onOpenChange`, and the old trigger is already detached. Close here
  // so the board-scoped modal cannot outlive its route, then restore focus to
  // the global Agents entry one task later (after Radix's own focus cleanup).
  useEffect(() => {
    if (isBoardRoute) return;
    if (agentControlOpen) {
      restoreAgentsFocus.current = true;
      // eslint-disable-next-line react-hooks/set-state-in-effect -- leaving the board must unmount the modal
      setAgentControlOpen(false);
    }
    // The board trigger unmounts with its header. Dropping the stale node
    // lets the reopen resolver attach the freshly mounted button.
    agentTrigger.current = null;
  }, [agentControlOpen, isBoardRoute]);

  useEffect(() => {
    if (!restoreAgentsFocus.current || agentControlOpen) return;
    if (!isAgentsRoute) {
      restoreAgentsFocus.current = false;
      return;
    }
    const focusEntry = () => {
      restoreAgentsFocus.current = false;
      agentsLink.current?.focus();
    };
    // Run after Radix's own close-auto-focus task, which would otherwise drop
    // focus on BODY because the board trigger is detached.
    const timer = window.setTimeout(focusEntry, 0);
    return () => window.clearTimeout(timer);
  }, [agentControlOpen, isAgentsRoute]);

  // A `?agents=` deep link opens the dialog without a click, so the return
  // trigger was never stored. Resolve the header entry once it is mounted so
  // Escape returns focus there instead of leaving it on BODY. A stale ref from
  // the previous board visit is detached; replace it with the live button.
  useEffect(() => {
    if (!agentControlOpen || agentTrigger.current?.isConnected) return;
    const trigger = findAgentTrigger();
    if (trigger !== null) agentTrigger.current = trigger;
  }, [agentControlOpen, agentsParam, location.pathname]);

  return (
    <header
      className={cn(
        // TASK-177.18: a standalone iOS window paints under the status bar and
        // the landscape notch. `max()` keeps the existing spacing whenever
        // `env()` is 0 (every desktop browser), so nothing gets double padding.
        // From `sm` up the 52 px row grows by the top inset (iPad standalone)
        // instead of squeezing its controls.
        "sticky top-0 z-40 flex min-h-[61px] shrink-0 flex-col gap-1 border-b bg-background/80 bg-gradient-to-br from-primary/15 via-secondary/10 to-transparent py-1.5 pr-[max(0.75rem,env(safe-area-inset-right))] pl-[max(0.75rem,env(safe-area-inset-left))] backdrop-blur-md max-sm:pt-[max(0.375rem,env(safe-area-inset-top))] sm:h-[calc(52px_+_env(safe-area-inset-top))] sm:min-h-[calc(52px_+_env(safe-area-inset-top))] sm:flex-row sm:flex-nowrap sm:items-center sm:justify-between sm:gap-0 sm:pb-0 sm:pt-[env(safe-area-inset-top)] sm:pr-[max(1.5rem,env(safe-area-inset-right))] sm:pl-[max(1.5rem,env(safe-area-inset-left))]",
        isAgentsRoute &&
          "min-h-[61px] flex-row flex-nowrap items-center pr-[max(10px,env(safe-area-inset-right))] pl-[max(10px,env(safe-area-inset-left))] font-agent-surface sm:pr-[max(14px,env(safe-area-inset-right))] sm:pl-[max(14px,env(safe-area-inset-left))]",
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
            <BrandMark />
            <span
              data-testid="agents-wordmark"
              className="hidden font-agent-display text-ui-body font-bold leading-none tracking-[-0.02em] sm:inline"
            >
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
            {/* The compact chevron stays on the phone header: switching
                boards is navigation, not secondary chrome. */}
            <BoardSwitcher />
          </>
        ) : isAgentsRoute ? (
          <nav
            aria-label={t("agents.breadcrumb")}
            className="flex min-w-0 items-center gap-2 text-ui-body"
          >
            <div className="max-w-[150px] min-w-0 sm:max-w-[240px]">
              <BoardScopeSelect
                value={headerBoardId ?? "all"}
                boards={boards
                  .filter((board) => !board.archivedAt)
                  .map((board) => ({ id: board.id, title: board.title }))}
                onChange={(boardId) => {
                  const query = copySearchParamsWithoutLanguageHandoff(
                    location.search,
                  );
                  if (boardId === "all") query.delete("board");
                  else query.set("board", boardId);
                  query.delete("scope");
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
                stale={pendingApprovals.stale}
              />
            </div>
            <ChevronRight
              aria-hidden
              className="hidden h-3 w-3 shrink-0 text-muted-foreground sm:block"
            />
            <span className="hidden font-agent-surface text-ui-body font-medium leading-[1.45] text-foreground sm:inline">
              {t("agents.open")}
            </span>
            <span className="hidden h-[23px] items-center gap-[5px] rounded-[5px] border border-[color:color-mix(in_oklab,var(--primary)_24%,var(--border))] bg-[color-mix(in_oklab,var(--primary)_7%,transparent)] px-[7px] text-ui-meta text-[color:color-mix(in_oklab,var(--primary)_78%,var(--foreground))] lg:inline-flex">
              <Info className="h-3 w-3" aria-hidden />
              {t("agents.shell.globalView")}
            </span>
          </nav>
        ) : null}
        {!isAgentsRoute ? (
          <div>
            <NotificationsBell />
          </div>
        ) : null}
        {isBoardRoute ? (
          <>
            {!archived || (role !== "ADMIN" && !cardOpen) ? (
              <div className={archived ? "block" : "hidden min-[1024px]:block"}>
                <BoardMembersDialog key={settingsBoardId ?? "no-board"} />
              </div>
            ) : null}
            {!archived ? (
              <div className="hidden min-[1024px]:block">
                <ShareDialog />
              </div>
            ) : null}
            {!archived ? (
              <AgentControlButton
                onOpen={(trigger) => {
                  agentTrigger.current = trigger;
                  // Members start on read-only Live; admins start in Inbox.
                  openAgentControl(role === "ADMIN" ? "approvals" : "pause");
                }}
              />
            ) : null}
            {role === "ADMIN" && !readOnly ? (
              <div className="max-[720.98px]:hidden">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={t("board.settings.button")}
                      data-testid="board-settings-trigger"
                      className="md:h-8 md:w-8 md:min-w-8"
                      onClick={() => openSettings("workflow")}
                    >
                      <LazyAnimatedIcon name="settings" size={16} />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{t("board.settings.button")}</TooltipContent>
                </Tooltip>
              </div>
            ) : null}
            {/* The presence stack needs the widest header; below 1200 px the
                roster stays reachable from the members dialog. */}
            <div className="hidden min-[1200px]:block">
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
        ) : isBoardRoute ? (
          // The icon returns at 721 px; the label waits for the full header
          // at 1024 px so it cannot paint over the title or Agents.
          <div className="hidden min-[721px]:block">
            <GlobalSearch labelClassName="hidden min-[1024px]:inline" />
          </div>
        ) : (
          <GlobalSearch />
        )}
        {isAgentsRoute ? (
          <NotificationsBell />
        ) : isBoardRoute ? (
          <div className="hidden min-[1200px]:block">
            <HelpMenu
              filter={board !== undefined && view !== "watch"}
              kanban={board !== undefined && view === "board"}
              canEdit={board !== undefined && !readOnly}
              selectable={
                board !== undefined &&
                !readOnly &&
                (view === "board" || view === "table")
              }
            />
          </div>
        ) : (
          <HelpMenu />
        )}
        {isAgentsRoute ? (
          <Link
            to={routes.agents}
            ref={agentsLink}
            data-testid="agents-trigger"
            aria-label={t("agents.open")}
            aria-current="page"
            title={
              (pendingApprovals.error || pendingApprovals.forbidden) &&
              pendingBadge === null
                ? t("agents.pending.unknown")
                : undefined
            }
            className="inline-flex min-h-11 items-center gap-1.5 rounded-[6px] border border-[color:color-mix(in_oklab,var(--primary)_26%,var(--border))] bg-[color-mix(in_oklab,var(--primary)_7%,transparent)] px-2 font-agent-surface text-ui-label font-semibold leading-[1.45] text-foreground hover:bg-[color-mix(in_oklab,var(--primary)_12%,transparent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:min-h-[30px]"
          >
            <LazyAnimatedIcon name="bot" size={15} aria-hidden />
            <span className="inline">{t("agents.open")}</span>
            {pendingBadge !== null && pendingBadge > 0 ? (
              <span
                data-testid="agents-pending-count"
                data-state={pendingApprovals.stale ? "stale" : "fresh"}
                title={
                  pendingApprovals.stale ? t("agents.pending.stale") : undefined
                }
                className="inline-grid h-[17px] min-w-[17px] place-items-center rounded-full bg-warning px-1 text-ui-micro font-bold leading-none tabular-nums text-[#1b1305]"
              >
                {pendingBadge > 99 ? "99+" : pendingBadge}
              </span>
            ) : null}
          </Link>
        ) : null}

        {isBoardRoute && !readOnly ? (
          // Undo/redo stay in the header at every width: the destructive
          // confirmations promise "you can undo this right away", and a
          // touch-only user has no keyboard shortcut to fall back on.
          <div className="flex items-center gap-0.5">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={t("undo.aria")}
                  disabled={!canUndo}
                  onClick={undo}
                  className="max-lg:h-11 max-lg:w-11 max-lg:min-w-11 lg:h-8 lg:w-8 lg:min-w-8"
                >
                  <LazyAnimatedIcon name="arrow-left" size={16} />
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
                  className="max-lg:h-11 max-lg:w-11 max-lg:min-w-11 lg:h-8 lg:w-8 lg:min-w-8"
                >
                  <LazyAnimatedIcon name="arrow-right" size={16} />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t("redo.tooltip")}</TooltipContent>
            </Tooltip>
          </div>
        ) : null}

        {isBoardRoute ? (
          // Every width keeps the data menu: the card archive is the only
          // in-app recovery path for an archived card, and it must not be
          // stranded on phones/tablets (QA-02).
          <div className="block">
            <DataMenu />
          </div>
        ) : null}

        <AccountDialog onOpenAgents={openAllAgents} compact={isAgentsRoute} />
      </div>

      {settings !== null && settings.boardId === settingsBoardId ? (
        <BoardSettingsDialog
          key={settings.boardId}
          open
          onOpenChange={(open) => {
            if (!open)
              setSettings((current) => (current === settings ? null : current));
          }}
          initialSection={settings.section}
          onOpenLiveControls={() => {
            // Board Settings closes first (with its dirty guard); keep the
            // board route and expose the same durable Live deep link.
            openAgentControl("pause");
          }}
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
                  data-testid="agent-control-fallback"
                >
                  <Loader2
                    className="h-4 w-4 animate-spin motion-reduce:animate-none"
                    aria-hidden
                  />
                  {t("common.loading")}
                </DialogDescription>
              </DialogContent>
            </Dialog>
          }
        >
          <AgentControlDialog
            open={agentControlOpen}
            onOpenChange={(open) => {
              if (open) setAgentControlOpen(true);
              else closeAgentControl();
            }}
            onTabChange={(next) => writeAgentsParam(next)}
            initialTab={agentControlTab}
            onOpenAllAgents={openAllAgents}
            onOpenPolicy={() => {
              closeAgentControl();
              openSettings("agents");
            }}
            onCloseAutoFocus={restoreAgentTrigger}
          />
        </Suspense>
      ) : null}
    </header>
  );
}
