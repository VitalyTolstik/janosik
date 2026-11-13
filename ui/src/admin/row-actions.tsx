import { useState, type ReactNode } from "react";
import { MoreHorizontal } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/components/Toast";
import { ApiError } from "@/api/client";
import { useAdminT } from "./admin-i18n";
import { ConfirmDialog } from "./ui";

/**
 * One row-action menu shared by the entity lists (TASK-48) and the detail
 * tables (TASK-176.7): destructive entries confirm first, API failures toast
 * and the owning list refreshes after a successful write.
 */
export interface EntityAction {
  label: string;
  destructive?: boolean;
  /** Render the menu item in the warning colour (e.g. promote). */
  warning?: boolean;
  /** Pure navigation actions do not toast. */
  noToast?: boolean;
  /** Optional confirmation dialog copy. */
  confirmTitle?: string;
  confirmBody?: string;
  run: () => Promise<unknown>;
  /**
   * A custom dialog host (TASK-51: the email-change form) instead of the
   * confirm flow. When present the menu item mounts this node; the action
   * closes itself via `close` and refreshes the list via `reload`. `run`
   * stays unused for such actions.
   */
  renderDialog?: (options: {
    close: () => void;
    reload: () => void;
  }) => ReactNode;
}

export function RowActions({
  testId,
  actions,
  reload,
}: {
  testId: string;
  actions: Array<EntityAction>;
  reload: () => void;
}) {
  const t = useAdminT();
  const [pending, setPending] = useState<EntityAction | null>(null);
  const [dialog, setDialog] = useState<EntityAction | null>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const execute = async (action: EntityAction) => {
    setBusy(true);
    try {
      await action.run();
      if (!action.noToast) {
        toast.success(action.label);
        reload();
      }
    } catch (error) {
      if (error instanceof ApiError && error.status === 403) {
        toast.error(t("admin.common.forbidden"));
      } else if (error instanceof ApiError && error.status === 0) {
        toast.error(t("admin.common.offline"));
      } else {
        toast.error(t("admin.common.actionFailed"));
      }
    } finally {
      setBusy(false);
      setPending(null);
    }
  };

  if (actions.length === 0) {
    return null;
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={t("admin.common.actions")}
            data-testid={testId}
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-hover hover:text-foreground"
          >
            <MoreHorizontal className="h-4 w-4" aria-hidden />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-44">
          {actions.map((action) => (
            <DropdownMenuItem
              key={action.label}
              className={
                action.destructive
                  ? "text-danger focus:text-danger"
                  : action.warning
                    ? "text-warning focus:text-warning"
                    : undefined
              }
              onSelect={() => {
                if (action.renderDialog) {
                  setDialog(action);
                } else if (action.confirmTitle) {
                  setPending(action);
                } else {
                  void execute(action);
                }
              }}
            >
              {action.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      {pending ? (
        <ConfirmDialog
          open
          title={pending.confirmTitle ?? pending.label}
          body={pending.confirmBody ?? ""}
          confirmLabel={pending.label}
          destructive={pending.destructive ?? true}
          busy={busy}
          onConfirm={() => void execute(pending)}
          onClose={() => (busy ? undefined : setPending(null))}
        />
      ) : null}
      {dialog?.renderDialog
        ? dialog.renderDialog({ close: () => setDialog(null), reload })
        : null}
    </>
  );
}
