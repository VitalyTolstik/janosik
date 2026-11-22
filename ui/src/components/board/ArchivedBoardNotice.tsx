import { Archive, ArchiveRestore } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import { useBoardAccess, useBoardActions } from "@/store/BoardContext";

/**
 * Archived boards are read-only until they are restored. An explicit notice
 * explains why the board and its cards cannot be edited instead of leaving a
 * deep link as a silent dead end (QA-03 UX review). It renders both on the
 * board surface and inside the card dialog; an ADMIN gets the restore action,
 * everyone else is told to ask an admin.
 */
export function ArchivedBoardNotice({
  boardId,
  className,
}: {
  boardId: string;
  className?: string;
}) {
  const { t } = useI18n();
  const { unarchiveBoard } = useBoardActions();
  const { role } = useBoardAccess();

  return (
    <div
      role="status"
      data-testid="archived-board-notice"
      className={cn(
        "flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-foreground",
        className,
      )}
    >
      <Archive className="h-4 w-4 shrink-0 text-amber-600" aria-hidden="true" />
      <p className="min-w-0 flex-1">{t("board.archivedReadOnly")}</p>
      {role === "ADMIN" ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-11 shrink-0 lg:h-8"
          data-testid="archived-board-restore"
          onClick={() => unarchiveBoard(boardId)}
        >
          <ArchiveRestore className="h-4 w-4" aria-hidden="true" />
          {t("board.switcher.restore")}
        </Button>
      ) : (
        <span className="text-xs text-muted-foreground">
          {t("board.archivedAskAdmin")}
        </span>
      )}
    </div>
  );
}
