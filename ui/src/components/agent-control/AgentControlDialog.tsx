import { useState } from "react";
import {
  ClipboardCheck,
  CirclePause,
  FileClock,
  ShieldCheck,
  SlidersHorizontal,
} from "lucide-react";

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
import { PolicyPanel } from "./PolicyPanel";
import { RunsPanel } from "./RunsPanel";

export type AgentControlTab = "approvals" | "pause" | "runs" | "policy";

/**
 * «Agent control» dialog (TASK-166.14): the human side of TASK-166 on one
 * board. Approvals authorize an exact plan; pause stops new agent writes.
 * Both are board-ADMIN and browser-session-only; the token owner's own token
 * pause / stop-all controls stay in Account → API keys.
 *
 * The body is mounted inside `DialogContent`, so closing the dialog unmounts
 * every draft — the project's reset-by-remount rule (AGENT.md).
 */
export function AgentControlDialog({
  open,
  onOpenChange,
  initialTab = "approvals",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Members land on the read-only runs view; ADMINs start at approvals. */
  initialTab?: AgentControlTab;
}) {
  const { t } = useI18n();
  const { role } = useBoardAccess();
  const [tab, setTab] = useState<AgentControlTab>(initialTab);

  const tabs: {
    id: AgentControlTab;
    labelKey:
      | "agentControl.tab.approvals"
      | "agentControl.tab.pause"
      | "agentControl.tab.runs"
      | "agentControl.tab.policy";
    icon: typeof ClipboardCheck;
    testId: string;
    adminOnly?: boolean;
  }[] = [
    {
      id: "approvals",
      labelKey: "agentControl.tab.approvals",
      icon: ClipboardCheck,
      testId: "agent-approvals-tab",
    },
    {
      id: "pause",
      labelKey: "agentControl.tab.pause",
      icon: CirclePause,
      testId: "agent-pause-tab",
    },
    {
      id: "runs",
      labelKey: "agentControl.tab.runs",
      icon: FileClock,
      testId: "agent-runs-tab",
    },
    {
      id: "policy",
      labelKey: "agentControl.tab.policy",
      icon: SlidersHorizontal,
      testId: "agent-policy-tab",
      adminOnly: true,
    },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-testid="agent-control-dialog"
        className="flex h-[min(46rem,calc(100dvh-2rem))] w-[calc(100vw-1.5rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-5xl"
      >
        <DialogHeader className="shrink-0 space-y-1 border-b bg-gradient-to-br from-primary/10 via-secondary/5 to-transparent px-4 py-3 pr-12">
          <DialogTitle className="flex items-center gap-2 text-base">
            <ShieldCheck className="h-4 w-4 text-primary" aria-hidden />
            {t("agentControl.title")}
          </DialogTitle>
          <DialogDescription className="text-xs">
            {t("agentControl.description")}
          </DialogDescription>
        </DialogHeader>

        <div className="flex shrink-0 items-center gap-2 border-b px-4 py-2">
          <div
            role="group"
            aria-label={t("agentControl.title")}
            className="inline-flex items-center gap-1 rounded-lg border border-border/60 bg-card/80 p-1"
          >
            {tabs
              .filter((entry) => !entry.adminOnly || role === "ADMIN")
              .map(({ id, labelKey, icon: Icon, testId }) => (
                <button
                  key={id}
                  type="button"
                  data-testid={testId}
                  aria-pressed={tab === id}
                  onClick={() => setTab(id)}
                  className={cn(
                    "flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                    tab === id
                      ? "bg-primary/15 text-primary"
                      : "text-muted-foreground hover:bg-hover hover:text-foreground",
                  )}
                >
                  <Icon className="h-3.5 w-3.5" aria-hidden />
                  {t(labelKey)}
                </button>
              ))}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-hidden">
          {tab === "approvals" ? (
            <ApprovalsPanel role={role} />
          ) : tab === "pause" ? (
            <PausePanel role={role} />
          ) : tab === "runs" ? (
            <RunsPanel role={role} />
          ) : (
            <PolicyPanel role={role} />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
