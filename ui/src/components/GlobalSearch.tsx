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
  type RefObject,
} from "react";
import { useNavigate } from "react-router-dom";
import { shortcutLetterCode } from "@/utils/keyboard";

import { api, isApiEnabled } from "@/api/client";
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
import {
  LABEL_COLOR_DOT,
  LIMITS,
  type Label,
  type WorkspaceSearchMatch,
} from "@janosik/shared";
import { routes } from "@/routes";
import { useBoard } from "@/store/BoardContext";
import { LimitCounter } from "@/components/ui/limit-counter";
import { showRemaining } from "@/utils/limit-format";
import {
  descriptionSnippet,
  groupSearchHits,
  mergeWorkspaceSearchHits,
  searchBoards,
  searchHitBadge,
  type SearchHit,
} from "@/utils/filter";
import { isMacPlatform } from "@/utils/platform";
import {
  boardCommands,
  filterCommands,
  readCommandQuery,
  type CommandActions,
  type PaletteCommand,
} from "@/utils/commands";

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
const NO_SERVER_MATCHES: WorkspaceSearchMatch[] = [];

const SEARCH_TYPE_KEYS = {
  card: "search.typeCard",
  board: "search.typeBoard",
  comment: "search.typeComment",
  attachment: "search.typeAttachment",
} as const;

interface GlobalSearchProps {
  /** Exposed for tests (open via a normal click instead of the shortcut). */
  onOpenChange?: (open: boolean) => void;
  iconOnly?: boolean;
  /** Responsive label visibility for a header with its own breakpoints. */
  labelClassName?: string;
  commands?: CommandActions;
  fallbackFocusRef?: RefObject<HTMLElement>;
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
  commands,
  fallbackFocusRef,
}: GlobalSearchProps) {
  const { t } = useI18n();
  const serverMode = isApiEnabled();

  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const needsFallbackFocus = useRef(false);
  const pendingCommand = useRef<(() => void) | null>(null);

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
            ref={triggerRef}
            variant="ghost"
            size="sm"
            aria-label={t("search.label")}
            onClick={() => setOpenBoth(true)}
            className={cn(
              "gap-1.5 text-muted-foreground transition-colors hover:text-foreground",
              iconOnly && "w-8 justify-center !px-0",
              !iconOnly && "pr-2.5",
              "max-lg:h-11 max-lg:w-11 max-lg:min-w-11 max-lg:shrink-0 max-lg:justify-center max-lg:px-0",
            )}
          >
            <span
              className={cn(
                "text-ui-label font-medium",
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
        <DialogContent
          className="gap-0 p-0 max-sm:pb-[env(safe-area-inset-bottom)] max-sm:pl-[env(safe-area-inset-left)] max-sm:pr-[env(safe-area-inset-right)] max-sm:pt-[env(safe-area-inset-top)]"
          onOpenAutoFocus={() => {
            needsFallbackFocus.current =
              document.activeElement === document.body;
          }}
          onCloseAutoFocus={(event) => {
            if (needsFallbackFocus.current) {
              const trigger = triggerRef.current;
              const target = trigger?.getClientRects().length
                ? trigger
                : fallbackFocusRef?.current;
              if (target) {
                event.preventDefault();
                target.focus();
              }
            }
            // Let the palette release its focus trap before another surface opens.
            const run = pendingCommand.current;
            pendingCommand.current = null;
            run?.();
          }}
        >
          <DialogTitle className="sr-only">{t("search.aria")}</DialogTitle>
          <DialogDescription className="sr-only">
            {t(serverMode ? "search.hint" : "search.hintLocal")}
          </DialogDescription>
          {/* Query/results state lives in the palette body, which Radix
              unmounts on close — every open starts clean with no `open`
              reset effect (AGENT.md: reset by remount). */}
          <GlobalSearchPalette
            onClose={() => setOpenBoth(false)}
            commands={commands}
            onRun={(run) => {
              if (pendingCommand.current) return;
              pendingCommand.current = run;
              setOpenBoth(false);
            }}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}

interface GlobalSearchPaletteProps {
  /** Closes the palette after navigating to a hit. */
  onClose: () => void;
  commands?: CommandActions;
  onRun: (run: () => void) => void;
}

function GlobalSearchPalette({
  onClose,
  commands,
  onRun,
}: GlobalSearchPaletteProps) {
  const { t } = useI18n();
  const toast = useToast();
  const { boards, pendingBoardCount } = useBoard();
  const navigate = useNavigate();

  const [rawQuery, setRawQuery] = useState("");
  const [debouncedQuery, setQuery] = useState("");
  const [pickerId, setPickerId] = useState<string | null>(null);
  const commandQuery = readCommandQuery(rawQuery);
  const commandMode = commandQuery !== null;
  const query = commandMode ? "" : debouncedQuery;
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
  const commandHintId = useId();
  const optionId = (index: number) => `${listId}-option-${index}`;
  const inputRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);

  // Debounce the query before the (synchronous) search runs over it.
  useEffect(() => {
    if (commandMode) return;
    const timer = setTimeout(() => {
      setQuery(rawQuery);
      setScrollRequest((request) => request + 1);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [commandMode, rawQuery]);

  // Focus on mount: the DialogTrigger covers the click path, this covers
  // the Ctrl/Cmd+K path (previously done by an `open` effect).
  useEffect(() => {
    requestAnimationFrame(() => inputRef.current?.focus());
  }, []);

  const serverMode = isApiEnabled();
  // Comment/attachment text is not in the board aggregate, so the palette
  // asks for it in one bounded cross-board request (TASK-177.13) after the
  // same debounce as the local query. The query travels with the result so a
  // late answer for an older query can never repaint the current list.
  const [serverResult, setServerResult] = useState<{
    query: string;
    matches: WorkspaceSearchMatch[];
    total: number;
    truncated: boolean;
  }>({ query: "", matches: [], total: 0, truncated: false });
  useEffect(() => {
    const needle = query.trim();
    if (!serverMode || needle === "") return;
    let alive = true;
    api
      .searchWorkspaceMatches(needle)
      .then((result) => {
        if (alive) {
          setServerResult({
            query: needle,
            matches: result.matches,
            total: result.total,
            truncated: result.truncated,
          });
        }
      })
      .catch(() => {
        // Search is an enhancement: an old server without the route or a
        // transient failure leaves the local results untouched. Resolving
        // the query with no matches lets the palette leave its pending state.
        if (alive) {
          setServerResult({
            query: needle,
            matches: [],
            total: 0,
            truncated: false,
          });
        }
      });
    return () => {
      alive = false;
    };
  }, [serverMode, query]);
  const serverPending =
    serverMode && query.trim() !== "" && serverResult.query !== query.trim();
  const serverForQuery = serverResult.query === query.trim();
  const serverMatches = serverForQuery
    ? serverResult.matches
    : NO_SERVER_MATCHES;
  const serverTruncated = serverForQuery && serverResult.truncated;
  // Matches on boards that were not hydrated yet are filtered out of the
  // rendered list. While hydration is pending the palette is partial, not
  // empty: the total comes from the server even when no row can be shown.
  const serverPartial =
    serverForQuery && pendingBoardCount > 0 && serverResult.total > 0;

  // Raw hits are memoized separately from grouping so Show all only
  // re-slices the array instead of re-running the whole cross-board search.
  const rawHits = useMemo(
    () =>
      mergeWorkspaceSearchHits(
        searchBoards(boards, query),
        boards,
        serverMatches,
      ),
    [boards, query, serverMatches],
  );
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
  // The truncation line describes rows the palette actually renders: the
  // default 20-row cap (or the expanded cap) and only hydrated boards.
  const visibleServerMatches = cardHits.filter(
    (hit) => hit.matchIn === "comment" || hit.matchIn === "attachment",
  ).length;
  const boardOffset = cardHits.length;
  const hits = useMemo(() => [...groups.cards, ...groups.boards], [groups]);

  const openBoard = useCallback(
    (id: string) => navigate(routes.board(id)),
    [navigate],
  );
  const commandsForBoard = useMemo(
    () => (commandMode ? boardCommands(t, boards, openBoard, commands) : []),
    [boards, commandMode, commands, openBoard, t],
  );
  const picker = commandsForBoard.find((command) => command.id === pickerId);
  const commandOptions = commandMode
    ? filterCommands(
        picker && "choices" in picker ? picker.choices : commandsForBoard,
        commandQuery,
      )
    : [];
  const optionCount = commandMode ? commandOptions.length : hits.length;
  const optionKey = (index: number) =>
    commandMode ? commandOptions[index].id : searchHitKey(hits[index]);
  const selectedIndex =
    cursorKey === null
      ? -1
      : commandMode
        ? commandOptions.findIndex((option) => option.id === cursorKey)
        : hits.findIndex((hit) => searchHitKey(hit) === cursorKey);
  const activeIndex = optionCount > 0 ? Math.max(selectedIndex, 0) : -1;

  const selectCommand = (command: PaletteCommand) => {
    if ("choices" in command) {
      setPickerId(command.id);
      setRawQuery(">");
      setCursorKey(null);
      setScrollRequest((request) => request + 1);
    } else {
      onRun(command.run);
    }
  };

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
    if (hit.kind === "board") {
      openBoard(hit.boardId);
      return;
    }
    // The dialog opens on the card; a comment/attachment hit additionally
    // names the row so the dialog can reveal it. Without that id (older
    // server, row gone) the card alone is still a useful destination.
    const params = new URLSearchParams({ card: hit.card.id });
    if (hit.commentId !== undefined) params.set("comment", hit.commentId);
    else if (hit.attachmentId !== undefined) {
      params.set("attachment", hit.attachmentId);
    }
    navigate(`${routes.board(hit.boardId)}?${params.toString()}`);
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
  const commandLabel = picker?.label ?? t("commands.title");
  const showQueryLimit = showRemaining(rawQuery.length, LIMITS.query);

  return (
    <>
      <div className="relative border-b border-border p-3">
        <Input
          ref={inputRef}
          name="global-search"
          role="combobox"
          aria-expanded={optionCount > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={
            activeIndex >= 0 ? optionId(activeIndex) : undefined
          }
          value={rawQuery}
          maxLength={LIMITS.query}
          aria-describedby={
            commandMode
              ? commandHintId + (showQueryLimit ? " search-query-limit" : "")
              : showQueryLimit
                ? "search-query-limit"
                : undefined
          }
          onChange={(event) => {
            const next = event.target.value;
            if (readCommandQuery(next) === null) setPickerId(null);
            else if (!commandMode) setQuery("");
            setRawQuery(next);
            setShowAllFor(null);
            setCursorKey(null);
            if (commandMode) setScrollRequest((request) => request + 1);
          }}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing || activeIndex < 0) return;
            if (event.key === "Enter") {
              event.preventDefault();
              if (commandMode) selectCommand(commandOptions[activeIndex]);
              else openHit(hits[activeIndex]);
            } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              const offset = event.key === "ArrowDown" ? 1 : -1;
              const next = Math.min(
                Math.max(activeIndex + offset, 0),
                optionCount - 1,
              );
              setCursorKey(optionKey(next));
              setScrollRequest((request) => request + 1);
            }
          }}
          placeholder={t("search.placeholder")}
          aria-label={commandMode ? commandLabel : t("search.aria")}
          className={cn(
            "h-9 border-0 pr-12 shadow-none",
            commandMode
              ? "focus-visible:ring-2 focus-visible:ring-ring"
              : "focus-visible:ring-0",
          )}
          data-testid="global-search-input"
        />
        {commandMode ? (
          <div className="flex flex-wrap items-baseline gap-x-2 px-3 pt-1 text-ui-label">
            <span className="font-medium text-foreground">{commandLabel}</span>
            <span id={commandHintId} className="text-muted-foreground">
              {t("commands.filterHint")}
            </span>
          </div>
        ) : null}
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
        {commandMode ? (
          <>
            <div
              id={listId}
              role="listbox"
              aria-label={commandLabel}
              hidden={optionCount === 0}
            >
              {commandOptions.map((command, index) => (
                <ResultRow
                  key={command.id}
                  id={optionId(index)}
                  active={index === activeIndex}
                  onClick={() => selectCommand(command)}
                >
                  <span className="truncate text-ui-body">{command.label}</span>
                </ResultRow>
              ))}
            </div>
            {optionCount === 0 ? (
              <p
                role="status"
                className="px-3 py-6 text-center text-ui-body text-muted-foreground"
              >
                {t("commands.empty")}
              </p>
            ) : null}
          </>
        ) : (
          <>
            {pendingBoardCount > 0 ? (
              <p
                role="status"
                aria-live="polite"
                data-testid="search-boards-loading"
                className="flex items-center gap-2 px-3 py-1.5 text-ui-label text-muted-foreground"
              >
                <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                {t("search.boardsLoading")}
              </p>
            ) : null}
            {query.trim() === "" ? (
              <p className="px-3 py-6 text-center text-ui-body text-muted-foreground">
                {t(serverMode ? "search.hint" : "search.hintLocal")}
                <span className="mt-1.5 block">{t("commands.prefixHint")}</span>
              </p>
            ) : serverPending ? (
              <p
                role="status"
                aria-live="polite"
                data-testid="search-server-pending"
                className="flex items-center gap-2 px-3 py-1.5 text-ui-label text-muted-foreground"
              >
                <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                {t("search.serverPending")}
              </p>
            ) : hits.length === 0 && !serverPartial ? (
              <p className="px-3 py-6 text-center text-ui-body text-muted-foreground">
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
                        <div className="truncate text-ui-body text-foreground">
                          <HighlightedText
                            text={hit.card.title}
                            query={query}
                          />
                        </div>
                        <div className="mt-0.5 flex items-center gap-1.5 text-ui-meta text-muted-foreground">
                          <ResultTypeBadge hit={hit} />
                          <span className="sr-only">, </span>
                          <span className="truncate">
                            {hit.boardTitle}
                            {hit.columnTitle ? ` › ${hit.columnTitle}` : ""}
                          </span>
                          {hit.boardArchived || hit.cardArchived ? (
                            <ArchivedBadge>
                              {t("search.archived")}
                            </ArchivedBadge>
                          ) : null}
                        </div>
                        <LabelChips
                          labels={hit.boardLabels}
                          cardLabelIds={hit.card.labelIds}
                        />
                        <Snippet
                          text={
                            hit.matchIn === "checklist" ||
                            hit.matchIn === "comment" ||
                            hit.matchIn === "attachment" ||
                            hit.matchIn === "description"
                              ? (hit.matchText ?? hit.card.description ?? "")
                              : (hit.card.description ?? "")
                          }
                          label={
                            hit.matchIn === "comment"
                              ? t("search.inComment")
                              : hit.matchIn === "attachment"
                                ? t("search.inAttachment")
                                : undefined
                          }
                          query={query}
                          show={
                            hit.matchIn === "description" ||
                            hit.matchIn === "checklist" ||
                            hit.matchIn === "comment" ||
                            hit.matchIn === "attachment"
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
                        <div className="truncate text-ui-body font-medium text-foreground">
                          <HighlightedText
                            text={hit.boardTitle}
                            query={query}
                          />
                        </div>
                        <div className="mt-0.5 flex items-center gap-1.5">
                          <ResultTypeBadge hit={hit} />
                          <span className="sr-only">, </span>
                          {hit.boardArchived ? (
                            <ArchivedBadge>
                              {t("search.archived")}
                            </ArchivedBadge>
                          ) : null}
                        </div>
                      </div>
                    </ResultRow>
                  ))}
                </SearchSection>
              ) : null}
            </div>
            {serverTruncated ? (
              <p
                role="status"
                aria-live="polite"
                data-testid="search-server-truncated"
                className="px-3 py-1.5 text-ui-label text-muted-foreground"
              >
                {pendingBoardCount > 0
                  ? t("search.serverTruncatedPending", {
                      total: serverResult.total,
                    })
                  : t("search.serverTruncated", {
                      shown: visibleServerMatches,
                      total: serverResult.total,
                    })}
              </p>
            ) : null}
            {query.trim() !== "" && !serverPending && !serverPartial ? (
              <p
                role="status"
                aria-live="polite"
                data-testid="search-results-status"
                className="sr-only"
              >
                {t("search.resultsStatus", {
                  cards: groups.totalCards,
                  boards: groups.totalBoards,
                })}
              </p>
            ) : null}
          </>
        )}
      </div>
      {!commandMode && groups.capped && !showAll ? (
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
            className="max-sm:min-h-11"
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
        <span className="text-ui-micro font-bold uppercase tracking-wide text-foreground">
          {title}
        </span>
        {count ? (
          <span
            aria-live="polite"
            aria-atomic="true"
            className="text-ui-micro font-medium text-muted-foreground"
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

/**
 * Text type badge on every row (TASK-177.13). It is always a visible word,
 * never a colour-only cue, so screen readers and colour-blind users get the
 * same information: Card, Board, Comment or Attachment.
 */
function ResultTypeBadge({ hit }: { hit: SearchHit }) {
  const { t } = useI18n();
  const badge = searchHitBadge(hit);
  return (
    <span
      data-testid="search-type-badge"
      data-type={badge}
      className="inline-flex shrink-0 items-center rounded-full border border-border/70 px-1.5 py-0.5 text-ui-micro font-medium uppercase tracking-wide text-muted-foreground"
    >
      {t(SEARCH_TYPE_KEYS[badge])}
    </span>
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
          className="inline-flex items-center gap-1 rounded-full bg-muted/60 px-1.5 py-0.5 text-ui-micro font-medium text-muted-foreground"
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
  label,
}: {
  text: string;
  query: string;
  show: boolean;
  /** Spoken/visible context for a comment or attachment snippet. */
  label?: string;
}) {
  const snippet = useMemo(
    () => (show ? descriptionSnippet(text, query) : null),
    [show, text, query],
  );
  if (!snippet) return null;
  return (
    <p className="mt-1 line-clamp-2 text-ui-body text-muted-foreground">
      {label ? <span className="font-medium">{label}: </span> : null}
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
    <span className="inline-flex shrink-0 items-center rounded-full bg-muted px-1.5 py-0.5 text-ui-micro font-medium uppercase tracking-wide text-muted-foreground">
      {children}
    </span>
  );
}
