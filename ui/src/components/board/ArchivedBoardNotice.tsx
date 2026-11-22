import { Archive, ArchiveRestore } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import { useBoardActions } from "@/store/BoardContext";

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
  onRestored,
  onOpenArchive,
}: {
  boardId: string;
  className?: string;
  /** Where focus should land after the restore button unmounts. */
  onRestored?: () => void;
  /** Real entry to the viewed board's archive while the header is inert. */
  onOpenArchive?: () => void;
}) {
  const { t } = useI18n();
  const { unarchiveBoard, roleOf } = useBoardActions();
  // The notice may describe a board that is not the active route board (the
  // archive dialog pins `boardId`), so ask for that board's role instead of
  // the route's. Otherwise an active ADMIN could see Restore on a board they
  // only view, or a pinned ADMIN could lose it.
  const role = roleOf(boardId);

  const restore = () => {
    unarchiveBoard(boardId);
    // The notice (and this button) unmounts with the archived state. Hand
    // focus back to a stable surface so it does not fall to <body>.
    window.requestAnimationFrame(() => {
      if (onRestored) {
        onRestored();
        return;
      }
      document
        .querySelector<HTMLElement>('[data-testid="board-title"]')
        ?.focus();
    });
  };

  return (
    <div
      role="status"
      data-testid="archived-board-notice"
      className={cn(
        "flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-foreground max-sm:flex-col max-sm:items-stretch",
        className,
      )}
    >
      <div className="flex min-w-0 flex-1 items-start gap-2">
        <Archive
          className="mt-0.5 h-4 w-4 shrink-0 text-amber-600"
          aria-hidden="true"
        />
        <p className="min-w-0 flex-1">{t("board.archivedReadOnly")}</p>
      </div>
      {onOpenArchive ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-11 shrink-0 lg:h-8"
          data-testid="archived-open-archive"
          onClick={onOpenArchive}
        >
          {t("board.archivedOpenArchive")}
        </Button>
      ) : null}
      {role === "ADMIN" ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-11 shrink-0 lg:h-8"
          data-testid="archived-board-restore"
          onClick={restore}
        >
          <ArchiveRestore className="h-4 w-4" aria-hidden="true" />
          {t("board.switcher.restore")}
        </Button>
      ) : (
        <div className="flex min-w-0 flex-col gap-0.5 text-xs text-muted-foreground">
          <span>{t("board.archivedAskAdmin")}</span>
          <span data-testid="archived-board-switcher-hint">
            {t("board.archivedSwitcherHint")}
          </span>
        </div>
      )}
    </div>
  );
}
