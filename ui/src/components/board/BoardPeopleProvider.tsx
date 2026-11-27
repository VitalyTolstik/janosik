import { useRef, useState, type PropsWithChildren } from "react";
import { useMatch } from "react-router-dom";

import { isApiEnabled } from "@/api/client";
import { BoardMembersDialog } from "@/components/board/BoardMembersDialog";
import { ShareDialog } from "@/components/board/ShareDialog";
import {
  BoardPeopleContext,
  type PeopleDialog,
} from "@/hooks/use-board-people";
import { usePublicSharesEnabled } from "@/hooks/use-public-shares-enabled";
import { routes } from "@/routes";
import { useBoard, useBoardAccess } from "@/store/BoardContext";

/** The header, palette and inspector share one Members and Share dialog pair. */
export function BoardPeopleProvider({ children }: PropsWithChildren) {
  const isBoardRoute = useMatch(routes.boardPattern) !== null;
  const { board } = useBoard();
  const { role } = useBoardAccess();
  const publicSharesEnabled = usePublicSharesEnabled();
  const boardId = isBoardRoute && isApiEnabled() ? board?.id : undefined;
  const archived = board?.archivedAt !== undefined;
  // The current Members dialog lets admins manage the roster. Keep that
  // action off archived boards until they're restored.
  const showMembers = boardId !== undefined && (!archived || role !== "ADMIN");
  const showShare =
    boardId !== undefined &&
    !archived &&
    role === "ADMIN" &&
    publicSharesEnabled === true;

  const menuRef = useRef<HTMLButtonElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const [dialog, setDialog] = useState<{
    kind: PeopleDialog;
    boardId: string;
    archived: boolean;
    role: typeof role;
  } | null>(null);

  if (
    dialog &&
    (dialog.boardId !== boardId ||
      dialog.archived !== archived ||
      dialog.role !== role ||
      (dialog.kind === "members" ? !showMembers : !showShare))
  ) {
    setDialog(null);
  }

  function openDialog(kind: PeopleDialog, opener?: HTMLElement) {
    if (
      boardId === undefined ||
      (kind === "members" ? !showMembers : !showShare)
    )
      return;
    returnFocusRef.current = opener ?? menuRef.current;
    setDialog({ kind, boardId, archived, role });
  }

  return (
    <BoardPeopleContext.Provider
      value={{ archived, showMembers, showShare, menuRef, openDialog }}
    >
      {children}
      {boardId !== undefined ? (
        <>
          <BoardMembersDialog
            open={dialog?.kind === "members"}
            onOpenChange={(open) => {
              if (!open) setDialog(null);
            }}
            showTrigger={false}
            returnFocusRef={returnFocusRef}
          />
          <ShareDialog
            open={dialog?.kind === "share"}
            onOpenChange={(open) => {
              if (!open) setDialog(null);
            }}
            showTrigger={false}
            returnFocusRef={returnFocusRef}
          />
        </>
      ) : null}
    </BoardPeopleContext.Provider>
  );
}
