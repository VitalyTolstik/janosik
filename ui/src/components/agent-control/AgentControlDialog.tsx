import { useState, type KeyboardEvent } from "react";
import { Activity, Bot, History, Inbox, Settings2 } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import { useBoardAccess } from "@/store/BoardContext";
import { ApprovalsPanel } from "./ApprovalsPanel";
import { PausePanel } from "./PausePanel";
import { RunsPanel } from "./RunsPanel";

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
  const { role } = useBoardAccess();
  const [tab, setTab] = useState<AgentControlTab>(
    role !== "ADMIN" && initialTab === "approvals" ? "pause" : initialTab,
  );
  const tabs = [
    ...(role === "ADMIN"
      ? [
          {
            id: "approvals" as const,
            label: t("agentControl.shell.inbox"),
            icon: Inbox,
            testId: "agent-approvals-tab",
          },
        ]
      : []),
    {
      id: "pause" as const,
      label: t("agentControl.shell.live"),
      icon: Activity,
      testId: "agent-pause-tab",
    },
    {
      id: "runs" as const,
      label: t("agentControl.shell.runs"),
      icon: History,
      testId: "agent-runs-tab",
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
        className="flex h-[min(48rem,calc(100dvh-2rem))] w-[calc(100vw-1.5rem)] flex-col gap-0 overflow-hidden p-0 font-agent-surface sm:max-w-6xl max-md:h-[100dvh] max-md:max-h-none max-md:w-full max-md:rounded-none"
      >
        <DialogHeader className="shrink-0 border-b bg-gradient-to-br from-primary/10 via-secondary/5 to-transparent px-5 py-4 pr-12">
          <DialogTitle className="flex items-center gap-3 font-display text-base font-bold tracking-[-0.025em]">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-primary/30 bg-primary/10">
              <Bot className="h-4 w-4 text-primary" aria-hidden />
            </span>
            {t("agentControl.title")}
          </DialogTitle>
          <DialogDescription className="pl-12 text-xs">
            {t("agentControl.description")}
          </DialogDescription>
        </DialogHeader>
        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
          <aside className="flex shrink-0 flex-col border-b border-border p-3 md:w-52 md:border-r md:border-b-0">
            <p className="hidden px-2 pb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground md:block">
              {t("agentControl.shell.thisBoard")}
            </p>
            <div
              role="tablist"
              aria-label={t("agentControl.title")}
              className="flex gap-1 md:flex-col"
            >
              {tabs.map(({ id, label, icon: Icon, testId }) => (
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
                  className={cn(
                    "flex min-h-11 flex-1 items-center gap-2 rounded-md border border-transparent px-2 text-left font-agent-surface text-[12px] font-[550] leading-[1.45] text-muted-foreground hover:bg-hover md:min-h-[34px] md:flex-none",
                    tab === id &&
                      "border-border bg-surface text-foreground shadow-[inset_2px_0_0_var(--primary)]",
                  )}
                >
                  <Icon className="h-4 w-4 shrink-0" aria-hidden />
                  {label}
                </button>
              ))}
            </div>
            {role === "ADMIN" && onOpenPolicy ? (
              <div className="mt-4 hidden border-t border-border px-2 pt-3 md:block">
                <p className="text-xs font-semibold">
                  {t("agentControl.shell.policy")}
                </p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  {t("agentControl.shell.policyHint")}
                </p>
                <button
                  type="button"
                  onClick={onOpenPolicy}
                  data-testid="agent-open-policy"
                  className="mt-2 inline-flex min-h-9 items-center gap-1 text-xs text-primary hover:underline"
                >
                  <Settings2 className="h-3 w-3" aria-hidden />
                  {t("agentControl.shell.openPolicy")}
                </button>
              </div>
            ) : null}
            {onOpenAllAgents ? (
              <div className="mt-auto hidden border-t border-border px-2 pt-3 md:block">
                <p className="text-xs font-semibold">
                  {t("agentControl.shell.acrossBoards")}
                </p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  {t("agentControl.shell.acrossHint")}
                </p>
                <button
                  type="button"
                  onClick={onOpenAllAgents}
                  className="mt-2 min-h-9 text-xs text-primary hover:underline"
                  data-testid="agent-control-all-agents"
                >
                  {t("agentControl.allAgents")} ↗
                </button>
              </div>
            ) : null}
            <div className="flex gap-4 md:hidden">
              {onOpenAllAgents ? (
                <button
                  type="button"
                  onClick={onOpenAllAgents}
                  className="min-h-11 text-xs text-primary"
                  data-testid="agent-control-all-agents-mobile"
                >
                  {t("agentControl.allAgents")} ↗
                </button>
              ) : null}
              {role === "ADMIN" && onOpenPolicy ? (
                <button
                  type="button"
                  onClick={onOpenPolicy}
                  className="min-h-11 text-xs text-primary"
                  data-testid="agent-open-policy-mobile"
                >
                  {t("agentControl.shell.openPolicy")}
                </button>
              ) : null}
            </div>
          </aside>
          <div
            id="control-panel"
            role="tabpanel"
            aria-labelledby={`control-tab-${tab}`}
            className="min-h-0 min-w-0 flex-1 overflow-hidden"
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
