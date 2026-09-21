import { useId, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ArrowUpRight, CornerDownLeft, Link2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useToast } from "@/components/Toast";
import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n";
import { routes } from "@/routes";
import { useBoardActions } from "@/store/BoardContext";
import { splitHighlight } from "@/utils/filter";
import {
  cardLinkIndex,
  LINK_TYPE_OPTIONS,
  linkRowGroups,
  suggestLinkTargets,
  wouldCreateCycle,
} from "@/utils/links";
import type { Board, CardLinkType } from "@janosik/shared";
import { LIMITS } from "@janosik/shared";

interface CardLinksProps {
  cardId: string;
  board: Board;
  readOnly?: boolean;
}

/**
 * The "Linked cards" section of the card dialog (TASK-46).
 *
 * Jira's link model, one screen: the rows are grouped by how they read
 * from *this* card (blocks / is blocked by / relates to / duplicates / is
 * duplicated by), a row navigates to the linked card (the `?card=` deep
 * link makes that an URL change the dialog renders), and adding is the
 * Jira flow — pick the relation, type until the card you mean surfaces,
 * Enter. The reducer keeps every invariant (one link per pair, no blocks
 * cycles); the UI checks the two refusable ones up front so the user gets
 * a toast instead of a silently dropped command.
 */
export function CardLinks({ cardId, board, readOnly = false }: CardLinksProps) {
  const { t } = useI18n();
  const { addCardLink, removeCardLink } = useBoardActions();
  const toast = useToast();
  // Navigating to a linked card = swapping the `?card=` deep-link param
  // (BoardSection owns the dialog, so this just points it elsewhere).
  const [searchParams, setSearchParams] = useSearchParams();

  const [query, setQuery] = useState("");
  const [rawCursor, setCursor] = useState(0);
  const [option, setOption] = useState<(typeof LINK_TYPE_OPTIONS)[number]>(
    LINK_TYPE_OPTIONS[0],
  );
  // Reset the picker when the dialog navigates to another card. The section
  // cannot be keyed on the card id: the row button that triggers the
  // navigation lives inside it, and remounting mid-navigation leaves the
  // previous section's DOM behind in the Radix portal (two "Linked cards"
  // blocks in one dialog). React's documented "adjust state when a prop
  // changes" instead — applied during render, before the DOM commits.
  const [prevCardId, setPrevCardId] = useState(cardId);
  if (prevCardId !== cardId) {
    setPrevCardId(cardId);
    setQuery("");
    setCursor(0);
  }
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  const facts = useMemo(
    () => cardLinkIndex(board.cards).factsOf(cardId),
    [board.cards, cardId],
  );
  const suggestions = useMemo(
    () => suggestLinkTargets(board.cards, cardId, query),
    [board.cards, cardId, query],
  );

  // Group the rows by how they read from this card, in a stable order —
  // the same helper the card-front popover uses (dangling is the tail
  // group: rows whose target card was deleted; they still occupy the
  // card's row cap, so the only way to free a capped card is to show them
  // here with their remove button — TASK-46 follow-up).
  const groups = useMemo(
    () => linkRowGroups(board.cards, facts, t("card.links.deletedCard")),
    [board.cards, facts, t],
  );

  // Keep the highlighted row inside the list as the query filters it —
  // derived at render instead of an effect (no cascading setState).
  const cursor = Math.min(rawCursor, Math.max(0, suggestions.length - 1));

  // Rows stored on a card, dangling ones included — the reducer counts them
  // against the cap too.
  const linkCount = (id: string) => board.cards[id]?.links?.length ?? 0;

  // A viewer sees the section only when there is a real relation to read;
  // an editor also needs it when the card holds nothing but dangling rows,
  // because those are what is holding the cap.
  if (readOnly && facts.degree === 0) return null;

  const pick = (target: { id: string; title: string }) => {
    // "is blocked by X" stores a blocks row on X pointing back here, so the
    // row's holder — and the cap and cycle check that apply to it — is the
    // target, not the card being viewed.
    const [holderId, otherId] =
      option.holder === "source" ? [cardId, target.id] : [target.id, cardId];
    if (linkCount(holderId) >= LIMITS.linksPerCard) {
      toast.error(t("limits.maxLinksOnCard", { limit: LIMITS.linksPerCard }));
      return;
    }
    if (
      option.linkType === "blocks" &&
      wouldCreateCycle(board.cards, holderId, otherId)
    ) {
      toast.error(t("card.links.cycle"));
      return;
    }
    addCardLink(holderId, otherId, option.linkType);
    setQuery("");
    setCursor(0);
    inputRef.current?.focus();
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (suggestions.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setCursor((rawCursor + 1) % suggestions.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setCursor((rawCursor - 1 + suggestions.length) % suggestions.length);
    } else if (event.key === "Enter") {
      const hit = suggestions[cursor];
      if (hit) {
        event.preventDefault();
        pick(hit);
      }
    } else if (event.key === "Escape") {
      setQuery("");
    }
  };

  const remove = (row: {
    linkId: string;
    targetCardId: string;
    type: CardLinkType;
  }) => {
    // The row may live on the linked card (incoming side) — the writer
    // needs the holder, not the card being viewed.
    if (facts.outgoing.some((link) => link.id === row.linkId)) {
      removeCardLink(cardId, row.linkId, row.targetCardId, row.type);
    } else {
      removeCardLink(row.targetCardId, row.linkId, cardId, row.type);
    }
  };

  // Only a relation this card would hold can fill *this* card's quota; the
  // reversed ones ("is blocked by") land on the target, checked in `pick`.
  const atCap =
    option.holder === "source" && linkCount(cardId) >= LIMITS.linksPerCard;

  return (
    <div className="space-y-1.5" data-testid="card-links">
      <span className="text-xs font-medium text-muted-foreground">
        {t("card.links.title")}
      </span>

      {groups.length === 0 ? (
        <p
          className="text-sm text-muted-foreground/70"
          data-testid="card-links-empty"
        >
          {t("card.links.empty")}
        </p>
      ) : (
        <div className="space-y-2">
          {groups.map((group) => (
            <div key={group.key} className="space-y-1">
              <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground/70">
                {t(`card.links.type.${group.key}`)}
              </p>
              <ul className="space-y-1">
                {group.rows.map((row) => {
                  const target = board.cards[row.targetCardId];
                  return (
                    <li
                      key={row.linkId}
                      className="group/row flex items-center gap-1.5"
                      data-testid="card-link-row"
                      data-link-type={row.type}
                    >
                      {/* A real anchor: middle-click / Cmd+click open the
                        card in a new tab; the plain left click stays an
                        SPA swap of the `?card=` deep link. Dangling rows
                        have nowhere to navigate — a muted span instead. */}
                      {row.live ? (
                        <a
                          href={`${routes.board(board.id)}?card=${row.targetCardId}`}
                          className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-sm text-foreground/90 transition-colors hover:bg-hover"
                          onClick={(event) => {
                            if (
                              event.button !== 0 ||
                              event.metaKey ||
                              event.ctrlKey
                            ) {
                              return;
                            }
                            event.preventDefault();
                            openCard(row.targetCardId);
                          }}
                          data-testid="card-link-open"
                          title={target?.title}
                        >
                          <ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                          <span className="truncate">{row.title}</span>
                        </a>
                      ) : (
                        <span
                          aria-disabled="true"
                          className="flex min-w-0 flex-1 cursor-default items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-sm text-muted-foreground/70"
                          data-testid="card-link-open"
                        >
                          <ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                          {/* A row with no target reads its own label
                            ("Deleted card") and sits in the dangling
                            group, so it needs no extra tag here. */}
                          <span className="truncate">{row.title}</span>
                        </span>
                      )}
                      {!readOnly ? (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button
                              type="button"
                              aria-label={t("card.links.remove")}
                              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:bg-danger/10 hover:text-danger focus-visible:opacity-100 group-hover/row:opacity-100"
                              data-testid="card-link-remove"
                              onClick={() => remove(row)}
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          </TooltipTrigger>
                          <TooltipContent>
                            {t("card.links.remove")}
                          </TooltipContent>
                        </Tooltip>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      )}

      {!readOnly ? (
        <div className="flex items-center gap-1.5">
          <DropdownPicker
            value={option}
            onChange={(next) => {
              setOption(next);
              inputRef.current?.focus();
            }}
          />
          <div className="relative min-w-0 flex-1">
            <Input
              ref={inputRef}
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setCursor(0);
              }}
              onKeyDown={handleKeyDown}
              disabled={atCap}
              placeholder={t("card.links.searchPlaceholder")}
              aria-label={t("card.links.searchAria")}
              role="combobox"
              aria-expanded={suggestions.length > 0}
              aria-controls={listId}
              aria-autocomplete="list"
              className="h-8 text-sm"
              data-testid="card-links-input"
            />
            {suggestions.length > 0 ? (
              <ul
                id={listId}
                role="listbox"
                className="absolute z-30 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-lg"
                data-testid="card-links-suggestions"
              >
                {suggestions.map((hit, index) => (
                  <li key={hit.id} role="presentation">
                    <button
                      type="button"
                      role="option"
                      aria-selected={index === cursor}
                      className={cn(
                        "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm",
                        index === cursor
                          ? "bg-primary/10 text-primary"
                          : "hover:bg-hover",
                      )}
                      onMouseEnter={() => setCursor(index)}
                      data-testid="card-links-suggestion"
                      onClick={() => pick(hit)}
                    >
                      <Link2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <HighlightedTitle title={hit.title} query={query} />
                      <span className="ml-auto flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground/70">
                        <ColumnChip cardId={hit.id} board={board} />
                        {index === cursor ? (
                          <CornerDownLeft className="h-3 w-3" />
                        ) : null}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );

  function openCard(targetCardId: string) {
    const next = new URLSearchParams(searchParams);
    next.set("card", targetCardId);
    setSearchParams(next);
  }
}

/** Column name chip in a suggestion row (the "where is it" hint). */
function ColumnChip({ cardId, board }: { cardId: string; board: Board }) {
  const { t } = useI18n();
  const column = board.columns.find((col) => col.cardIds.includes(cardId));
  if (!column) return <span>{t("archive.title")}</span>;
  return <span className="max-w-24 truncate">{column.title}</span>;
}

function HighlightedTitle({ title, query }: { title: string; query?: string }) {
  if (!query?.trim()) return <span className="truncate">{title}</span>;
  return (
    <span className="truncate">
      {splitHighlight(title, query).map((segment, index) =>
        typeof segment === "string" ? (
          <span key={index}>{segment}</span>
        ) : (
          <mark key={index} className="rounded-sm bg-primary/20">
            {segment.text}
          </mark>
        ),
      )}
    </span>
  );
}

/**
 * The relation picker — a compact dropdown whose trigger shows the chosen
 * phrasing ("blocks", "is blocked by", …) like Jira's left-hand select of
 * the link dialog.
 */
function DropdownPicker({
  value,
  onChange,
}: {
  value: (typeof LINK_TYPE_OPTIONS)[number];
  onChange: (next: (typeof LINK_TYPE_OPTIONS)[number]) => void;
}) {
  const { t } = useI18n();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 max-w-36"
          data-testid="card-links-type"
        >
          <span className="truncate">
            {t(`card.links.type.${value.option}`)}
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-52">
        <DropdownMenuLabel>{t("card.links.typeAria")}</DropdownMenuLabel>
        {LINK_TYPE_OPTIONS.map((entry) => (
          <DropdownMenuItem
            key={entry.option}
            className={cn(
              entry.option === value.option &&
                "bg-primary/10 font-medium text-primary",
            )}
            data-testid={`card-links-type-${entry.option}`}
            onSelect={() => onChange(entry)}
          >
            {entry.option === value.option ? "✓ " : ""}
            {t(`card.links.type.${entry.option}`)}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
