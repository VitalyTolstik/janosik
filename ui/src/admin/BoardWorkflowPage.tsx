import { useCallback, useEffect, useState } from "react";
import { Link, useBlocker, useParams } from "react-router-dom";
import { ArrowLeft, Workflow } from "lucide-react";
import type { BoardAggregate, BoardWorkflow } from "@janosik/shared";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog";
import { useI18n } from "@/i18n";
import { WorkflowEditor } from "@/components/board/WorkflowEditor";
import { useToast } from "@/components/Toast";
import { ApiError } from "@/api/client";
import { routes } from "@/routes";
import { adminApi } from "./admin-client";
import { useAdminT } from "./admin-i18n";
import { ErrorState, PageHeader, Panel } from "./ui";
import { BoardEditorSkeleton } from "./skeletons";

/**
 * Master-panel workflow editor. It reuses the board's own `WorkflowEditor`
 * but sends `SET_BOARD_WORKFLOW` through `POST /admin/boards/:id/commands`,
 * i.e. as the board owner: the normal command log, versions and realtime
 * frames stay intact and `AdminAuditLog` records the master's intervention.
 */
export function BoardWorkflowPage() {
  const { boardId = "" } = useParams();
  return <BoardWorkflowEditorPage key={boardId} boardId={boardId} />;
}

/**
 * A language handoff may be consumed without a router navigation while a
 * workflow draft is dirty. Ignore that one parameter when comparing search
 * strings; every other query or hash change still belongs to the blocker.
 */
function searchWithoutLocale(search: string): string {
  const params = new URLSearchParams(search);
  params.delete("lng");
  return params.toString();
}

function workflowLocationChanged(
  current: { pathname: string; search: string; hash: string },
  next: { pathname: string; search: string; hash: string },
): boolean {
  return (
    current.pathname !== next.pathname ||
    current.hash !== next.hash ||
    searchWithoutLocale(current.search) !== searchWithoutLocale(next.search)
  );
}

function BoardWorkflowEditorPage({ boardId }: { boardId: string }) {
  const { t: appT } = useI18n();
  const t = useAdminT();
  const toast = useToast();
  const [board, setBoard] = useState<BoardAggregate | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      dirty && workflowLocationChanged(currentLocation, nextLocation),
  );

  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  const load = useCallback(() => {
    setState("loading");
    void adminApi
      .getBoardContent(boardId)
      .then((next) => {
        setBoard(next);
        setState("ready");
      })
      .catch(() => setState("error"));
  }, [boardId]);

  useEffect(() => {
    load();
  }, [load]);

  const save = async (workflow: BoardWorkflow | undefined) => {
    setSaving(true);
    try {
      await adminApi.sendBoardCommand(boardId, {
        action: {
          type: "SET_BOARD_WORKFLOW",
          boardId,
          at: Date.now(),
          ...(workflow !== undefined ? { workflow } : {}),
        } as never,
      });
      toast.success(t("admin.workflow.saved"));
      const next = await adminApi.getBoardContent(boardId);
      setBoard(next);
      return true;
    } catch (error) {
      toast.error(
        error instanceof ApiError
          ? error.messageText
          : t("admin.common.actionFailed"),
      );
      return false;
    } finally {
      setSaving(false);
    }
  };

  if (state === "loading") return <BoardEditorSkeleton />;
  if (state === "error" || board === null) {
    return <ErrorState onRetry={load} />;
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto p-4">
      <div className="flex items-center gap-2">
        <Button
          size="icon"
          variant="ghost"
          className="h-7 w-7 max-sm:h-11 max-sm:w-11"
          asChild
        >
          <Link
            to={routes.adminBoardDetail(board.id)}
            aria-label={t("admin.common.back")}
          >
            <ArrowLeft className="h-4 w-4" aria-hidden />
          </Link>
        </Button>
        <PageHeader
          title={board.title}
          subtitle={t("admin.workflow.subtitle")}
          actions={
            <Button size="sm" variant="outline" asChild>
              <Link to={routes.adminBoardContent(board.id)}>
                {t("admin.boards.action.content")}
              </Link>
            </Button>
          }
        />
      </div>

      {!board.workflow?.enabled ? (
        <Panel className="flex items-start gap-2 p-3 text-xs text-muted-foreground">
          <Workflow className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          {t("admin.workflow.disabledHint")}
        </Panel>
      ) : null}

      <Panel className="overflow-hidden p-0">
        <WorkflowEditor
          key={`${board.id}-${board.updatedAt}`}
          columns={board.columns}
          cards={board.cards}
          workflow={board.workflow}
          workflowInvalid={board.workflowInvalid}
          canEdit
          masterMode
          role="ADMIN"
          saving={saving}
          testIdPrefix="admin-workflow"
          onSave={save}
          onCancel={() => {
            setDirty(false);
            load();
          }}
          onDirtyChange={setDirty}
        />
      </Panel>

      <Dialog
        open={blocker.state === "blocked"}
        onOpenChange={(open) => {
          if (!open && blocker.state === "blocked") blocker.reset();
        }}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogTitle>{appT("workflow.discardTitle")}</DialogTitle>
          <DialogDescription>
            {appT("workflow.discardDescription")}
          </DialogDescription>
          <DialogFooter>
            <Button variant="outline" onClick={blocker.reset}>
              {appT("common.cancel")}
            </Button>
            <Button variant="destructive" onClick={blocker.proceed}>
              {appT("workflow.discard")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
