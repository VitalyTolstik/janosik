import { Fragment } from "react";
import { Loader2 } from "lucide-react";
import { LazyAnimatedIcon } from "@/components/ui/lazy-animated-icon";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { useNavigate } from "react-router-dom";
import { shortcutLetterCode } from "@/utils/keyboard";

import { Button } from "@/components/ui/button";
import { useToast } from "@/components/Toast";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { HighlightedText } from "@/components/ui/highlight";
import { Input } from "@/components/ui/input";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import { LABEL_COLOR_DOT, LIMITS, type Label } from "@janosik/shared";
import { routes } from "@/routes";
import { useBoard } from "@/store/BoardContext";
import { LimitCounter } from "@/components/ui/limit-counter";
import { showRemaining } from "@/utils/limit-format";
import {
  descriptionSnippet,
  groupSearchHits,
  searchBoards,
  type SearchHit,
} from "@/utils/filter";
import { isMacPlatform } from "@/utils/platform";

const SEARCH_DEBOUNCE_MS = 200;
/** Per-group dropdown cap (Jira-style) — enough context without an endless list. */
const MAX_RESULTS = 20;

/**
 * Hard ceiling for `Show all results` (TASK-177.10 review): expanding must
 * never render an unbounded list, so each group stops at 200 matches. The
 * heading then keeps a `shown of total` label while the palette scrolls.
 */
const MAX_EXPANDED_RESULTS = 200;

/** Stable identity for keyboard selection across regrouping/expansion. */
function searchHitKey(hit: SearchHit): string {
  return hit.kind === "card"
    ? `card:${hit.boardId}:${hit.card.id}`
    : `board:${hit.boardId}`;
}

const isMac = isMacPlatform();

interface GlobalSearchProps {
  /** Exposed for tests (open via a normal click instead of the shortcut). */
  onOpenChange?: (open: boolean) => void;
  iconOnly?: boolean;
  /** Responsive label visibility for a header with its own breakpoints. */
  labelClassName?: string;
}

/**
 * Global search across all boards (Trello's header search): a header button
 * plus Ctrl/Cmd+K, a debounced input, results grouped "Cards" → "Boards"
 * with the matched substring highlighted, `Board › Column` breadcrumb,
 * label chips and a description snippet when the match is in the text.
 * Clicking a result opens the board with that card's dialog via `?card=`
 * (Jira/Trello open the item itself, not just the board).
 */
export function GlobalSearch({
  onOpenChange,
  iconOnly = false,
  labelClassName,
}: GlobalSearchProps) {
  const { t } = useI18n();

  const [open, setOpen] = useState(false);

  const setOpenBoth = useCallback(
    (next: boolean) => {
      setOpen(next);
      onOpenChange?.(next);
    },
    [onOpenChange],
  );

  // Ctrl/Cmd+K opens the palette — the Linear/Notion/Jira convention.
  // Both modifiers are accepted on every platform (Ctrl+K is unbound
  // in-page on macOS browsers, and it keeps the shortcut testable).
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        !event.defaultPrevented &&
        !event.isComposing &&
        !event.altKey &&
        shortcutLetterCode(event) === "KeyK" &&
        (event.metaKey || event.ctrlKey)
      ) {
        event.preventDefault();
        setOpenBoth(!open);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, setOpenBoth]);

  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          {/* Labeled trigger: a muted "Global search" hint sits to the left
              of the magnifier (hidden on narrow screens — the icon stays). */}
          <Button
            variant="ghost"
            size="sm"
            aria-label={t("search.label")}
            onClick={() => setOpenBoth(true)}
            className={cn(
              "gap-1.5 text-muted-foreground transition-colors hover:text-foreground",
              iconOnly && "w-8 justify-center !px-0",
              !iconOnly && "pr-2.5",
              "max-md:h-11 max-md:w-11 max-md:min-w-11 max-md:shrink-0 max-md:justify-center max-md:px-0",
            )}
          >
            <span
              className={cn(
                "text-xs font-medium",
                labelClassName ?? cn("hidden", !iconOnly && "sm:inline"),
              )}
            >
              {t("search.label")}
            </span>
            <LazyAnimatedIcon name="search" size={16} />
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          {t("search.tooltip", { shortcut: isMac ? "⌘K" : "Ctrl+K" })}
        </TooltipContent>
      </Tooltip>

      <Dialog open={open} onOpenChange={setOpenBoth}>
        <DialogContent className="gap-0 p-0 max-sm:pb-[env(safe-area-inset-bottom)] max-sm:pl-[env(safe-area-inset-left)] max-sm:pr-[env(safe-area-inset-right)] max-sm:pt-[env(safe-area-inset-top)]">
          <DialogTitle className="sr-only">{t("search.aria")}</DialogTitle>
          <DialogDescription className="sr-only">
            {t("search.hint")}
          </DialogDescription>
          {/* Query/results state lives in the palette body, which Radix
              unmounts on close — every open starts clean with no `open`
              reset effect (AGENT.md: reset by remount). */}
          <GlobalSearchPalette onClose={() => setOpenBoth(false)} />
        </DialogContent>
      </Dialog>
    </>
  );
}

interface GlobalSearchPaletteProps {
  /** Closes the palette after navigating to a hit. */
  onClose: () => void;
}

function GlobalSearchPalette({ onClose }: GlobalSearchPaletteProps) {
  const { t } = useI18n();
  const toast = useToast();
  const { boards, pendingBoardCount } = useBoard();
  const navigate = useNavigate();

  const [rawQuery, setRawQuery] = useState("");
  const [query, setQuery] = useState("");
  // Expansion is bound to the query it was requested for: typing during the
  // debounce must not carry an uncapped list into the next query.
  const [showAllFor, setShowAllFor] = useState<string | null>(null);
  // Selection is a hit identity, not an index — expanding a group inserts
  // rows above the board section without moving the cursor to another hit.
  const [cursorKey, setCursorKey] = useState<string | null>(null);
  // Scrolling is requested only by explicit navigation/query changes, never
  // by expansion, so Show all keeps the user's scroll position.
  const [scrollRequest, setScrollRequest] = useState(0);
  const showAll = showAllFor === query;
  const listId = useId();
  const optionId = (index: number) => `${listId}-option-${index}`;
  const inputRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);

  // Debounce the query before the (synchronous) search runs over it.
  useEffect(() => {
    const timer = setTimeout(() => {
      setQuery(rawQuery);
      setScrollRequest((request) => request + 1);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [rawQuery]);

  // Focus on mount: the DialogTrigger covers the click path, this covers
  // the Ctrl/Cmd+K path (previously done by an `open` effect).
  useEffect(() => {
    requestAnimationFrame(() => inputRef.current?.focus());
  }, []);

  // Raw hits are memoized separately from grouping so Show all only
  // re-slices the array instead of re-running the whole cross-board search.
  const rawHits = useMemo(() => searchBoards(boards, query), [boards, query]);
  // Cap each section separately (TASK-177.10): a board hit stays visible even
  // when the card list alone exceeds the palette cap.
  const groups = useMemo(
    () =>
      groupSearchHits(rawHits, MAX_RESULTS, {
        showAll,
        expandedCap: MAX_EXPANDED_RESULTS,
      }),
    [rawHits, showAll],
  );
  const { cards: cardHits, boards: boardHits } = groups;
  const boardOffset = cardHits.length;
  const hits = useMemo(() => [...groups.cards, ...groups.boards], [groups]);

  const activeIndex = useMemo(() => {
    if (hits.length === 0) return -1;
    if (cursorKey === null) return 0;
    const index = hits.findIndex((hit) => searchHitKey(hit) === cursorKey);
    return index >= 0 ? index : 0;
  }, [cursorKey, hits]);

  useEffect(() => {
    if (scrollRequest === 0) return;
    const row = resultsRef.current?.querySelector<HTMLElement>(
      '[aria-selected="true"]',
    );
    if (!row || typeof row.scrollIntoView !== "function") return;
    row.scrollIntoView({ block: "nearest" });
  }, [scrollRequest]);

  const openHit = (hit: SearchHit) => {
    if (hit.kind === "board" && hit.boardArchived) {
      toast.info(t("search.archivedBoard"));
      return;
    }
    onClose();
    navigate(
      hit.kind === "card"
        ? `${routes.board(hit.boardId)}?card=${hit.card.id}`
        : routes.board(hit.boardId),
    );
  };

  // While background hydration is still streaming boards, every total is a
  // loaded-so-far figure. Label it so the counter never implies completeness;
  // a board dropped after the retry budget clears pendingBoardCount with the
  // existing `sync.loadFailed` toast.
  const formatCount = (shown: number, total: number) =>
    pendingBoardCount > 0
      ? t("search.resultCountLoaded", { shown, total })
      : t("search.resultCount", { shown, total });
  const cardCount =
    groups.totalCards > cardHits.length
      ? formatCount(cardHits.length, groups.totalCards)
      : undefined;
  const boardCount =
    groups.totalBoards > boardHits.length
      ? formatCount(boardHits.length, groups.totalBoards)
      : undefined;

  return (
    <>
      <div className="relative border-b border-border p-3">
        <Input
          ref={inputRef}
          name="global-search"
          role="combobox"
          aria-expanded={hits.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={
            activeIndex >= 0 ? optionId(activeIndex) : undefined
          }
          value={rawQuery}
          maxLength={LIMITS.query}
          aria-describedby={
            showRemaining(rawQuery.length, LIMITS.query)
              ? "search-query-limit"
              : undefined
          }
          onChange={(event) => {
            setRawQuery(event.target.value);
            setShowAllFor(null);
            setCursorKey(null);
          }}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing || activeIndex < 0) return;
            if (event.key === "Enter") {
              event.preventDefault();
              openHit(hits[activeIndex]);
            } else if (event.key === "ArrowDown") {
              event.preventDefault();
              const next = Math.min(activeIndex + 1, hits.length - 1);
              setCursorKey(searchHitKey(hits[next]));
              setScrollRequest((request) => request + 1);
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              const next = Math.max(activeIndex - 1, 0);
              setCursorKey(searchHitKey(hits[next]));
              setScrollRequest((request) => request + 1);
            }
          }}
          placeholder={t("search.placeholder")}
          aria-label={t("search.aria")}
          className="h-9 border-0 shadow-none focus-visible:ring-0"
          data-testid="global-search-input"
        />
        <LimitCounter
          id="search-query-limit"
          length={rawQuery.length}
          limit={LIMITS.query}
          position="below"
          testId="search-query-limit"
        />
      </div>

      <div
        ref={resultsRef}
        className="max-h-[60vh] overflow-y-auto p-2"
        data-testid="global-search-results"
      >
        {pendingBoardCount > 0 ? (
          <p
            role="status"
            aria-live="polite"
            data-testid="search-boards-loading"
            className="flex items-center gap-2 px-3 py-1.5 text-xs text-muted-foreground"
          >
            <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
            {t("search.boardsLoading")}
          </p>
        ) : null}
        {query.trim() === "" ? (
          <p className="px-3 py-6 text-center text-sm text-muted-foreground">
            {t("search.hint")}
          </p>
        ) : hits.length === 0 ? (
          <p className="px-3 py-6 text-center text-sm text-muted-foreground">
            {t("search.empty")}
          </p>
        ) : null}
        <div
          id={listId}
          role="listbox"
          aria-label={t("search.aria")}
          hidden={hits.length === 0}
        >
          {cardHits.length > 0 ? (
            <SearchSection title={t("search.cards")} count={cardCount}>
              {cardHits.map((hit, index) => (
                <ResultRow
                  key={`card-${hit.card.id}`}
                  id={optionId(index)}
                  active={index === activeIndex}
                  onClick={() => openHit(hit)}
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm text-foreground">
                      <HighlightedText text={hit.card.title} query={query} />
                    </div>
                    <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                      <span className="truncate">
                        {hit.boardTitle}
                        {hit.columnTitle ? ` › ${hit.columnTitle}` : ""}
                      </span>
                      {hit.boardArchived || hit.cardArchived ? (
                        <ArchivedBadge>{t("search.archived")}</ArchivedBadge>
                      ) : null}
                    </div>
                    <LabelChips
                      labels={hit.boardLabels}
                      cardLabelIds={hit.card.labelIds}
                    />
                    <Snippet
                      text={
                        hit.matchIn === "checklist"
                          ? (hit.matchText ?? "")
                          : (hit.card.description ?? "")
                      }
                      query={query}
                      show={
                        hit.matchIn === "description" ||
                        hit.matchIn === "checklist"
                      }
                    />
                  </div>
                </ResultRow>
              ))}
            </SearchSection>
          ) : null}
          {boardHits.length > 0 ? (
            <SearchSection title={t("search.boards")} count={boardCount}>
              {boardHits.map((hit, index) => (
                <ResultRow
                  key={`board-${hit.boardId}`}
                  id={optionId(boardOffset + index)}
                  active={boardOffset + index === activeIndex}
                  onClick={() => openHit(hit)}
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-foreground">
                      <HighlightedText text={hit.boardTitle} query={query} />
                    </div>
                    {hit.boardArchived ? (
                      <div className="mt-0.5">
                        <ArchivedBadge>{t("search.archived")}</ArchivedBadge>
                      </div>
                    ) : null}
                  </div>
                </ResultRow>
              ))}
            </SearchSection>
          ) : null}
        </div>
      </div>
      {groups.capped && !showAll ? (
        <div className="flex justify-end border-t border-border p-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              setShowAllFor(query);
              inputRef.current?.focus();
            }}
            data-testid="search-show-all"
          >
            {t("search.showAll")}
          </Button>
        </div>
      ) : null}
    </>
  );
}

function SearchSection({
  title,
  count,
  children,
}: {
  title: string;
  count?: string;
  children: React.ReactNode;
}) {
  // The count belongs in the group's accessible name so screen readers hear
  // "Cards, 20 of 21" when entering the section; the visible span is also a
  // polite live region so a change after expanding/searching is announced.
  const label = count ? `${title}, ${count}` : title;
  return (
    <div className="mb-1 last:mb-0">
      <div className="flex items-baseline justify-between gap-2 px-3 py-1.5">
        <span className="text-[11px] font-bold uppercase tracking-wide text-foreground">
          {title}
        </span>
        {count ? (
          <span
            aria-live="polite"
            aria-atomic="true"
            className="text-[11px] font-medium text-muted-foreground"
          >
            {count}
          </span>
        ) : null}
      </div>
      <div role="group" aria-label={label}>
        {children}
      </div>
    </div>
  );
}

function ResultRow({
  id,
  active,
  onClick,
  children,
}: {
  id: string;
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="option"
      id={id}
      tabIndex={-1}
      onMouseDown={(event) => event.preventDefault()}
      aria-selected={active}
      onClick={onClick}
      className={cn(
        "flex w-full items-start gap-2 rounded-md px-3 py-2 text-left transition-colors",
        active ? "bg-hover" : "hover:bg-hover/60",
      )}
    >
      {children}
    </button>
  );
}

function LabelChips({
  labels,
  cardLabelIds,
}: {
  labels: Label[] | undefined;
  cardLabelIds: string[];
}) {
  const chips = (labels ?? []).filter((label) =>
    cardLabelIds.includes(label.id),
  );
  if (chips.length === 0) return null;
  return (
    <div className="mt-1 flex flex-wrap gap-1">
      {chips.map((label) => (
        <span
          key={label.id}
          className="inline-flex items-center gap-1 rounded-full bg-muted/60 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground"
        >
          <span
            className={cn(
              "h-1.5 w-1.5 rounded-full",
              LABEL_COLOR_DOT[label.color],
            )}
            aria-hidden
          />
          {label.name}
        </span>
      ))}
    </div>
  );
}

function Snippet({
  text,
  query,
  show,
}: {
  text: string;
  query: string;
  show: boolean;
}) {
  const snippet = useMemo(
    () => (show ? descriptionSnippet(text, query) : null),
    [show, text, query],
  );
  if (!snippet) return null;
  return (
    <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
      {snippet.map((segment, index) =>
        typeof segment === "string" ? (
          <Fragment key={index}>{segment}</Fragment>
        ) : (
          <mark
            key={index}
            className="rounded-[2px] bg-warning/40 px-0.5 text-inherit"
          >
            {segment.text}
          </mark>
        ),
      )}
    </p>
  );
}

function ArchivedBadge({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex shrink-0 items-center rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
      {children}
    </span>
  );
}
