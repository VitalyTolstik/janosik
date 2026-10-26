import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Check, Copy, ExternalLink, PlayCircle, Trash2 } from "lucide-react";
import type { AdminDemoStatusDto } from "@janosik/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NumberStepper } from "@/components/ui/number-stepper";
import { useToast } from "@/components/Toast";
import { ApiError } from "@/api/client";
import { cn } from "@/lib/utils";
import { pollWhileFocused } from "@/lib/visible-poll";
import { appShareUrl } from "@/utils/app-path";
import { adminApi } from "./admin-client";
import { useAdminT } from "./admin-i18n";
import { useAdminAuth } from "./AdminAuthContext";
import {
  Badge,
  ConfirmDialog,
  ErrorState,
  LoadingState,
  PageHeader,
  Panel,
} from "./ui";

/**
 * Demo runner (TASK-57) — start a swarm of AI agents on a throwaway board,
 * watch them work, then clean up. The backend provisions the demo users,
 * columns, labels and cards behind `POST /admin/demo/start` and records every
 * id it created; `stop` deletes exactly those rows (board, cards, demo users)
 * — nothing is guessed by name. While a run is live the panel polls its
 * status, so the counters move on their own.
 *
 * Since TASK-58 the observation path is a **live share link**: the runner
 * mints a public read-only share for the run's board and hands its token
 * back here, so "Open live view" opens the swarm with no login at all.
 */
export function DemoPage() {
  const t = useAdminT();
  const toast = useToast();
  const { admin } = useAdminAuth();
  const isOwner = admin?.role === "OWNER";

  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");
  const [demo, setDemo] = useState<AdminDemoStatusDto | null>(null);
  const [agents, setAgents] = useState("20");
  const [cards, setCards] = useState("20");
  const [boardId, setBoardId] = useState("");
  const [selectedBoardId, setSelectedBoardId] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  // "Copy share link" feedback matches the app's inline pattern: the icon
  // flips to a check for a moment instead of raising a toast.
  const [copiedLink, setCopiedLink] = useState(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(true);

  const load = useCallback(() => {
    adminApi
      .getDemo()
      .then((value) => {
        setDemo(value);
        setPhase("ready");
      })
      .catch(() => setPhase("error"));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Poll while the page is open so the counters advance on their own. The
  // `mounted` flag is raised here (not in the load effect): under React
  // StrictMode the load effect's cleanup would set it false and nothing would
  // ever turn it back on, freezing the counter.
  useEffect(() => {
    mounted.current = true;
    const tick = () => {
      adminApi
        .getDemo()
        .then((value) => {
          if (mounted.current) setDemo(value);
        })
        .catch(() => {
          /* keep the last snapshot */
        });
    };
    // Visible-and-focused tabs only (see `pollWhileFocused`).
    const stopPolling = pollWhileFocused(tick, 2000);
    return () => {
      mounted.current = false;
      if (copyTimer.current) clearTimeout(copyTimer.current);
      stopPolling();
    };
  }, []);

  const start = useCallback(async () => {
    const users = Number(agents);
    const taskCount = Number(cards);
    if (!Number.isInteger(users) || users < 1) return;
    if (!Number.isInteger(taskCount) || taskCount < 1) return;
    setBusy(true);
    try {
      const target = selectedBoardId.trim();
      const value = await adminApi.startDemo({
        users,
        cards: taskCount,
        run: true,
        ...(target === "" ? {} : { boardId: target }),
      });
      setDemo(value);
      toast.success(t("admin.demo.started"));
    } catch (cause) {
      const message =
        cause instanceof ApiError && cause.messageText
          ? cause.messageText
          : t("admin.common.error");
      toast.error(message);
    } finally {
      setBusy(false);
    }
  }, [agents, cards, selectedBoardId, t, toast]);

  const stop = useCallback(async () => {
    setBusy(true);
    try {
      const value = await adminApi.stopDemo();
      setDemo(value);
      toast.success(t("admin.demo.stopped"));
      setConfirming(false);
    } catch (cause) {
      const message =
        cause instanceof ApiError && cause.messageText
          ? cause.messageText
          : t("admin.common.error");
      toast.error(message);
    } finally {
      setBusy(false);
    }
  }, [t, toast]);

  const retry = useCallback(() => {
    setPhase("loading");
    load();
  }, [load]);

  if (phase === "loading") return <LoadingState />;
  if (phase === "error") return <ErrorState onRetry={retry} />;

  const running = demo?.running ?? false;
  const cleanupPending = demo?.cleanupPending ?? false;
  // The run's own board wins: a leftover "next run" selection must never override
  // what was actually started (that made "Open board" point at a stale board).
  const shownBoard = demo?.boardId || selectedBoardId.trim();

  return (
    <div className="w-full max-w-3xl space-y-4 p-4">
      <PageHeader
        title={t("admin.demo.title")}
        subtitle={t("admin.demo.subtitle")}
        actions={
          <span
            data-testid="admin-demo-status"
            className={cn(
              "inline-flex items-center gap-1.5 text-xs font-medium",
              running ? "text-success" : "text-muted-foreground",
            )}
          >
            <span
              className={cn(
                "h-2 w-2 rounded-full",
                running ? "animate-pulse bg-success" : "bg-muted-foreground/40",
              )}
              aria-hidden
            />
            {running ? t("admin.demo.running") : t("admin.demo.idle")}
          </span>
        }
      />

      {!isOwner ? (
        <Panel className="p-4">
          <p className="text-xs text-muted-foreground">
            {t("admin.demo.readonly")}
          </p>
        </Panel>
      ) : null}

      <Panel className="grid grid-cols-3 gap-4 p-4">
        <div className="space-y-1">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
            {t("admin.demo.agents")}
          </p>
          <p
            data-testid="admin-demo-agents"
            className="text-2xl font-semibold tabular-nums text-foreground"
          >
            {demo?.users ?? 0}
          </p>
        </div>
        <div className="space-y-1">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
            {t("admin.demo.cards")}
          </p>
          <p
            data-testid="admin-demo-cards"
            className="text-2xl font-semibold tabular-nums text-foreground"
          >
            {demo?.cards ?? 0}
          </p>
        </div>
        <div className="space-y-1">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
            {t("admin.demo.done")}
          </p>
          <p
            data-testid="admin-demo-done"
            className="text-2xl font-semibold tabular-nums text-foreground"
          >
            {demo?.cardsDone ?? 0}
          </p>
        </div>
      </Panel>

      <Panel className="flex items-center justify-between gap-3 p-4">
        <span className="text-xs text-muted-foreground">
          {t("admin.demo.board")}
        </span>
        {shownBoard === "" ? (
          <span className="text-[11px] text-muted-foreground">
            {t("admin.demo.boardPlaceholder")}
          </span>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="neutral">
              <code
                data-testid="admin-demo-board"
                className="font-mono text-[11px]"
              >
                {shownBoard}
              </code>
            </Badge>
            {demo?.shareToken ? (
              <Link
                to={`/s/${demo.shareToken}`}
                target="_blank"
                rel="noreferrer"
                data-testid="admin-demo-live-view"
                className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-border bg-background/50 px-2.5 text-xs text-muted-foreground transition-colors hover:bg-hover hover:text-foreground"
              >
                <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                {t("admin.demo.liveView")}
              </Link>
            ) : null}
            {demo?.shareToken ? (
              <Button
                size="sm"
                variant="ghost"
                className="h-7 gap-1.5 px-2 text-xs"
                data-testid="admin-demo-copy-link"
                onClick={() => {
                  const url = appShareUrl(`/s/${demo.shareToken}`);
                  void navigator.clipboard
                    ?.writeText(url)
                    .then(() => {
                      setCopiedLink(true);
                      if (copyTimer.current) clearTimeout(copyTimer.current);
                      copyTimer.current = setTimeout(
                        () => setCopiedLink(false),
                        1600,
                      );
                    })
                    .catch(() => undefined);
                }}
              >
                {copiedLink ? (
                  <Check className="h-3.5 w-3.5 text-success" aria-hidden />
                ) : (
                  <Copy className="h-3.5 w-3.5" aria-hidden />
                )}
                {t("admin.demo.copyLink")}
              </Button>
            ) : null}
          </div>
        )}
      </Panel>

      {isOwner ? (
        <Panel className="space-y-4 p-4">
          <div className="space-y-1">
            <label
              htmlFor="admin-demo-board-input"
              className="text-xs font-medium text-foreground"
            >
              {t("admin.demo.boardInput")}
            </label>
            <div className="flex items-center gap-2">
              <Input
                id="admin-demo-board-input"
                data-testid="admin-demo-board-input"
                value={boardId}
                maxLength={64}
                disabled={running || busy}
                autoComplete="off"
                placeholder={t("admin.demo.boardPlaceholder")}
                onChange={(event) => setBoardId(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    setSelectedBoardId(boardId.trim());
                  }
                }}
              />
              <Button
                size="sm"
                variant="outline"
                data-testid="admin-demo-board-save"
                disabled={running || busy}
                onClick={() => setSelectedBoardId(boardId.trim())}
              >
                {t("admin.common.save")}
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              {t("admin.demo.boardHint")}
            </p>
          </div>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="flex flex-wrap items-end gap-4">
              <div className="space-y-1">
                <label
                  htmlFor="admin-demo-agents-input"
                  className="text-xs font-medium text-foreground"
                >
                  {t("admin.demo.agents")}
                </label>
                <NumberStepper
                  id="admin-demo-agents-input"
                  testId="admin-demo-agents-input"
                  min={1}
                  max={100}
                  value={agents}
                  disabled={running || busy}
                  onChange={setAgents}
                  ariaLabel={t("admin.demo.agents")}
                  increaseLabel={t("admin.common.increase")}
                  decreaseLabel={t("admin.common.decrease")}
                />
              </div>
              <div className="space-y-1">
                <label
                  htmlFor="admin-demo-cards-input"
                  className="text-xs font-medium text-foreground"
                >
                  {t("admin.demo.tasks")}
                </label>
                <NumberStepper
                  id="admin-demo-cards-input"
                  testId="admin-demo-cards-input"
                  min={1}
                  max={1000}
                  value={cards}
                  disabled={running || busy}
                  onChange={setCards}
                  ariaLabel={t("admin.demo.tasks")}
                  increaseLabel={t("admin.common.increase")}
                  decreaseLabel={t("admin.common.decrease")}
                />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                data-testid="admin-demo-start"
                disabled={running || busy || agents === "" || cards === ""}
                onClick={() => void start()}
              >
                <PlayCircle className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                {t("admin.demo.start")}
              </Button>
              <Button
                size="sm"
                variant="destructive"
                data-testid="admin-demo-stop"
                disabled={!cleanupPending || busy}
                onClick={() => setConfirming(true)}
              >
                <Trash2 className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                {t("admin.demo.stop")}
              </Button>
            </div>
          </div>
        </Panel>
      ) : null}

      <ConfirmDialog
        open={confirming}
        title={t("admin.demo.stop")}
        body={t("admin.demo.confirmStop")}
        confirmLabel={t("admin.demo.stop")}
        busy={busy}
        onConfirm={() => void stop()}
        onClose={() => setConfirming(false)}
      />
    </div>
  );
}
