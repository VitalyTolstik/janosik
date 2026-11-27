import { useCallback, useMemo, useRef, useState, type RefObject } from "react";
import { matchPath, useLocation } from "react-router-dom";

import { ApiError, isApiEnabled } from "@/api/client";
import { useToast } from "@/components/Toast";
import { useI18n } from "@/i18n";
import { routes } from "@/routes";
import { useBoard } from "@/store/BoardContext";
import { createBackup, listBackups } from "@/utils/backup";
import { downloadTextFile } from "@/utils/download";
import { estimateBoardExportBytes } from "@/utils/export-size";
import {
  MAX_BOARD_EXPORT_BYTES,
  MAX_IMPORT_BYTES,
  parseExport,
  serializeExport,
  type Board,
  type BoardRole,
} from "@janosik/shared";

export interface DataMenuController {
  menuBoard: Board | undefined;
  serverMode: boolean;
  menuRole: BoardRole | undefined;
  archivedCount: number;
  backupCount: number | null;
  inputRef: RefObject<HTMLInputElement>;
  onMenuOpenChange: (open: boolean) => void;
  handleExport: () => Promise<void>;
  handleExportBoard: () => Promise<void>;
  handleFileChosen: (file: File | undefined) => Promise<void>;
  handleBackupNow: () => Promise<void>;
  archiveOpen: boolean;
  setArchiveOpen: (open: boolean) => void;
  backupsOpen: boolean;
  setBackupsOpen: (open: boolean) => void;
  rulesOpen: boolean;
  setRulesOpen: (open: boolean) => void;
  deletedOpen: boolean;
  setDeletedOpen: (open: boolean) => void;
}

/** State and handlers shared by the standalone Data menu and the Board menu. */
export function useDataMenu(): DataMenuController {
  const { t } = useI18n();
  const toast = useToast();
  const location = useLocation();
  const { boards, board, roleOf, importBoards, exportBoards, exportBoard } =
    useBoard();
  // The data menu acts on the board in the URL, not on "the active board":
  // an archived board is only reachable through a `?card=` deep link, and its
  // archive must not silently become the active board's archive.
  const routeBoardId = matchPath(routes.boardPattern, location.pathname)?.params
    .boardId;
  const viewedBoard =
    routeBoardId !== undefined
      ? boards.find((entry) => entry.id === routeBoardId)
      : board;
  // Opening the data menu behind a modal card can dismiss that card (a
  // pointer-down outside the dialog), which drops `?card=` and lets the
  // archived board's redirect take over before the archive is chosen. Pin
  // the board the menu was opened on so the archive still describes it.
  const [menuBoardId, setMenuBoardId] = useState<string | undefined>();
  const menuBoard =
    menuBoardId === undefined
      ? viewedBoard
      : boards.find((entry) => entry.id === menuBoardId);
  // TASK-166 D21: Janosik does not create backups. Server mode shows only
  // export/import; the local "save a copy" / automatic-backup browser is a
  // localStorage-only safety net and must not imply server backups.
  const serverMode = isApiEnabled();
  const menuRole = menuBoard === undefined ? undefined : roleOf(menuBoard.id);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [backupCount, setBackupCount] = useState<number | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [backupsOpen, setBackupsOpen] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [deletedOpen, setDeletedOpen] = useState(false);

  // Counted only while the menu is open (TASK-21.4.1): this component
  // re-renders on every keystroke anywhere on the board, and walking every
  // card to label a closed menu item is pure waste.
  const archivedCount = useMemo(
    () =>
      menuOpen && menuBoard
        ? Object.values(menuBoard.cards).filter(
            (card) => card.archivedAt !== undefined,
          ).length
        : 0,
    [menuOpen, menuBoard],
  );

  const refreshBackups = useCallback(async () => {
    try {
      setBackupCount((await listBackups()).length);
    } catch {
      setBackupCount(0);
    }
  }, []);

  const onMenuOpenChange = useCallback(
    (open: boolean) => {
      setMenuOpen(open);
      if (open) {
        setMenuBoardId(viewedBoard?.id);
        if (!serverMode) void refreshBackups();
      }
    },
    [refreshBackups, serverMode, viewedBoard?.id],
  );

  const handleExport = useCallback(async () => {
    try {
      const completeBoards = serverMode ? await exportBoards() : boards;
      // Preflight first: a multi-hundred-MB board must not be stringified
      // just to discover it is over the cap. The estimate is rough, so it
      // only hard-stops gross oversize; the exact check below decides the
      // 25 MB boundary (avoid false positives near the limit).
      if (
        estimateBoardExportBytes(completeBoards) >
        MAX_BOARD_EXPORT_BYTES * 4
      ) {
        toast.error(t("data.exportTooLarge"));
        return;
      }
      const raw = serializeExport(completeBoards);
      // TASK-166.6: the combined file must be importable again. The server
      // import cap is 25 MB; never hand the user a file it would reject.
      if (new TextEncoder().encode(raw).length > MAX_BOARD_EXPORT_BYTES) {
        toast.error(t("data.exportTooLarge"));
        return;
      }
      downloadTextFile("janosik-boards.json", raw);
      toast.success(
        t("data.exportAllSuccess", { count: completeBoards.length }),
      );
    } catch {
      toast.error(t("data.exportFailed"));
    }
  }, [boards, exportBoards, serverMode, t, toast]);

  /**
   * TASK-177.7: one board, one envelope. Server mode uses the existing
   * `GET /boards/:id/export`; local mode serializes the viewed board with
   * the same format. The all-boards action above stays a separate item with
   * its own "All boards exported (N)" copy.
   */
  const handleExportBoard = useCallback(async () => {
    const target = menuBoard;
    if (!target) return;
    try {
      const raw = await exportBoard(target.id);
      // The server answers 413 before streaming, so this is the local-mode
      // guard and a belt-and-braces check for a proxied older server.
      if (new TextEncoder().encode(raw).length > MAX_BOARD_EXPORT_BYTES) {
        toast.error(t("data.exportBoardTooLarge"));
        return;
      }
      downloadTextFile("janosik-board.json", raw);
      toast.success(t("data.exportSuccess"));
    } catch (error) {
      if (error instanceof ApiError && error.status === 413) {
        toast.error(t("data.exportBoardTooLarge"));
        return;
      }
      toast.error(t("data.exportFailed"));
    }
  }, [exportBoard, menuBoard, t, toast]);

  const handleFileChosen = useCallback(
    async (file: File | undefined) => {
      if (!file) return;
      // Refuse oversized files before reading them into memory.
      if (file.size > MAX_IMPORT_BYTES) {
        toast.error(t("data.importTooLarge"));
        return;
      }
      try {
        const text = await file.text();
        // TASK-166: the 10-board guard is local/offline only. In server mode
        // the operator cap (or no cap) is enforced by the API, so do not clip
        // the file in the browser.
        const boards = parseExport(text, {
          maxBoards: serverMode ? null : undefined,
        });
        // Server mode: the boards land in the database, then the list is
        // re-hydrated; a refusal is reported by the provider and resolves
        // `false`, so this handler does not add a success toast on top.
        const imported = await importBoards(boards);
        if (imported === false) return;
        toast.success(t("data.importSuccess"));
      } catch {
        toast.error(t("data.importError"));
      }
    },
    [importBoards, serverMode, t, toast],
  );

  const handleBackupNow = useCallback(async () => {
    try {
      await createBackup(boards);
      await refreshBackups();
      toast.success(t("data.backupSaved"));
    } catch {
      toast.error(t("data.backupFailed"));
    }
  }, [boards, refreshBackups, t, toast]);

  return {
    menuBoard,
    serverMode,
    menuRole,
    archivedCount,
    backupCount,
    inputRef,
    onMenuOpenChange,
    handleExport,
    handleExportBoard,
    handleFileChosen,
    handleBackupNow,
    archiveOpen,
    setArchiveOpen,
    backupsOpen,
    setBackupsOpen,
    rulesOpen,
    setRulesOpen,
    deletedOpen,
    setDeletedOpen,
  };
}
