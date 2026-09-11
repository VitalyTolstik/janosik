import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Check, ChevronDown, Plus, Search, Trash2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import { useBoard } from "@/store/BoardContext";
import { boardPath } from "@/store/BoardContext";
import type { Board } from "@/types/kanban";

/**
 * Board switcher — a premium popover anchored to the header: auto-focused
 * live search, colored board avatars (stable color derived from the board
 * id), card counts, an active-board check and keyboard navigation
 * (↑/↓ + Enter). Deleting happens inline (hover reveal → confirm), the
 * last remaining board is protected. Creating is a footer row that turns
 * into an inline input (Trello's pattern) and navigates to the new board.
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
  const navigate = useNavigate();
  const { boards, board, addBoard, removeBoard } = useBoard();

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [createDraft, setCreateDraft] = useState("");
  const [highlighted, setHighlighted] = useState(0);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const searchRef = useRef<HTMLInputElement | null>(null);
  const createRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return boards;
    return boards.filter((b) => b.title.toLowerCase().includes(q));
  }, [boards, query]);

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
      setConfirmDeleteId(null);
    }
  };

  const openBoard = (target: Board) => {
    resetAndClose();
    navigate(boardPath(target.id));
  };

  const handleCreate = () => {
    const title = createDraft.trim();
    if (!title) return;
    createBoard(title);
  };

  const createBoard = (title: string) => {
    const id = addBoard(title);
    resetAndClose();
    navigate(boardPath(id));
  };

  const handleDelete = (target: Board) => {
    setConfirmDeleteId(null);
    removeBoard(target.id);
    if (board?.id === target.id) {
      const remaining = boards.filter((b) => b.id !== target.id);
      if (remaining[0]) navigate(boardPath(remaining[0].id), { replace: true });
    }
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
    const row = list.querySelector<HTMLElement>(`[data-index="${highlighted}"]`);
    row?.scrollIntoView({ block: "nearest" });
  }, [highlighted]);

  const queryTrimmed = query.trim();
  const showCreateAsNamed = queryTrimmed.length > 0;

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          aria-label={t("board.switcher.aria")}
          aria-expanded={open}
          className="h-9 max-w-[220px] gap-2 px-2 text-foreground sm:max-w-[280px]"
        >
          {board ? (
            <span
              aria-hidden
              className={cn(
                "flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[11px] font-semibold text-white shadow-sm",
                boardColor(board.id),
              )}
            >
              {boardInitial(board.title)}
            </span>
          ) : null}
          <span className="truncate text-sm font-medium">
            {board?.title ?? "Janosik"}
          </span>
          <ChevronDown
            size={14}
            className="shrink-0 text-muted-foreground transition-transform duration-150 group-data-[state=open]:rotate-180"
          />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={8}
        onOpenAutoFocus={(e) => e.preventDefault()}
        className="w-[340px] overflow-hidden rounded-xl border bg-popover/95 p-0 shadow-xl backdrop-blur-md"
      >
        {/* Search */}
        <div className="flex items-center gap-2 border-b px-3 py-2.5">
          <Search size={15} className="shrink-0 text-muted-foreground" />
          <input
            ref={searchRef}
            value={query}
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
        </div>

        {/* Board list */}
        <div
          ref={listRef}
          role="listbox"
          aria-label={t("board.switcher.aria")}
          className="max-h-[264px] overflow-y-auto p-1.5"
        >
          {filtered.length === 0 ? (
            <p className="px-2.5 py-6 text-center text-sm text-muted-foreground">
              {t("board.switcher.empty")}
            </p>
          ) : (
            filtered.map((b, index) => {
              const isActive = b.id === board?.id;
              const isHighlighted = index === highlighted;
              const isConfirming = confirmDeleteId === b.id;
              const isLast = boards.length <= 1;
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
                      isActive ? "font-medium text-foreground" : "text-foreground/90",
                    )}
                  >
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
                          handleDelete(b);
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
                        {!isLast && (
                          <button
                            aria-label={t("board.switcher.delete")}
                            title={
                              isLast ? t("board.switcher.lastBoard") : undefined
                            }
                            className="absolute inset-0 flex items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:bg-danger/10 hover:text-danger focus-visible:opacity-100 group-hover/row:opacity-100"
                            onClick={(e) => {
                              e.stopPropagation();
                              setConfirmDeleteId(b.id);
                            }}
                          >
                            <Trash2 size={14} />
                          </button>
                        )}
                      </span>
                    </>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Create row */}
        <div className="border-t p-1.5">
          {creating ? (
            <div className="flex items-center gap-2 rounded-lg px-2 py-1 ring-1 ring-primary/30">
              <Plus size={15} className="shrink-0 text-primary" />
              <input
                ref={createRef}
                value={createDraft}
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
