import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Archive,
  ArchiveRestore,
  Check,
  ChevronDown,
  Plus,
  Search,
  Trash2,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import { useToast } from "@/components/Toast";
import { useBoard } from "@/store/BoardContext";
import { routes } from "@/routes";
import type { Board } from "@/types/kanban";
import { LIMITS } from "@/types/kanban";
import { LimitCounter } from "@/components/ui/limit-counter";

/**
 * Board switcher — a premium popover anchored to the header: auto-focused
 * live search, colored board avatars (stable color derived from the board
 * id), card counts, an active-board check and keyboard navigation
 * (↑/↓ + Enter). Archiving (Trello's "close board") replaced deletion for
 * active boards — archived boards drop into a dedicated section at the
 * bottom where they can be restored or deleted for good. Creating is a
 * footer row that turns into an inline input (Trello's pattern) and
 * navigates to the new board.
 */

const BOARD_ICON_COLORS = [
  "bg-primary",
  "bg-secondary",
  "bg-blue",
  "bg-indigo",
  "bg-teal",
  "bg-success",
  "bg-orange",
  "bg-danger",
  "bg-fuchsia",
  "bg-pink",
  "bg-slate",
] as const;

/** Stable color for a board — derived from its id, no storage needed. */
function boardColor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) | 0;
  }
  return BOARD_ICON_COLORS[Math.abs(hash) % BOARD_ICON_COLORS.length];
}

function boardInitial(title: string): string {
  const trimmed = title.trim();
  return trimmed ? trimmed[0].toUpperCase() : "•";
}

export function BoardSwitcher() {
  const { t } = useI18n();
  const toast = useToast();
  const navigate = useNavigate();
  const { boards, board, addBoard, removeBoard, archiveBoard, unarchiveBoard } =
    useBoard();

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [createDraft, setCreateDraft] = useState("");
  const [highlighted, setHighlighted] = useState(0);
  const [confirmArchiveId, setConfirmArchiveId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const searchRef = useRef<HTMLInputElement | null>(null);
  const createRef = useRef<HTMLInputElement | null>(null);
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

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return activeBoards;
    return activeBoards.filter((b) => b.title.toLowerCase().includes(q));
  }, [activeBoards, query]);

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
    if (!open) return;
    const onWheel = (e: WheelEvent) => {
      const list = listRef.current;
      if (e.defaultPrevented && list && list.contains(e.target as Node)) {
        list.scrollTop += e.deltaY;
      }
    };
    document.addEventListener("wheel", onWheel, { passive: true });
    return () => document.removeEventListener("wheel", onWheel);
  }, [open]);

  const resetAndClose = () => {
    setOpen(false);
  };

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (next) {
      setQuery("");
      setCreating(false);
      setCreateDraft("");
      setHighlighted(0);
      setConfirmArchiveId(null);
      setConfirmDeleteId(null);
    }
  };

  const openBoard = (target: Board) => {
    resetAndClose();
    navigate(routes.board(target.id));
  };

  const handleCreate = () => {
    const title = createDraft.trim();
    if (!title) return;
    createBoard(title);
  };

  const createBoard = (title: string) => {
    if (boards.length >= LIMITS.boardsCount) {
      toast.error(t("limits.maxBoards", { limit: LIMITS.boardsCount }));
      return;
    }
    const id = addBoard(title);
    resetAndClose();
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

  const handleDeleteArchived = (target: Board) => {
    setConfirmDeleteId(null);
    removeBoard(target.id);
  };

  const onSearchKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlighted((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlighted((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const target = filtered[highlighted];
      if (target) openBoard(target);
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
  }, [highlighted]);

  const queryTrimmed = query.trim();
  const showCreateAsNamed = queryTrimmed.length > 0;

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={t("board.switcher.aria")}
          aria-expanded={open}
          className="h-8 w-6 shrink-0 text-muted-foreground hover:text-foreground [&_svg]:transition-transform [&_svg]:duration-150 data-[state=open]:text-foreground"
        >
          <ChevronDown size={16} className={open ? "rotate-180" : ""} />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={8}
        onOpenAutoFocus={(e) => e.preventDefault()}
        className="w-[340px] overflow-hidden rounded-xl border bg-popover/95 p-0 shadow-xl backdrop-blur-md"
      >
        {/* Search */}
        <div className="relative flex items-center gap-2 border-b px-3 py-2.5">
          <Search size={15} className="shrink-0 text-muted-foreground" />
          <input
            name="board-search"
            ref={searchRef}
            value={query}
            maxLength={LIMITS.query}
            onChange={(e) => {
              setQuery(e.target.value);
              setHighlighted(0);
            }}
            onKeyDown={onSearchKeyDown}
            placeholder={t("board.switcher.search")}
            aria-label={t("board.switcher.search")}
            autoFocus
            className="h-6 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
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
        <div
          ref={listRef}
          role="listbox"
          aria-label={t("board.switcher.aria")}
          className="max-h-[300px] overflow-y-auto p-1.5"
        >
          {filtered.length === 0 ? (
            <p className="px-2.5 py-6 text-center text-sm text-muted-foreground">
              {t("board.switcher.empty")}
            </p>
          ) : (
            filtered.map((b, index) => {
              const isActive = b.id === board?.id;
              const isHighlighted = index === highlighted;
              const isConfirming = confirmArchiveId === b.id;
              return (
                <div
                  key={b.id}
                  data-index={index}
                  role="option"
                  aria-selected={isActive}
                  tabIndex={-1}
                  onMouseEnter={() => setHighlighted(index)}
                  onClick={() => {
                    if (isConfirming) return;
                    openBoard(b);
                  }}
                  className={cn(
                    "group/row flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 outline-none",
                    isHighlighted && "bg-hover",
                    isActive && !isHighlighted && "bg-primary/5",
                  )}
                >
                  <span
                    aria-hidden
                    className={cn(
                      "flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-xs font-semibold text-white shadow-sm",
                      boardColor(b.id),
                    )}
                  >
                    {boardInitial(b.title)}
                  </span>
                  <span
                    className={cn(
                      "min-w-0 flex-1 truncate text-left text-sm",
                      isActive
                        ? "font-medium text-foreground"
                        : "text-foreground/90",
                    )}
                  >
                    {b.title}
                  </span>
                  {isConfirming ? (
                    <span className="flex items-center gap-1">
                      <span className="text-xs text-muted-foreground">
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
                      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                        {Object.keys(b.cards).length}
                      </span>
                      <span className="relative flex h-6 w-6 shrink-0 items-center justify-center">
                        {isActive && (
                          <Check
                            size={15}
                            className="absolute text-primary transition-opacity group-hover/row:opacity-0"
                            aria-hidden
                          />
                        )}
                        <button
                          aria-label={t("board.switcher.archive")}
                          className="absolute inset-0 flex items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:bg-warning/10 hover:text-warning focus-visible:opacity-100 group-hover/row:opacity-100"
                          onClick={(e) => {
                            e.stopPropagation();
                            setConfirmArchiveId(b.id);
                          }}
                        >
                          <Archive size={14} />
                        </button>
                      </span>
                    </>
                  )}
                </div>
              );
            })
          )}
          {/* Archived boards: kept out of navigation, restorable. */}
          {filteredArchived.length > 0 ? (
            <div
              className="mt-1 border-t pt-1.5"
              data-testid="archived-section"
            >
              <p className="flex items-center gap-1.5 px-2 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                <Archive size={12} aria-hidden />
                {t("board.switcher.archived")}
              </p>
              {filteredArchived.map((b) => {
                const isConfirming = confirmDeleteId === b.id;
                return (
                  <div
                    key={b.id}
                    className="group/archived flex items-center gap-2.5 rounded-lg px-2 py-1.5"
                  >
                    <span
                      aria-hidden
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-muted text-xs font-semibold text-muted-foreground"
                    >
                      {boardInitial(b.title)}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-left text-sm text-muted-foreground">
                      {b.title}
                    </span>
                    {isConfirming ? (
                      <span className="flex items-center gap-1">
                        <span className="text-xs text-muted-foreground">
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
                        <button
                          aria-label={t("board.switcher.restore")}
                          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:bg-primary/10 hover:text-primary focus-visible:opacity-100 group-hover/archived:opacity-100"
                          onClick={(e) => {
                            e.stopPropagation();
                            unarchiveBoard(b.id);
                          }}
                        >
                          <ArchiveRestore size={14} />
                        </button>
                        <button
                          aria-label={t("board.switcher.delete")}
                          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:bg-danger/10 hover:text-danger focus-visible:opacity-100 group-hover/archived:opacity-100"
                          onClick={(e) => {
                            e.stopPropagation();
                            setConfirmDeleteId(b.id);
                          }}
                        >
                          <Trash2 size={14} />
                        </button>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          ) : null}
        </div>

        {/* Create row */}
        <div className="border-t p-1.5">
          {creating ? (
            <div className="relative flex items-center gap-2 rounded-lg px-2 py-1 ring-1 ring-primary/30">
              <Plus size={15} className="shrink-0 text-primary" />
              <input
                name="board-create"
                ref={createRef}
                value={createDraft}
                maxLength={LIMITS.boardTitle}
                onChange={(e) => setCreateDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleCreate();
                  } else if (e.key === "Escape") {
                    e.stopPropagation();
                    setCreating(false);
                    setCreateDraft("");
                  }
                }}
                placeholder={t("board.switcher.newPlaceholder")}
                aria-label={t("board.switcher.newPlaceholder")}
                autoFocus
                className="h-7 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              />
              <LimitCounter
                length={createDraft.length}
                limit={LIMITS.boardTitle}
                position="below"
                className="left-6"
                testId="switcher-create-limit"
              />
            </div>
          ) : (
            <button
              className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-sm text-muted-foreground outline-none transition-colors hover:bg-hover hover:text-foreground"
              onClick={() => {
                if (queryTrimmed) {
                  createBoard(queryTrimmed);
                } else {
                  setCreating(true);
                }
              }}
            >
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-dashed border-border">
                <Plus size={15} />
              </span>
              <span className="truncate">
                {showCreateAsNamed
                  ? t("board.switcher.createWithName", { name: queryTrimmed })
                  : t("board.switcher.new")}
              </span>
            </button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
