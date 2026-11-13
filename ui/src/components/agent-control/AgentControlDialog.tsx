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
import { ApprovalsPanel } from "./ApprovalsPanel";
import { PausePanel } from "./PausePanel";
import { RunsPanel } from "./RunsPanel";
import "./agent-control.css";

export type AgentControlTab = "approvals" | "pause" | "runs";

export function AgentControlDialog({
  open,
  onOpenChange,
  initialTab = "approvals",
  onOpenAllAgents,
  onOpenPolicy,
  onCloseAutoFocus,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialTab?: AgentControlTab;
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
  // `null` means unknown: loading or failed. A failed count must never render
  // as a truthful zero ("No pending") or disappear a real queue behind a
  // misleading badge.
  const [pending, setPending] = useState<number | null>(null);
  const [liveCount, setLiveCount] = useState<number | null>(null);
  const [runsCount, setRunsCount] = useState<number | null>(null);
  const [countRevision, setCountRevision] = useState(0);
  const [tab, setTab] = useState<AgentControlTab>(
    role !== "ADMIN" && initialTab === "approvals" ? "pause" : initialTab,
  );

  useEffect(() => {
    const unsubscribers = [
      live.agentControl.subscribeApproval(() =>
        setCountRevision((value) => value + 1),
      ),
      live.agentControl.subscribeAgent(() =>
        setCountRevision((value) => value + 1),
      ),
      live.agentControl.subscribeRun(() =>
        setCountRevision((value) => value + 1),
      ),
    ];
    return () => {
      for (const unsubscribe of unsubscribers) unsubscribe();
    };
  }, [live]);

  useEffect(() => {
    if (boardId === undefined || !isApiEnabled()) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reset counters when the route leaves a board
      setPending(null);
      setLiveCount(null);
      setRunsCount(null);
      return;
    }
    let alive = true;
    if (role === "ADMIN") {
      void api
        .listApprovals(boardId, { status: "pending", limit: 100 })
        .then((rows) => {
          if (alive) setPending(rows.length);
        })
        .catch(() => {
          if (alive) setPending(null);
        });
    } else {
      setPending(null);
    }
    void api
      .listAgentSessions(boardId, true)
      .then((rows) => {
        if (alive) setLiveCount(rows.length);
      })
      .catch(() => {
        if (alive) setLiveCount(null);
      });
    void api
      .listRuns(boardId, { limit: 100 })
      .then((rows) => {
        if (alive) setRunsCount(rows.length);
      })
      .catch(() => {
        if (alive) setRunsCount(null);
      });
    return () => {
      alive = false;
    };
  }, [boardId, countRevision, role]);

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
    setTab(tabs[next].id);
    document.getElementById(`control-tab-${tabs[next].id}`)?.focus();
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-testid="agent-control-dialog"
        onCloseAutoFocus={onCloseAutoFocus}
        hideClose
        className="agent-control-surface ac-modal"
      >
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
                  {pending > 99
                    ? "99+"
                    : t("agentControl.header.waiting", { count: pending })}
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
        <div className="ac-body">
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
                  onClick={() => setTab(id)}
                  className="ac-rail-tab"
                >
                  <Icon className="icon" aria-hidden="true" />
                  {label}
                  {count !== undefined && count > 0 ? (
                    <span
                      data-testid={`agent-${id}-count`}
                      className={badge ? "count-badge" : "rail-count"}
                    >
                      {count > 99 ? "99+" : count}
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
              <ApprovalsPanel role={role} />
            ) : tab === "pause" ? (
              <PausePanel role={role} />
            ) : (
              <RunsPanel role={role} />
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
