import { Fragment, useEffect, useId, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Archive,
  ArchiveRestore,
  Check,
  ChevronDown,
  Eye,
  Loader2,
  LogOut,
  Plus,
  Search,
  Sparkles,
  Trash2,
  Users,
  X,
} from "lucide-react";

import { BoardListSkeleton } from "@/components/board/BoardSkeleton";
import {
  TemplatePickerDialog,
  type TemplateCreateOutcome,
} from "@/components/board/TemplatePickerDialog";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import { useToast } from "@/components/Toast";
import { api, isApiEnabled } from "@/api/client";
import { useBoard } from "@/store/BoardContext";
import { routes } from "@/routes";
import { boardColor } from "@/utils/board-color";
import type {
  Board,
  BoardStarterLocale,
  BoardTemplateId,
} from "@janosik/shared";
import { LIMITS } from "@janosik/shared";
import { LimitCounter } from "@/components/ui/limit-counter";

/**
 * Board switcher — a premium popover anchored to the header: auto-focused
 * live search, colored board avatars (stable color derived from the board
 * id), card counts, an active-board check and keyboard navigation
 * (↑/↓ + Enter). Boards I administer come first under «Мои доски», boards
 * shared with me follow («Совместные») and wear a role icon in the action
 * slot — member (can edit) or viewer (read-only) — so the missing archive
 * action reads as an access level, not a glitch. Archiving (Trello's "close
 * board") replaced deletion for active boards — archived boards drop into a
 * dedicated section at the bottom where they can be restored or deleted for
 * good. Quick-create in the footer starts with the shared template gallery;
 * an empty board is a separate name-gated inline form (Trello's pattern) that
 * only navigates once the user explicitly submits a name.
 */

function boardInitial(title: string): string {
  const trimmed = title.trim();
  return trimmed ? trimmed[0].toUpperCase() : "•";
}

/** The switcher counts what a user can open — archived cards are not it. */
function activeCardCount(board: Board): number {
  return Object.values(board.cards).filter(
    (card) => card.archivedAt === undefined,
  ).length;
}

export function BoardSwitcher({
  archivedEntry = false,
}: {
  archivedEntry?: boolean;
}) {
  const { t, lang } = useI18n();
  const toast = useToast();
  const { boards, addBoard, setHomeRedirectPaused } = useBoard();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerName, setPickerName] = useState("");
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const serverMode = isApiEnabled();
  const [serverBoardLimit, setServerBoardLimit] = useState<
    number | null | undefined
  >(undefined);

  const templateLocale: BoardStarterLocale = lang.startsWith("ru")
    ? "ru"
    : "en";
  const existingTitles = useMemo(
    () => boards.map((entry) => entry.title),
    [boards],
  );

  useEffect(() => {
    if (!serverMode) return;
    let alive = true;
    void api
      .authConfig()
      .then((config) => {
        if (alive) setServerBoardLimit(config.limits.boards);
      })
      .catch(() => {
        // The server still enforces its cap; do not block creation on a
        // failed public-config read.
        if (alive) setServerBoardLimit(null);
      });
    return () => {
      alive = false;
    };
  }, [serverMode]);

  // Home redirects to the first active board as soon as one exists. The
  // all-archived entry also opens this picker, so pause while it is showing
  // the success panel instead of racing the redirect.
  useEffect(() => {
    if (!pickerOpen) return;
    setHomeRedirectPaused(true);
    return () => setHomeRedirectPaused(false);
  }, [pickerOpen, setHomeRedirectPaused]);

  const startWithExample = (initialName: string) => {
    // TASK-166 D19: the same cap the empty-board path checks before doing
    // any work. The picker must not open only to fail after a template POST.
    const limit = serverMode ? serverBoardLimit : LIMITS.boardsCount;
    if (typeof limit === "number" && boards.length >= limit) {
      toast.error(t("limits.maxBoards", { limit }));
      return;
    }
    // A search query is not a valid board title above the limit. Do not
    // truncate it into an apparently valid manual name; open the picker with
    // its normal auto-name instead.
    // The dialog is rendered as a sibling of the popover, so closing the
    // popover in the same commit cannot unmount it. Both layers never share
    // a DOM state: the dialog outlives the popover and owns the focus trap.
    setPickerName(initialName.length <= LIMITS.boardTitle ? initialName : "");
    setOpen(false);
    setPickerOpen(true);
  };

  const createFromTemplate = (
    name: string,
    template: BoardTemplateId,
    _locale: BoardStarterLocale,
    templateDate: string,
    templateUtcOffsetMinutes: number,
  ): Promise<TemplateCreateOutcome> => {
    return new Promise<TemplateCreateOutcome>((resolve) => {
      const result = addBoard(
        name,
        { template, templateLocale, templateDate, templateUtcOffsetMinutes },
        () => resolve({ code: "template_unavailable" }),
      );
      if (result !== null && typeof result === "object") {
        void result.then(resolve);
        return;
      }
      resolve(result);
    });
  };

  const createEmptyFromPicker = (name: string) => addBoard(name);

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            ref={triggerRef}
            variant={archivedEntry ? "outline" : "ghost"}
            size={archivedEntry ? "sm" : "icon"}
            aria-label={t(
              archivedEntry ? "board.switcher.archived" : "board.switcher.aria",
            )}
            data-testid="board-switcher-trigger"
            aria-expanded={open}
            className={cn(
              "shrink-0 text-muted-foreground hover:text-foreground [&_svg]:transition-transform [&_svg]:duration-150 data-[state=open]:text-foreground",
              archivedEntry
                ? "gap-2"
                : "h-8 w-6 max-lg:h-11 max-lg:w-11 max-lg:min-w-11",
            )}
          >
            {archivedEntry ? t("board.switcher.archived") : null}
            <ChevronDown size={16} className={open ? "rotate-180" : ""} />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          aria-label={t("board.switcher.aria")}
          align="start"
          sideOffset={8}
          collisionPadding={12}
          onOpenAutoFocus={(e) => e.preventDefault()}
          onEscapeKeyDown={(event) => {
            // The inline empty-board form owns Escape while it is open:
            // cancel it, do not dismiss the whole switcher.
            if (document.activeElement?.closest("[data-switcher-empty-form]")) {
              event.preventDefault();
            }
          }}
          className="w-[340px] overflow-hidden rounded-xl border bg-popover/95 p-0 shadow-xl backdrop-blur-md"
        >
          {/* All draft state (search, inline create, keyboard cursor, pending
              confirms) lives in this panel. Radix unmounts `PopoverContent`
              when the popover closes, so every open mounts a clean panel —
              reset by remount, never imperatively in `onOpenChange`
              (AGENT.md). */}
          <BoardSwitcherPanel
            open={open}
            onClose={() => setOpen(false)}
            onStartExample={startWithExample}
            serverBoardLimit={serverBoardLimit}
          />
        </PopoverContent>
      </Popover>
      <TemplatePickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        existingTitles={existingTitles}
        initialName={pickerName}
        createBoard={createFromTemplate}
        createEmptyBoard={createEmptyFromPicker}
        onOpenBoard={(boardId) => navigate(routes.board(boardId))}
        onCloseAutoFocus={(event) => {
          // The opener lives in the popover, which is already unmounted.
          // Return focus to the header switcher trigger instead of <body>.
          event.preventDefault();
          triggerRef.current?.focus();
        }}
      />
    </>
  );
}

interface BoardSwitcherPanelProps {
  /** Whether the surrounding popover is open (the combobox's popup state). */
  open: boolean;
  /** Closes the surrounding popover (used after navigating/creating). */
  onClose: () => void;
  /** Closes the popover and opens the shared template gallery. */
  onStartExample: (initialName: string) => void;
  /** Operator board cap from the runtime config; undefined while loading. */
  serverBoardLimit: number | null | undefined;
}

function BoardSwitcherPanel({
  open,
  onClose,
  onStartExample,
  serverBoardLimit,
}: BoardSwitcherPanelProps) {
  const { t } = useI18n();
  const toast = useToast();
  const navigate = useNavigate();
  const {
    boards,
    board,
    addBoard,
    removeBoard,
    leaveBoard,
    archiveBoard,
    unarchiveBoard,
    roleOf,
    pendingBoardCount,
  } = useBoard();

  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [createDraft, setCreateDraft] = useState("");
  const [createBusy, setCreateBusy] = useState(false);
  const [cursor, setCursor] = useState<number | null>(null);
  const gridId = useId();
  const rowId = (id: string) => `${gridId}-board-${id}`;
  const [confirmArchiveId, setConfirmArchiveId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [confirmLeaveId, setConfirmLeaveId] = useState<string | null>(null);
  const [leavingId, setLeavingId] = useState<string | null>(null);
  // TASK-166: server mode has no 10-board product limit. The runtime config
  // owns the operator cap; local mode falls back to the localStorage guard.
  const serverMode = isApiEnabled();

  const searchRef = useRef<HTMLInputElement | null>(null);
  const createRef = useRef<HTMLInputElement | null>(null);
  const emptyButtonRef = useRef<HTMLButtonElement | null>(null);
  const createSubmitRef = useRef(false);
  const listRef = useRef<HTMLDivElement | null>(null);

  // Only active boards are switchable/navigable; archived ones live in
  // their own section below (restore or delete — no navigation).
  const activeBoards = useMemo(
    () => boards.filter((b) => !b.archivedAt),
    [boards],
  );
  const archivedBoards = useMemo(
    () => boards.filter((b) => b.archivedAt),
    [boards],
  );

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return activeBoards;
    return activeBoards.filter((b) => b.title.toLowerCase().includes(q));
  }, [activeBoards, query]);

  // Boards split by the caller's role (TASK-36.2): boards I administer come
  // first, then the ones shared with me; the section headers only appear
  // when both groups exist, so an account that admins everything keeps the
  // flat, unlabelled list. The flat array keeps keyboard order identical to
  // what is on screen — grouping is presentation, not a second list.
  const groups = useMemo(() => {
    const mine: Board[] = [];
    const shared: Board[] = [];
    for (const b of matches) {
      if (roleOf(b.id) === "ADMIN") mine.push(b);
      else shared.push(b);
    }
    return { mine, shared, flat: [...mine, ...shared] };
  }, [matches, roleOf]);
  const showGroupHeaders = groups.mine.length > 0 && groups.shared.length > 0;
  const currentIndex = groups.flat.findIndex((entry) => entry.id === board?.id);
  const highlighted = Math.min(
    cursor ?? Math.max(currentIndex, 0),
    groups.flat.length - 1,
  );
  const highlightedBoard = groups.flat[highlighted];

  const filteredArchived = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return archivedBoards;
    return archivedBoards.filter((b) => b.title.toLowerCase().includes(q));
  }, [archivedBoards, query]);

  // Radix locks page scroll (RemoveScroll) and preventDefaults wheel events
  // over the portaled popover at the document level — after any listener on
  // the list itself, so the native scroll never fires. Listen on the
  // document bubble phase and scroll the list manually when the default was
  // suppressed (same workaround as the DataMenu / TimePicker columns).
  useEffect(() => {
    const onWheel = (e: WheelEvent) => {
      const list = listRef.current;
      if (e.defaultPrevented && list && list.contains(e.target as Node)) {
        list.scrollTop += e.deltaY;
      }
    };
    document.addEventListener("wheel", onWheel, { passive: true });
    return () => document.removeEventListener("wheel", onWheel);
  }, []);

  const openBoard = (target: Board) => {
    onClose();
    navigate(routes.board(target.id));
  };

  const canCreateEmpty = createDraft.trim().length > 0;

  const startEmptyCreate = () => {
    if (createBusy) return;
    // A search query is an explicit name only when it fits the title limit.
    // Never truncate an oversized query into a valid-looking seed: that would
    // leave the gated form enabled and allow a board the user did not name.
    setCreateDraft(
      queryTrimmed.length <= LIMITS.boardTitle ? queryTrimmed : "",
    );
    setCreating(true);
  };

  const cancelEmptyCreate = () => {
    if (createBusy) return;
    setCreating(false);
    setCreateDraft("");
    window.requestAnimationFrame(() => emptyButtonRef.current?.focus());
  };

  const handleCreateEmpty = () => {
    // The same synchronous lock as the first-run form and the picker: a
    // second click/Enter must never mint a second board and a second
    // navigation while the first POST is still in flight.
    if (createSubmitRef.current) return;
    const title = createDraft.trim();
    if (!title) return;
    createSubmitRef.current = true;
    setCreateBusy(true);
    void createBoard(title).finally(() => {
      createSubmitRef.current = false;
      setCreateBusy(false);
    });
  };

  const createBoard = async (title: string) => {
    // TASK-166 D19: 10 is only the local/offline localStorage guard. In
    // server mode the operator cap (or no limit at all) is authoritative; the
    // server checks it atomically too.
    const limit = serverMode ? serverBoardLimit : LIMITS.boardsCount;
    if (typeof limit === "number" && boards.length >= limit) {
      toast.error(t("limits.maxBoards", { limit }));
      return;
    }
    // Server mode creates the board over REST — the id arrives when the
    // server has it, so navigation waits; a refusal was already toasted.
    const id = await addBoard(title);
    if (!id) return;
    onClose();
    navigate(routes.board(id));
  };

  const handleArchive = (target: Board) => {
    setConfirmArchiveId(null);
    archiveBoard(target.id);
    // If the active board just got archived, move to the first active one
    // (the context redirect also covers this, but navigating here keeps
    // the popover's state predictable).
    if (board?.id === target.id) {
      const remaining = activeBoards.filter((b) => b.id !== target.id);
      if (remaining[0])
        navigate(routes.board(remaining[0].id), { replace: true });
    }
  };

  const handleLeave = async (target: Board) => {
    setLeavingId(target.id);
    const left = await leaveBoard(target.id);
    setLeavingId(null);
    if (left) {
      setConfirmLeaveId(null);
      onClose();
    }
  };

  const handleDeleteArchived = (target: Board) => {
    setConfirmDeleteId(null);
    // REST delete in server mode; a refusal surfaces as a toast.
    void removeBoard(target.id);
  };

  const onSearchKeyDown = (e: React.KeyboardEvent) => {
    if (e.nativeEvent.isComposing || highlightedBoard === undefined) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setCursor(Math.min(highlighted + 1, groups.flat.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setCursor(Math.max(highlighted - 1, 0));
    } else if (
      e.key === "Enter" &&
      confirmArchiveId !== highlightedBoard.id &&
      confirmLeaveId !== highlightedBoard.id
    ) {
      e.preventDefault();
      openBoard(highlightedBoard);
    }
  };

  // Keep the highlighted row visible while arrowing through the list.
  useEffect(() => {
    const list = listRef.current;
    if (!list || typeof list.scrollIntoView !== "function") return;
    const row = list.querySelector<HTMLElement>(
      `[data-index="${highlighted}"]`,
    );
    row?.scrollIntoView({ block: "nearest" });
  }, [highlighted, highlightedBoard?.id]);

  const queryTrimmed = query.trim();
  const namedEmptyLabel =
    queryTrimmed.length > 0 && queryTrimmed.length <= LIMITS.boardTitle
      ? queryTrimmed
      : "";
  const emptyHintId = `${gridId}-empty-name-hint`;

  return (
    <>
      {/* Search */}
      <div className="relative flex items-center gap-2 border-b px-3 py-2.5">
        <Search size={15} className="shrink-0 text-muted-foreground" />
        <input
          name="board-search"
          role="combobox"
          aria-expanded={open}
          aria-haspopup="grid"
          aria-controls={gridId}
          aria-autocomplete="list"
          aria-activedescendant={
            highlightedBoard ? rowId(highlightedBoard.id) : undefined
          }
          ref={searchRef}
          value={query}
          maxLength={LIMITS.query}
          onChange={(e) => {
            setQuery(e.target.value);
            setCursor(0);
          }}
          onKeyDown={onSearchKeyDown}
          placeholder={t("board.switcher.search")}
          aria-label={t("board.switcher.search")}
          autoFocus
          className="h-6 w-full bg-transparent text-ui-body outline-none placeholder:text-muted-foreground"
        />
        <LimitCounter
          length={query.length}
          limit={LIMITS.query}
          position="below"
          className="left-9"
          testId="switcher-search-limit"
        />
      </div>

      {/* Board list */}
      <div ref={listRef} className="max-h-[300px] overflow-y-auto p-1.5">
        {groups.flat.length === 0 ? (
          pendingBoardCount > 0 ? (
            <BoardListSkeleton pending={pendingBoardCount} />
          ) : (
            <p className="px-2.5 py-6 text-center text-ui-body text-muted-foreground">
              {query.trim().length > 0
                ? t("board.switcher.empty")
                : t("board.switcher.noActive")}
            </p>
          )
        ) : null}
        <div
          id={gridId}
          role="grid"
          aria-label={t("board.switcher.aria")}
          aria-busy={pendingBoardCount > 0}
        >
          {groups.flat.map((b, index) => {
            const isActive = b.id === board?.id;
            const isHighlighted = index === highlighted;
            const isConfirming = confirmArchiveId === b.id;
            const isConfirmingLeave = confirmLeaveId === b.id;
            // Only ADMINs manage a board (the server enforces it too); in
            // local mode every board is ADMIN, so the action stays visible.
            const canManage = roleOf(b.id) === "ADMIN";
            const cardCount = activeCardCount(b);
            const header =
              showGroupHeaders && index === 0
                ? "mine"
                : showGroupHeaders && index === groups.mine.length
                  ? "shared"
                  : null;
            return (
              <Fragment key={b.id}>
                {header !== null ? (
                  <div
                    role="row"
                    data-testid={`board-group-${header}`}
                    className={cn(
                      header === "shared" && "mt-1 border-t border-border/60",
                    )}
                  >
                    <div
                      role="gridcell"
                      className="px-2 pb-1 pt-1.5 text-ui-micro font-semibold uppercase tracking-wide text-muted-foreground"
                    >
                      {t(
                        header === "mine"
                          ? "board.switcher.section.mine"
                          : "board.switcher.section.shared",
                      )}
                    </div>
                  </div>
                ) : null}
                <div
                  data-index={index}
                  id={rowId(b.id)}
                  role="row"
                  aria-selected={isHighlighted}
                  aria-current={isActive ? "true" : undefined}
                  onMouseEnter={() => setCursor(index)}
                  onClick={() => {
                    if (isConfirming || isConfirmingLeave) return;
                    openBoard(b);
                  }}
                  className={cn(
                    "group/row flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 outline-none",
                    isHighlighted && "bg-hover",
                    isActive && !isHighlighted && "bg-primary/5",
                  )}
                >
                  <div
                    role="gridcell"
                    className="flex min-w-0 flex-1 items-center gap-2.5"
                  >
                    <span
                      aria-hidden
                      className={cn(
                        "flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-ui-micro font-semibold text-primary-foreground shadow-sm",
                        boardColor(b.id),
                      )}
                    >
                      {boardInitial(b.title)}
                    </span>
                    <span
                      className={cn(
                        "min-w-0 flex-1 truncate text-left text-ui-body",
                        isActive
                          ? "font-medium text-foreground"
                          : "text-foreground/90",
                      )}
                    >
                      {b.title}
                    </span>
                  </div>
                  <div
                    role="gridcell"
                    className="flex shrink-0 items-center gap-2.5"
                  >
                    {isConfirmingLeave ? (
                      <span
                        data-testid="board-switcher-leave-confirm"
                        className="flex items-center gap-1"
                      >
                        <span className="text-ui-meta text-muted-foreground">
                          {t("board.members.leaveConfirm")}
                        </span>
                        <button
                          aria-label={t("board.members.leaveConfirmYes")}
                          disabled={leavingId === b.id}
                          className="flex h-6 w-6 items-center justify-center rounded-md text-danger hover:bg-danger/10 disabled:opacity-50"
                          onClick={(e) => {
                            e.stopPropagation();
                            void handleLeave(b);
                          }}
                        >
                          <Check size={14} />
                        </button>
                        <button
                          aria-label={t("common.cancel")}
                          className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-hover"
                          onClick={(e) => {
                            e.stopPropagation();
                            setConfirmLeaveId(null);
                          }}
                        >
                          <X size={14} />
                        </button>
                      </span>
                    ) : isConfirming ? (
                      <span className="flex items-center gap-1">
                        <span className="text-ui-meta text-muted-foreground">
                          {t("board.switcher.archiveConfirm")}
                        </span>
                        <button
                          aria-label={t("board.switcher.archiveConfirmYes")}
                          className="flex h-6 w-6 items-center justify-center rounded-md text-danger hover:bg-danger/10"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleArchive(b);
                          }}
                        >
                          <Check size={14} />
                        </button>
                        <button
                          aria-label={t("common.cancel")}
                          className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-hover"
                          onClick={(e) => {
                            e.stopPropagation();
                            setConfirmArchiveId(null);
                          }}
                        >
                          <X size={14} />
                        </button>
                      </span>
                    ) : (
                      <>
                        <span
                          className="shrink-0 text-ui-meta tabular-nums text-muted-foreground"
                          aria-label={t("board.switcher.activeCards", {
                            count: cardCount,
                          })}
                          title={t("board.switcher.activeCards", {
                            count: cardCount,
                          })}
                        >
                          {cardCount}
                        </span>
                        {/* Touch has no hover: the checkmark yields its slot to
                        the row's action (always visible there). A board I do
                        not administer has no archive action — its slot shows
                        the access level instead, so the missing button never
                        reads as a glitch. */}
                        <span className="relative flex h-6 w-6 shrink-0 items-center justify-center">
                          {isActive && (
                            <Check
                              size={15}
                              className="no-hover:hidden absolute text-primary transition-opacity group-hover/row:opacity-0"
                              aria-hidden
                            />
                          )}
                          {canManage ? (
                            <button
                              aria-label={t("board.switcher.archive")}
                              className="no-hover:opacity-100 absolute inset-0 flex items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:bg-warning/10 hover:text-(--chip-warning) focus-visible:opacity-100 group-hover/row:opacity-100"
                              onClick={(e) => {
                                e.stopPropagation();
                                setConfirmArchiveId(b.id);
                              }}
                            >
                              <Archive size={14} />
                            </button>
                          ) : (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span
                                  role="img"
                                  data-testid="board-role"
                                  aria-label={t(
                                    roleOf(b.id) === "VIEWER"
                                      ? "board.switcher.role.viewer"
                                      : "board.switcher.role.member",
                                  )}
                                  className={cn(
                                    "flex h-6 w-6 items-center justify-center text-muted-foreground/70 transition-opacity",
                                    isActive &&
                                      "no-hover:opacity-100 opacity-0 group-hover/row:opacity-100",
                                  )}
                                >
                                  {roleOf(b.id) === "VIEWER" ? (
                                    <Eye size={13} aria-hidden />
                                  ) : (
                                    <Users size={13} aria-hidden />
                                  )}
                                </span>
                              </TooltipTrigger>
                              <TooltipContent>
                                {t(
                                  roleOf(b.id) === "VIEWER"
                                    ? "board.switcher.role.viewer"
                                    : "board.switcher.role.member",
                                )}
                              </TooltipContent>
                            </Tooltip>
                          )}
                        </span>
                        {/* TASK-177.2 review: the members dialog is desktop
                            only, so the switcher carries Leave at every
                            width. Server mode only: local boards have no
                            membership row to leave. */}
                        {serverMode ? (
                          <button
                            aria-label={`${t("board.members.leave")} — ${b.title}`}
                            data-testid="board-switcher-leave"
                            disabled={leavingId === b.id}
                            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-danger/10 hover:text-danger focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                            onClick={(e) => {
                              e.stopPropagation();
                              setConfirmLeaveId(b.id);
                            }}
                          >
                            <LogOut size={13} />
                          </button>
                        ) : null}
                      </>
                    )}
                  </div>
                </div>
              </Fragment>
            );
          })}
        </div>
        {/* Remaining aggregates are still streaming in — two pending rows
            keep the list honest instead of "no boards" or a silent gap. */}
        {pendingBoardCount > 0 && groups.flat.length > 0 ? (
          <BoardListSkeleton pending={pendingBoardCount} />
        ) : null}
        {/* Archived boards: kept out of navigation, restorable. */}
        {filteredArchived.length > 0 ? (
          <div className="mt-1 border-t pt-1.5" data-testid="archived-section">
            <p className="flex items-center gap-1.5 px-2 pb-1 pt-1.5 text-ui-micro font-semibold uppercase tracking-wide text-muted-foreground">
              <Archive size={12} aria-hidden />
              {t("board.switcher.archived")}
            </p>
            {filteredArchived.map((b) => {
              const isConfirming = confirmDeleteId === b.id;
              const isConfirmingLeave = confirmLeaveId === b.id;
              return (
                <div
                  key={b.id}
                  className="group/archived flex flex-wrap items-center gap-2.5 rounded-lg px-2 py-1.5"
                >
                  <span
                    aria-hidden
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-muted text-ui-micro font-semibold text-muted-foreground"
                  >
                    {boardInitial(b.title)}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-left text-ui-body text-muted-foreground">
                    {b.title}
                  </span>
                  {isConfirmingLeave ? (
                    <span
                      data-testid="board-switcher-archived-leave-confirm"
                      className="flex items-center gap-1"
                    >
                      <span className="text-ui-meta text-muted-foreground">
                        {t("board.members.leaveConfirm")}
                      </span>
                      <button
                        aria-label={t("board.members.leaveConfirmYes")}
                        disabled={leavingId === b.id}
                        className="flex h-6 w-6 items-center justify-center rounded-md text-danger hover:bg-danger/10 disabled:opacity-50"
                        onClick={(e) => {
                          e.stopPropagation();
                          void handleLeave(b);
                        }}
                      >
                        <Check size={14} />
                      </button>
                      <button
                        aria-label={t("common.cancel")}
                        className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-hover"
                        onClick={(e) => {
                          e.stopPropagation();
                          setConfirmLeaveId(null);
                        }}
                      >
                        <X size={14} />
                      </button>
                    </span>
                  ) : isConfirming ? (
                    <span className="flex w-full min-w-0 items-center justify-end gap-1">
                      <span className="min-w-0 whitespace-normal break-words text-right text-ui-label leading-tight text-muted-foreground">
                        {t("board.switcher.deleteConfirm")}
                      </span>
                      <button
                        aria-label={t("board.switcher.deleteConfirmYes")}
                        className="flex h-6 w-6 items-center justify-center rounded-md text-danger hover:bg-danger/10"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteArchived(b);
                        }}
                      >
                        <Check size={14} />
                      </button>
                      <button
                        aria-label={t("common.cancel")}
                        className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-hover"
                        onClick={(e) => {
                          e.stopPropagation();
                          setConfirmDeleteId(null);
                        }}
                      >
                        <X size={14} />
                      </button>
                    </span>
                  ) : (
                    <>
                      {roleOf(b.id) === "ADMIN" ? (
                        <>
                          <button
                            aria-label={t("board.switcher.restore")}
                            className="no-hover:opacity-100 flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:bg-primary/10 hover:text-primary focus-visible:opacity-100 group-hover/archived:opacity-100"
                            onClick={(e) => {
                              e.stopPropagation();
                              unarchiveBoard(b.id);
                            }}
                          >
                            <ArchiveRestore size={14} />
                          </button>
                          <button
                            aria-label={t("board.switcher.delete")}
                            className="no-hover:opacity-100 flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:bg-danger/10 hover:text-(--chip-red) focus-visible:opacity-100 group-hover/archived:opacity-100"
                            onClick={(e) => {
                              e.stopPropagation();
                              setConfirmDeleteId(b.id);
                            }}
                          >
                            <Trash2 size={14} />
                          </button>
                        </>
                      ) : serverMode && roleOf(b.id) !== "ADMIN" ? (
                        <button
                          aria-label={`${t("board.members.leave")} — ${b.title}`}
                          data-testid="board-switcher-archived-leave"
                          disabled={leavingId === b.id}
                          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-danger/10 hover:text-danger focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                          onClick={(e) => {
                            e.stopPropagation();
                            setConfirmLeaveId(b.id);
                          }}
                        >
                          <LogOut size={14} />
                        </button>
                      ) : null}
                    </>
                  )}
                </div>
              );
            })}
          </div>
        ) : null}
      </div>

      {/* Create actions: templates are the primary quick-create; an empty
          board is a separate, explicitly name-gated path. */}
      <div className="border-t p-1.5">
        {creating ? (
          <form
            noValidate
            data-switcher-empty-form
            onSubmit={(event) => {
              event.preventDefault();
              handleCreateEmpty();
            }}
            onKeyDown={(event) => {
              if (event.key !== "Escape") return;
              // Cancel only the inline form. preventDefault reaches Radix's
              // document listener and keeps the whole switcher open.
              event.preventDefault();
              event.stopPropagation();
              cancelEmptyCreate();
            }}
            className="rounded-lg px-2 py-1.5 ring-1 ring-primary/30"
          >
            <div className="flex items-center gap-2">
              <Plus size={15} className="shrink-0 text-primary" />
              {/* Keep touch inputs at 16px to prevent iOS focus zoom. */}
              <input
                name="board-create"
                ref={createRef}
                value={createDraft}
                maxLength={LIMITS.boardTitle}
                disabled={createBusy}
                onChange={(e) => setCreateDraft(e.target.value)}
                placeholder={t("board.switcher.newPlaceholder")}
                aria-label={t("board.switcher.newPlaceholder")}
                aria-describedby={emptyHintId}
                autoFocus
                className="h-7 min-w-0 flex-1 bg-transparent text-ui-body outline-none placeholder:text-muted-foreground disabled:opacity-60 max-[1024.98px]:h-11 max-[1024.98px]:text-base"
              />
              <button
                type="submit"
                data-testid="switcher-create-empty-submit"
                aria-label={t("board.firstRun.emptyCta")}
                disabled={!canCreateEmpty || createBusy}
                aria-busy={createBusy || undefined}
                className="inline-flex h-7 shrink-0 items-center justify-center gap-1.5 rounded-md bg-action-primary px-2.5 text-ui-label font-semibold text-primary-foreground transition-colors hover:bg-[#1d4ed8] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-popover disabled:pointer-events-none disabled:opacity-50 max-[1024.98px]:h-11 max-[1024.98px]:px-3 max-[1024.98px]:text-ui-label"
              >
                {createBusy ? (
                  <Loader2 aria-hidden className="h-3 w-3 animate-spin" />
                ) : null}
                {createBusy
                  ? t("common.creating")
                  : t("board.switcher.createEmptySubmit")}
              </button>
              <button
                type="button"
                aria-label={t("common.cancel")}
                disabled={createBusy}
                onClick={cancelEmptyCreate}
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 max-[1024.98px]:h-11 max-[1024.98px]:w-11"
              >
                <X size={14} />
              </button>
            </div>
            <div className="mt-1 flex items-center justify-between gap-2 max-[1024.98px]:mt-1.5">
              <p
                id={emptyHintId}
                className="line-clamp-2 min-w-0 flex-1 text-ui-body leading-[1.4] text-muted-foreground"
              >
                {createBusy
                  ? t("common.creating")
                  : canCreateEmpty
                    ? t("board.switcher.emptyReadyHint")
                    : t("board.switcher.emptyNameHint")}
              </p>
              <LimitCounter
                length={createDraft.length}
                limit={LIMITS.boardTitle}
                className="shrink-0"
                testId="switcher-create-limit"
              />
            </div>
          </form>
        ) : (
          <div className="flex flex-col gap-0.5">
            <button
              type="button"
              data-testid="switcher-create-template"
              onClick={() => onStartExample(queryTrimmed)}
              className="flex min-h-8 w-full items-center gap-2.5 rounded-lg border border-primary/20 bg-primary/[0.06] px-2 py-2 text-left text-ui-body font-medium text-foreground outline-none transition-colors hover:border-primary/35 hover:bg-primary/10 focus-visible:ring-2 focus-visible:ring-ring max-[1024.98px]:min-h-11"
            >
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary/15 text-primary">
                <Sparkles size={15} aria-hidden />
              </span>
              <span className="min-w-0 flex-1 truncate">
                {t("board.firstRun.starterCta")}
              </span>
            </button>
            <button
              ref={emptyButtonRef}
              type="button"
              data-testid="switcher-create-empty"
              onClick={startEmptyCreate}
              className="flex min-h-7 w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-ui-body text-muted-foreground outline-none transition-colors hover:bg-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring max-[1024.98px]:min-h-11"
            >
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-dashed border-border text-muted-foreground">
                <Plus size={15} aria-hidden />
              </span>
              <span className="min-w-0 flex-1 truncate">
                {namedEmptyLabel
                  ? t("board.switcher.createEmptyWithName", {
                      name: namedEmptyLabel,
                    })
                  : t("board.firstRun.emptyCta")}
              </span>
            </button>
          </div>
        )}
      </div>
    </>
  );
}
