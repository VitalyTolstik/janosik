import { Fragment } from "react";
import { SearchIcon } from "@/components/ui/search";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import { Button } from "@/components/ui/button";
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
import { LABEL_COLOR_DOT, LIMITS, type Label } from "@/types/kanban";
import { routes } from "@/routes";
import { useBoard } from "@/store/BoardContext";
import { LimitCounter, showRemaining } from "@/components/ui/limit-counter";
import {
  descriptionSnippet,
  searchBoards,
  type CardSearchHit,
  type SearchHit,
} from "@/utils/filter";

const SEARCH_DEBOUNCE_MS = 200;
/** Dropdown cap (Jira-style) — enough context without an endless list. */
const MAX_RESULTS = 20;

const isMac =
  typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

interface GlobalSearchProps {
  /** Exposed for tests (open via a normal click instead of the shortcut). */
  onOpenChange?: (open: boolean) => void;
}

/**
 * Global search across all boards (Trello's header search): a header button
 * plus Ctrl/Cmd+K, a debounced input, results grouped "Cards" → "Boards"
 * with the matched substring highlighted, `Board › Column` breadcrumb,
 * label chips and a description snippet when the match is in the text.
 * Clicking a result opens the board with that card's dialog via `?card=`
 * (Jira/Trello open the item itself, not just the board).
 */
export function GlobalSearch({ onOpenChange }: GlobalSearchProps) {
  const { t } = useI18n();
  const { boards } = useBoard();
  const navigate = useNavigate();

  const [open, setOpen] = useState(false);
  const [rawQuery, setRawQuery] = useState("");
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const setOpenBoth = useCallback(
    (next: boolean) => {
      setOpen(next);
      onOpenChange?.(next);
    },
    [onOpenChange],
  );

  // Debounce the query before the (synchronous) search runs over it.
  useEffect(() => {
    const timer = setTimeout(() => setQuery(rawQuery), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [rawQuery]);

  // Ctrl/Cmd+K opens the palette — the Linear/Notion/Jira convention.
  // Both modifiers are accepted on every platform (Ctrl+K is unbound
  // in-page on macOS browsers, and it keeps the shortcut testable).
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setOpenBoth(!open);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, setOpenBoth]);

  // Reset the search state whenever the palette closes.
  useEffect(() => {
    if (!open) {
      setRawQuery("");
      setQuery("");
      setActiveIndex(0);
    } else {
      // Focus on open (DialogTrigger would do it; the shortcut path needs this).
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const hits = useMemo(() => searchBoards(boards, query).slice(0, MAX_RESULTS), [
    boards,
    query,
  ]);

  useEffect(() => setActiveIndex(0), [query]);

  const openHit = (hit: SearchHit) => {
    setOpenBoth(false);
    navigate(
      hit.kind === "card"
        ? `${routes.board(hit.boardId)}?card=${hit.card.id}`
        : routes.board(hit.boardId),
    );
  };

  const cardHits = hits.filter((h): h is CardSearchHit => h.kind === "card");
  const boardHits = hits.filter((h) => h.kind === "board");

  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          {/* Labeled trigger: a muted "Global search" hint sits to the left
              of the magnifier (hidden on narrow screens — the icon stays). */}
          <Button
            variant="ghost"
            size="sm"
            aria-label={t("search.aria")}
            onClick={() => setOpenBoth(true)}
            className="gap-1.5 pr-2.5 text-muted-foreground transition-colors hover:text-foreground"
          >
            <span className="hidden text-xs font-medium sm:inline">
              {t("search.label")}
            </span>
            <SearchIcon size={20} />
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          {t("search.tooltip", { shortcut: isMac ? "⌘K" : "Ctrl+K" })}
        </TooltipContent>
      </Tooltip>

      <Dialog open={open} onOpenChange={setOpenBoth}>
        <DialogContent className="gap-0 p-0">
          <DialogTitle className="sr-only">{t("search.aria")}</DialogTitle>
          <DialogDescription className="sr-only">
            {t("search.hint")}
          </DialogDescription>
          <div className="relative border-b border-border p-3">
            <Input
              ref={inputRef}
              name="global-search"
              value={rawQuery}
              maxLength={LIMITS.query}
              aria-describedby={showRemaining(rawQuery.length, LIMITS.query) ? "search-query-limit" : undefined}
              onChange={(event) => setRawQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && hits[activeIndex]) {
                  openHit(hits[activeIndex]);
                } else if (event.key === "ArrowDown") {
                  event.preventDefault();
                  setActiveIndex((i) => Math.min(i + 1, hits.length - 1));
                } else if (event.key === "ArrowUp") {
                  event.preventDefault();
                  setActiveIndex((i) => Math.max(i - 1, 0));
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
            className="max-h-[60vh] overflow-y-auto p-2"
            data-testid="global-search-results"
          >
            {query.trim() === "" ? (
              <p className="px-3 py-6 text-center text-sm text-muted-foreground">
                {t("search.hint")}
              </p>
            ) : hits.length === 0 ? (
              <p className="px-3 py-6 text-center text-sm text-muted-foreground">
                {t("search.empty")}
              </p>
            ) : (
              <>
                {cardHits.length > 0 ? (
                  <SearchSection title={t("search.cards")}>
                    {cardHits.map((hit) => (
                      <ResultRow
                        key={`card-${hit.card.id}`}
                        active={hits.indexOf(hit) === activeIndex}
                        onClick={() => openHit(hit)}
                      >
                        <div className="min-w-0">
                          <div className="truncate text-sm text-foreground">
                            <HighlightedText
                              text={hit.card.title}
                              query={query}
                            />
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
                            text={hit.card.description ?? ""}
                            query={query}
                            show={hit.matchIn === "description"}
                          />
                        </div>
                      </ResultRow>
                    ))}
                  </SearchSection>
                ) : null}
                {boardHits.length > 0 ? (
                  <SearchSection title={t("search.boards")}>
                    {boardHits.map((hit) => (
                      <ResultRow
                        key={`board-${hit.boardId}`}
                        active={hits.indexOf(hit) === activeIndex}
                        onClick={() => openHit(hit)}
                      >
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium text-foreground">
                            <HighlightedText
                              text={hit.boardTitle}
                              query={query}
                            />
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
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function SearchSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-1 last:mb-0">
      <div className="px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide text-foreground">
        {title}
      </div>
      <div role="listbox" aria-label={title}>
        {children}
      </div>
    </div>
  );
}

function ResultRow({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="option"
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
  const chips = (labels ?? []).filter((label) => cardLabelIds.includes(label.id));
  if (chips.length === 0) return null;
  return (
    <div className="mt-1 flex flex-wrap gap-1">
      {chips.map((label) => (
        <span
          key={label.id}
          className="inline-flex items-center gap-1 rounded-full bg-muted/60 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground"
        >
          <span
            className={cn("h-1.5 w-1.5 rounded-full", LABEL_COLOR_DOT[label.color])}
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
