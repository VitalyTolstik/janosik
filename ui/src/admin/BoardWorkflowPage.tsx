import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Workflow } from "lucide-react";
import type { BoardAggregate, BoardWorkflow } from "@janosik/shared";
import { Button } from "@/components/ui/button";
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
  const t = useAdminT();
  const toast = useToast();
  const [board, setBoard] = useState<BoardAggregate | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [saving, setSaving] = useState(false);

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
    } catch (error) {
      toast.error(
        error instanceof ApiError
          ? error.messageText
          : t("admin.common.actionFailed"),
      );
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
        <Button size="icon" variant="ghost" className="h-7 w-7" asChild>
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
          onSave={(workflow) => void save(workflow)}
          onCancel={() => load()}
        />
      </Panel>
    </div>
  );
}
