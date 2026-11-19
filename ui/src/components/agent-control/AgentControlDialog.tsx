import { useEffect, useState, type KeyboardEvent } from "react";
import {
  Activity,
  ArrowUpRight,
  Bot,
  History,
  Inbox,
  Settings2,
  X,
} from "lucide-react";

import { api, isApiEnabled } from "@/api/client";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { useI18n } from "@/i18n";
import { useMediaQuery } from "@/hooks/use-media-query";
import { cn } from "@/lib/utils";
import { useBoardLive } from "@/store/board-live";
import { useBoardAccess, useBoardState } from "@/store/BoardContext";
import { AgentControlFooterContext } from "@/components/agents/agent-control-footer-context";
import { ApprovalsPanel } from "./ApprovalsPanel";
import { useBoardApprovalQueue } from "./use-board-approval-queue";
import { PausePanel } from "./PausePanel";
import { RunsPanel } from "./RunsPanel";
import "./agent-control.css";

export type AgentControlTab = "approvals" | "pause" | "runs";

export function AgentControlDialog({
  open,
  onOpenChange,
  initialTab = "approvals",
  onTabChange,
  onOpenAllAgents,
  onOpenPolicy,
  onCloseAutoFocus,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialTab?: AgentControlTab;
  onTabChange?: (tab: AgentControlTab) => void;
  onOpenAllAgents?: () => void;
  onOpenPolicy?: () => void;
  onCloseAutoFocus?: (event: Event) => void;
}) {
  const { t } = useI18n();
  const verticalRail = useMediaQuery("(min-width: 768px)");
  const { role } = useBoardAccess();
  const { board } = useBoardState();
  const live = useBoardLive();
  const boardId = board?.id;
  const approvals = useBoardApprovalQueue(boardId, open && role === "ADMIN");
  const [liveCount, setLiveCount] = useState<number | null>(null);
  const [runsCount, setRunsCount] = useState<number | null>(null);
  const [liveRevision, setLiveRevision] = useState(0);
  const [runRevision, setRunRevision] = useState(0);
  const [tab, setTab] = useState<AgentControlTab>(
    role !== "ADMIN" && initialTab === "approvals" ? "pause" : initialTab,
  );
  const [footerHost, setFooterHost] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- keep the URL-selected tab in sync on back/forward
    setTab(
      role !== "ADMIN" && initialTab === "approvals" ? "pause" : initialTab,
    );
  }, [initialTab, role]);
  const changeTab = (next: AgentControlTab) => {
    setTab(next);
    onTabChange?.(next);
  };

  useEffect(() => {
    if (!open) return;
    const unsubscribeAgent = live.agentControl.subscribeAgent((event) => {
      if (event.op === "started" || event.op === "ended") {
        setLiveRevision((value) => value + 1);
      }
    });
    const unsubscribeRun = live.agentControl.subscribeRun(() =>
      setRunRevision((value) => value + 1),
    );
    return () => {
      unsubscribeAgent();
      unsubscribeRun();
    };
  }, [live, open]);

  useEffect(() => {
    if (!open || boardId === undefined || !isApiEnabled()) return;
    let alive = true;
    void api.listAgentSessions(boardId, true).then(
      (rows) => {
        if (alive) setLiveCount(rows.length);
      },
      () => {
        if (alive) setLiveCount(null);
      },
    );
    return () => {
      alive = false;
    };
  }, [boardId, liveRevision, open]);

  useEffect(() => {
    if (!open || boardId === undefined || !isApiEnabled()) return;
    let alive = true;
    void api.listRuns(boardId, { limit: 100 }).then(
      (rows) => {
        if (alive) setRunsCount(rows.length);
      },
      () => {
        if (alive) setRunsCount(null);
      },
    );
    return () => {
      alive = false;
    };
  }, [boardId, open, runRevision]);

  const pending = approvals.current?.pendingError
    ? null
    : (approvals.current?.pending?.total ?? null);
  const livePause = live.agentControl.getBoardPause(boardId);
  const boardPaused =
    livePause?.paused ??
    (board?.agentsPausedAt !== undefined && board.agentsPausedAt !== null);

  const tabs = [
    ...(role === "ADMIN"
      ? [
          {
            id: "approvals" as const,
            label: t("agentControl.shell.inbox"),
            icon: Inbox,
            testId: "agent-approvals-tab",
            count: pending ?? undefined,
            badge: true,
          },
        ]
      : []),
    {
      id: "pause" as const,
      label: t("agentControl.shell.live"),
      icon: Activity,
      testId: "agent-pause-tab",
      count: liveCount ?? undefined,
      badge: false,
    },
    {
      id: "runs" as const,
      label: t("agentControl.shell.runs"),
      icon: History,
      testId: "agent-runs-tab",
      count: runsCount ?? undefined,
      badge: false,
    },
  ];
  const onTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const current = tabs.findIndex((item) => item.id === tab);
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? tabs.length - 1
          : event.key === "ArrowDown" || event.key === "ArrowRight"
            ? (current + 1) % tabs.length
            : event.key === "ArrowUp" || event.key === "ArrowLeft"
              ? (current + tabs.length - 1) % tabs.length
              : -1;
    if (next < 0) return;
    event.preventDefault();
    changeTab(tabs[next].id);
    document.getElementById(`control-tab-${tabs[next].id}`)?.focus();
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-testid="agent-control-dialog"
        onCloseAutoFocus={onCloseAutoFocus}
        onOpenAutoFocus={(event) => {
          // Focus the modal itself, not the first link: the mockup has no
          // browser focus ring on “All agents” when the dialog opens.
          event.preventDefault();
          (event.currentTarget as HTMLElement).focus();
        }}
        tabIndex={-1}
        hideClose
        overlayClassName="ac-scrim"
        className="agent-control-surface ac-modal"
      >
        <AgentControlFooterContext.Provider value={footerHost}>
          <header className="ac-head">
            <span className="bot-tile" aria-hidden="true">
              <Bot className="icon" />
            </span>
            <div className="ac-title-wrap">
              <DialogTitle className="ac-title">
                {t("agentControl.titleWithBoard", {
                  board: board?.title ?? t("agentControl.title"),
                })}
              </DialogTitle>
              <DialogDescription className="ac-description">
                {t(
                  role === "ADMIN"
                    ? "agentControl.description.admin"
                    : "agentControl.description.member",
                )}
              </DialogDescription>
            </div>
            <div className="ac-head-right">
              <span
                data-testid="agent-control-status"
                data-paused={boardPaused ? "true" : "false"}
                className={cn("ac-head-chip", boardPaused ? "warn" : "ok")}
              >
                <span
                  aria-hidden="true"
                  className={cn("status-dot", boardPaused ? "warn" : "ok")}
                />
                {t(
                  boardPaused
                    ? "agentControl.header.paused"
                    : "agentControl.header.running",
                )}
              </span>
              {role === "ADMIN" ? (
                pending === null ? (
                  <span className="ac-head-chip muted">
                    {t("agentControl.header.pendingUnknown")}
                  </span>
                ) : pending > 0 ? (
                  <span
                    data-testid="agent-control-header-pending"
                    className="ac-head-chip warn"
                  >
                    <Inbox className="icon" aria-hidden="true" />
                    {t("agentControl.header.waiting", { count: pending })}
                  </span>
                ) : (
                  <span className="ac-head-chip muted">
                    {t("agentControl.header.noPending")}
                  </span>
                )
              ) : (
                <span className="ac-head-chip muted">
                  {t("agentControl.header.readOnly")}
                </span>
              )}
              {onOpenAllAgents ? (
                <button
                  type="button"
                  onClick={onOpenAllAgents}
                  data-testid="agent-control-header-all-agents"
                  className="ac-head-link"
                >
                  {t("agentControl.header.allAgents")}
                  <ArrowUpRight className="icon" aria-hidden="true" />
                </button>
              ) : null}
              <DialogClose asChild>
                <button
                  type="button"
                  className="ac-close"
                  aria-label={t("common.close")}
                  title={t("agentControl.close")}
                >
                  <X className="icon" aria-hidden="true" />
                </button>
              </DialogClose>
            </div>
          </header>
          <div
            className={cn(
              "ac-body",
              tab !== "approvals" && "ac-body--overlay-footer",
            )}
          >
            <nav className="ac-rail" aria-label={t("agentControl.sections")}>
              <div className="ac-rail-label">
                {t("agentControl.shell.thisBoard")}
              </div>
              <div
                role="tablist"
                aria-label={t("agentControl.sections")}
                aria-orientation={verticalRail ? "vertical" : "horizontal"}
                className="ac-rail-tabs"
              >
                {tabs.map(({ id, label, icon: Icon, testId, count, badge }) => (
                  <button
                    key={id}
                    type="button"
                    data-testid={testId}
                    role="tab"
                    id={`control-tab-${id}`}
                    aria-controls="control-panel"
                    aria-selected={tab === id}
                    tabIndex={tab === id ? 0 : -1}
                    onKeyDown={onTabKeyDown}
                    onClick={() => changeTab(id)}
                    className="ac-rail-tab"
                  >
                    <Icon className="icon" aria-hidden="true" />
                    {label}
                    {count !== undefined && count > 0 ? (
                      <span
                        data-testid={`agent-${id}-count`}
                        className={badge ? "count-badge" : "rail-count"}
                      >
                        {badge ? count : count > 99 ? "99+" : count}
                      </span>
                    ) : null}
                  </button>
                ))}
              </div>
              {role === "ADMIN" ? (
                <>
                  <div className="ac-rail-divider" />
                  <div className="ac-rail-note">
                    <strong>{t("agentControl.shell.policy")} ↗</strong>
                    {t("agentControl.shell.policyHint")}
                  </div>
                  {onOpenPolicy ? (
                    <button
                      type="button"
                      onClick={onOpenPolicy}
                      data-testid="agent-open-policy"
                      className="ac-rail-link"
                    >
                      <Settings2 className="icon" aria-hidden="true" />
                      {t("agentControl.shell.openPolicy")}
                    </button>
                  ) : null}
                </>
              ) : (
                <>
                  <div className="ac-rail-divider" />
                  <div className="ac-rail-note">
                    <strong>{t("agentControl.header.readOnly")}</strong>
                    {t("agentControl.shell.memberNote")}
                  </div>
                </>
              )}
              {onOpenAllAgents ? (
                <div className="ac-rail-footer">
                  <b>{t("agentControl.shell.acrossBoards")}</b>
                  <p>{t("agentControl.shell.acrossHint")}</p>
                  <button
                    type="button"
                    onClick={onOpenAllAgents}
                    className="ac-rail-link"
                    data-testid="agent-control-all-agents"
                  >
                    <ArrowUpRight className="icon" aria-hidden="true" />
                    {t("agentControl.allAgents")}
                  </button>
                </div>
              ) : null}
            </nav>
            <div
              id="control-panel"
              role="tabpanel"
              aria-labelledby={`control-tab-${tab}`}
              className="ac-content"
            >
              {tab === "approvals" && role === "ADMIN" ? (
                <ApprovalsPanel queueState={approvals} />
              ) : tab === "pause" ? (
                <PausePanel role={role} onClose={() => onOpenChange(false)} />
              ) : (
                <RunsPanel role={role} />
              )}
            </div>
          </div>
          <div
            ref={setFooterHost}
            id="agent-control-footer"
            data-testid="agent-control-footer"
            className="ac-footer-host"
          />
        </AgentControlFooterContext.Provider>
      </DialogContent>
    </Dialog>
  );
}
