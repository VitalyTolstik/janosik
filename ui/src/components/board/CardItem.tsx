import { AlignLeft, Archive, Check, CopyPlus, ListTodo, X } from "lucide-react";
import { memo, useEffect, useRef, useState, type KeyboardEvent } from "react";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { CardContextMenu } from "@/components/board/CardContextMenu";
import { DueBadge } from "@/components/board/DueBadge";
import { LinkedCardsPopover } from "@/components/board/LinkedCardsPopover";
import { PriorityBadge } from "@/components/board/PriorityBadge";
import { DEFAULT_CARD_PRIORITY } from "@janosik/shared";
import { useOpenProfile } from "@/components/board/UserProfileDialog";
import { Checkbox } from "@/components/ui/checkbox";
import { HighlightedText } from "@/components/ui/highlight";
import { UserAvatar } from "@/components/ui/user-avatar";
import { useAuth } from "@/auth/AuthContext";
import { cn } from "@/lib/utils";
import { cardChecklistProgress, cardHasDescription } from "@/store/read-model";
import { useI18n } from "@/i18n";
import { useBoardMember, useEntityAttribution } from "@/store/board-live";
import { checklistMatch, descriptionSnippet } from "@/utils/filter";
import {
  cardHref,
  openCardInNewTab,
  shouldLeaveToBrowser,
} from "@/utils/card-nav";
import { userAvatarVar, userInitials, userLabel } from "@/utils/avatar";
import type { CardLinkFacts } from "@/utils/links";
import {
  LABEL_COLOR_CHIP,
  LABEL_COLOR_DOT,
  coverBackground,
  type Card,
  type Label,
} from "@janosik/shared";

export interface CardEpicChip {
  code: string;
  title: string;
  completed: boolean;
}

function EpicChip({ code, title, completed }: CardEpicChip) {
  return (
    <span
      data-testid="card-epic-chip"
      title={title}
      className={cn(
        "shrink-0 rounded border px-1 text-ui-micro font-semibold",
        completed
          ? "border-border bg-muted text-muted-foreground"
          : "border-(--epic-border) bg-(--epic-surface) text-(--epic-ink)",
      )}
    >
      {code}
    </span>
  );
}

interface CardItemProps {
  epicChip?: CardEpicChip;
  card: Card;
  /**
   * The board id — the assignee badge (TASK-49) resolves the member's
   * avatar through the member directory. A primitive prop on purpose: the
   * memoized face must not subscribe to board state (TASK-21.4).
   */
  boardId?: string;
  /** Labels resolved from the board — the card can carry several. */
  labels: Label[];
  /** True while the card is being dragged (hides the source copy). */
  isDragging?: boolean;
  /**
   * Active search/filter query — title matches are highlighted in place;
   * when only the description matched, the description badge lights up
   * with a snippet tooltip.
   */
  highlight?: string;
  /** True when this card holds the j/k keyboard cursor (focus ring). */
  isCursor?: boolean;
  /**
   * Jira-style link facts (TASK-46): the full facts for the linked-cards
   * popover (degree for the badge number, blocked for the red marker, and
   * the rows themselves). Computed once per board change by the caller
   * (WeakMap-cached index) so this memoized component stays free of board
   * subscriptions; the popover itself subscribes only while open.
   */
  linkFacts?: CardLinkFacts;
  /**
   * Fired on click — opens the card detail dialog. The card id is passed
   * back so the parent can keep one stable handler for the whole column
   * instead of a fresh closure per card (TASK-21.4).
   */
  onClick?: (cardId: string) => void;
  /** Fired by the hover duplicate button — the dialog stays closed. */
  onDuplicate?: (cardId: string) => void;
  /** Fired by the hover archive button (TASK-18.1) — the dialog stays closed. */
  onArchive?: (cardId: string) => void;
  /** Blocks the hover duplicate (the card's column cannot take a copy). */
  duplicateDisabled?: boolean;
  /** Tooltip text shown while `duplicateDisabled`. */
  duplicateDisabledReason?: string;
  /**
   * Compact face (TASK-142): one line — title, label dots, blocked marker,
   * checklist progress, priority and the assignee. Hover quick actions and
   * the description/due/label chips move behind the click when the board is
   * being watched instead of edited. Also skips the per-card ResizeObserver
   * the truncated full-face title needs.
   */
  compact?: boolean;
  /**
   * VIEWER mode (TASK-35): the right-click context menu keeps only the
   * read-only actions (open, copy link, new tab).
   */
  readOnly?: boolean;
  /** True while the card is part of a bulk selection. */
  selected?: boolean;
  /** Checkbox mode: a plain click toggles the selection. */
  selectionMode?: boolean;
  /** Toggles this card in the bulk selection (shift extends the range). */
  onToggleSelect?: (cardId: string, shiftKey?: boolean) => void;
  /**
   * TASK-200.9: the server filter matched this card's description. A
   * read-model summary has only `descriptionChars`, so only the server can
   * prove that a text hit is in the description rather than a checklist item
   * or a comment.
   */
  descriptionMatch?: boolean;
}

/**
 * True while the title is visually clipped by `line-clamp` (a line or a
 * line's tail is hidden). Mirrors Jira's behaviour: the native `title`
 * tooltip appears only when something is actually hidden — no tooltip
 * noise on short titles.
 */
function useClamped(
  enabled = true,
): [React.RefCallback<HTMLParagraphElement>, boolean] {
  const elRef = useRef<HTMLParagraphElement | null>(null);
  const [clamped, setClamped] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    const el = elRef.current;
    if (!el) return;
    const check = () =>
      setClamped(
        el.scrollWidth > el.clientWidth + 1 ||
          el.scrollHeight > el.clientHeight + 1,
      );
    check();
    // Re-check when the card content reflows (fonts, resize).
    const observer = new ResizeObserver(check);
    observer.observe(el);
    return () => observer.disconnect();
  }, [enabled]);
  const ref: React.RefCallback<HTMLParagraphElement> = (node) => {
    elRef.current = node;
  };
  return [ref, clamped];
}

/** Card ids already shown in this tab (TASK-150, C20). */
const seenCardIds = new Set<string>();

/**
 * A single card inside a column.
 * Hover uses border/shadow changes (no transform) so it stays compatible
 * with the drag layer that @dnd-kit applies on top of it.
 *
 * The face is a fixed-size uniform grid tile (owner's call): every card
 * shares the same width and height regardless of content. Four rows —
 * the title spans two lines and keeps the due badge beside it, the label
 * chips own the third (or the due badge when there are no labels), and
 * the fourth packs the meta badges (description / linked cards /
 * checklists) against the priority and the assignee's avatar. Empty
 * slots keep their space so all cards line up.
 *
 * The description itself is not rendered on the front (Trello-style):
 * a compact badge only signals that the card has one — full text lives
 * in the card dialog.
 */
function CardItemView({
  card,
  epicChip,
  boardId,
  labels,
  isDragging,
  highlight,
  isCursor,
  linkFacts,
  onClick,
  onDuplicate,
  onArchive,
  duplicateDisabled = false,
  duplicateDisabledReason,
  compact = false,
  readOnly = false,
  selected = false,
  selectionMode = false,
  onToggleSelect,
  descriptionMatch,
}: CardItemProps) {
  const [titleRef, titleClamped] = useClamped(!compact);
  // Entry animation only for a card that appears in this tab now (created,
  // moved in, restored). A board load or switch re-mounts everything; running
  // the animation on all 2400 cards is pure render cost (TASK-150, C20).
  const [entering, setEntering] = useState(false);
  useEffect(() => {
    if (seenCardIds.has(card.id)) return;
    seenCardIds.add(card.id);
    setEntering(true);
  }, [card.id]);
  const { t } = useI18n();
  const { user } = useAuth();
  // Attribution (TASK-36): foreign-change highlight only — the "who
  // changed it" avatar footer was retired in TASK-49 (owner's call).
  const attribution = useEntityAttribution(card.id);
  const authorMember = useBoardMember(
    attribution?.boardId,
    attribution?.userId,
  );
  const foreignAuthor =
    attribution !== undefined && attribution.userId !== user?.id
      ? attribution
      : undefined;
  const foreignColor = foreignAuthor
    ? userAvatarVar(foreignAuthor.userId, authorMember?.avatarColor)
    : undefined;
  // Archive uses the board-archive two-step: first click arms the
  // confirmation (✓ / ✗), so a brushed click never archives silently.
  const [confirmArchive, setConfirmArchive] = useState(false);
  // TASK-200.9: summary cards carry counts instead of the description body
  // and checklist rows; detail-loaded cards use the real fields.
  const hasDescription = cardHasDescription(card);
  const { done, total } = cardChecklistProgress(card);

  // Where the highlight query matched: the title renders <mark>s inline;
  // a description-only match lights up the description badge instead
  // (the text itself is not on the front — Trello-style).
  const query = highlight?.trim().toLowerCase() ?? "";
  const titleMatched = query !== "" && card.title.toLowerCase().includes(query);
  const labelMatched =
    query !== "" &&
    card.labelIds.some((id) =>
      labels.some(
        (label) => label.id === id && label.name.toLowerCase().includes(query),
      ),
    );
  const checklistMatched = query !== "" && checklistMatch(card, query) !== null;
  // A summary card carries only `descriptionChars`, never the body, so the
  // face cannot prove a text match happened in the description. The board
  // filter asks the server for the match field (the query can hit a checklist
  // item or a comment instead); local mode and loaded detail keep the old
  // behaviour.
  const descriptionKnown =
    card.readModel === undefined || card.readModel.detailLoaded === true;
  const descriptionOnly =
    query !== "" &&
    !titleMatched &&
    !labelMatched &&
    !checklistMatched &&
    hasDescription &&
    (descriptionKnown || descriptionMatch === true);
  const snippet = descriptionOnly
    ? descriptionSnippet(card.description ?? "", query)
    : null;
  const snippetText = snippet
    ?.map((segment) => (typeof segment === "string" ? segment : segment.text))
    .join("");

  // Due-date badge: overdue (red) / due within 24h (yellow) / later.
  const hasDueDate = typeof card.dueDate === "number";
  // The footer renders the priority at all times — "medium" included
  // (owner's call): the badge doubles as the row's anchor on every card.
  const priority = card.priority ?? DEFAULT_CARD_PRIORITY;

  return (
    <CardContextMenu
      cardId={card.id}
      readOnly={readOnly}
      onOpen={onClick}
      onDuplicate={onDuplicate}
      onArchive={onArchive}
    >
      <article
        onClick={
          onClick || onToggleSelect
            ? (event) => {
                // Checkbox mode turns the whole card into the selection
                // target; Shift extends the range instead of opening a new
                // tab, while Ctrl/Cmd keeps the browser's new-tab gesture.
                if (onToggleSelect && selectionMode) {
                  event.preventDefault();
                  onToggleSelect(card.id, event.shiftKey);
                  return;
                }
                if (!onClick) return;
                if (shouldLeaveToBrowser(event)) {
                  if (boardId) {
                    event.preventDefault();
                    openCardInNewTab(boardId, card.id);
                  }
                  return;
                }
                onClick(card.id);
              }
            : undefined
        }
        onAuxClick={
          onClick && boardId
            ? (event) => {
                // Wheel-click (middle button): the card face is an <article>,
                // so the browser has no href to act on — bridge to the deep
                // link ourselves.
                if (event.button !== 1) return;
                event.preventDefault();
                openCardInNewTab(boardId, card.id);
              }
            : undefined
        }
        // A VIEWER's card has no dnd-kit wrapper (the drag is disabled, and
        // with it the wrapper's `role`/`tabIndex`): the face itself is the
        // keyboard target — Tab reaches it, Enter or Space opens it (a11y).
        {...(readOnly && onClick
          ? {
              role: "button",
              tabIndex: 0,
              onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
                if (event.target !== event.currentTarget) return;
                if (event.key !== "Enter" && event.key !== " ") return;
                event.preventDefault();
                onClick(card.id);
              },
            }
          : {})}
        data-card-cursor={isCursor || undefined}
        data-card-selected={selected || undefined}
        data-card-href={boardId ? cardHref(boardId, card.id) : undefined}
        className={cn(
          "group relative cursor-pointer overflow-hidden rounded-lg border border-border/70 bg-card shadow-sm transition-[border-color,box-shadow] hover:border-primary/40 hover:shadow-md",
          compact
            ? "flex h-12 items-center gap-2 px-3"
            : "flex h-[112px] flex-col gap-1 px-3 py-2",
          epicChip &&
            !epicChip.completed &&
            "border-l-[3px] border-l-(--epic-accent)",
          (selectionMode || selected) && "pl-9 max-lg:pl-12",
          selected &&
            "border-primary/70 bg-primary/5 ring-1 ring-inset ring-primary/40",
          entering && "animate-card-in",
          isDragging && "opacity-40",
          isCursor && "border-primary ring-2 ring-primary/60",
        )}
      >
        {onToggleSelect && (selectionMode || selected) ? (
          <span
            data-testid="card-select"
            className={cn(
              "absolute left-1 z-10 flex h-7 w-7 items-center justify-center max-lg:h-11 max-lg:w-11",
              compact ? "top-1/2 -translate-y-1/2" : "top-1.5",
            )}
            onPointerDown={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              // Only the drag activator keys belong to the checkbox. Escape,
              // Ctrl/⌘+A and the j/k/x cursor must still reach the board.
              if (event.key === " " || event.key === "Enter") {
                event.stopPropagation();
              }
            }}
            onClick={(event) => {
              event.stopPropagation();
              onToggleSelect(card.id, event.shiftKey);
            }}
          >
            <Checkbox
              checked={selected}
              aria-label={
                selected
                  ? t("bulk.deselectCard", { title: card.title })
                  : t("bulk.selectCard", { title: card.title })
              }
              // The unchecked box needs to sit on the card; a selected one
              // must keep the checked `bg-primary` fill, otherwise the white
              // check disappears against the card background.
              className={cn("h-4 w-4", !selected && "bg-card")}
              onCheckedChange={() => undefined}
              onClick={(event) => {
                event.stopPropagation();
                onToggleSelect(card.id, event.shiftKey);
              }}
            />
          </span>
        ) : null}
        {/* Full-face-only chrome: the hover quick actions. The compact face
            keeps them behind the click/dialog. */}
        {!compact ? (
          <>
            {/* Hover duplicate (Trello quick-edit style): a compact icon on the
          second row, visible only while hovered. TASK-177.18 moved it off
          the top-right corner — there it sat on top of the label chips at
          phone width and made them unreadable. Hidden while dragging and
          when there is nowhere to put the copy handler. Disabled when the
          card's column is full — the reducer would refuse the copy.
          Touch devices have no hover: there the button would stay invisible
          yet tappable, so it is removed entirely (`no-hover`) — the card
          dialog owns duplicate/archive on touch. */}
            {onDuplicate && !isDragging && !confirmArchive ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  {/* Positioning and hover-visibility live on the wrapper: a
                disabled button drops pointer events, and the tooltip needs
                an element that still receives them. `top-8` is the due row
                (card padding 8 + title row 20 + gap 4), clear of the labels. */}
                  <span className="no-hover:hidden absolute right-1.5 top-8 z-10 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                    <button
                      type="button"
                      aria-label={t("card.duplicate")}
                      disabled={duplicateDisabled}
                      className="flex h-6 w-6 items-center justify-center rounded-md border border-border/60 bg-card/90 text-muted-foreground shadow-sm backdrop-blur-sm hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
                      onClick={(e) => {
                        // Don't let the click open the card dialog.
                        e.stopPropagation();
                        onDuplicate(card.id);
                      }}
                    >
                      <CopyPlus className="h-3.5 w-3.5" />
                    </button>
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  {duplicateDisabled
                    ? (duplicateDisabledReason ?? t("card.duplicate"))
                    : t("card.duplicate")}
                </TooltipContent>
              </Tooltip>
            ) : null}
            {onArchive && !isDragging ? (
              confirmArchive ? (
                <span
                  data-testid="card-archive-confirm"
                  className="absolute right-1.5 top-8 z-10 flex h-6 items-center gap-0.5 rounded-md border border-border/60 bg-card/95 px-0.5 shadow-sm backdrop-blur-sm"
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    type="button"
                    aria-label={t("card.archiveConfirmYes")}
                    className="flex h-5 w-5 items-center justify-center rounded-md text-(--chip-red) hover:bg-danger/10"
                    onClick={(e) => {
                      e.stopPropagation();
                      setConfirmArchive(false);
                      onArchive(card.id);
                    }}
                  >
                    <Check className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    aria-label={t("card.archiveConfirmCancel")}
                    className="flex h-5 w-5 items-center justify-center rounded-md text-muted-foreground hover:bg-hover"
                    onClick={(e) => {
                      e.stopPropagation();
                      setConfirmArchive(false);
                    }}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </span>
              ) : (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      aria-label={t("card.archive")}
                      data-testid="card-archive"
                      className="no-hover:hidden absolute right-8 top-8 z-10 flex h-6 w-6 items-center justify-center rounded-md border border-border/60 bg-card/90 text-muted-foreground opacity-0 shadow-sm backdrop-blur-sm transition-opacity focus-visible:opacity-100 hover:bg-warning/10 hover:text-(--chip-warning) group-hover:opacity-100"
                      onClick={(e) => {
                        // Don't let the click open the card dialog.
                        e.stopPropagation();
                        setConfirmArchive(true);
                      }}
                    >
                      <Archive className="h-3.5 w-3.5" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>{t("card.archive")}</TooltipContent>
                </Tooltip>
              )
            ) : null}
          </>
        ) : null}
        {compact ? (
          <>
            {/* Compact face (TASK-142): one line, no hover chrome, no
                ResizeObserver. Everything else lives in the dialog, one
                click away — the wall stays readable while a swarm writes. */}
            {card.cover ? (
              <div
                aria-hidden
                data-testid="card-cover"
                data-cover-type={card.cover.type}
                className="absolute inset-y-0 left-0 w-1"
                style={{ background: coverBackground(card.cover) }}
              />
            ) : null}
            <p
              title={card.title}
              data-testid="card-title"
              className="min-w-0 flex-1 truncate text-ui-body leading-5 text-foreground/90 [overflow-wrap:anywhere]"
            >
              <HighlightedText text={card.title} query={highlight ?? ""} />
            </p>
            {labels.length > 0 ? (
              <span
                data-testid="card-labels"
                role="img"
                aria-label={labels.map((label) => label.name).join(", ")}
                className="flex shrink-0 items-center gap-1"
              >
                {labels.slice(0, 3).map((label) => (
                  <span
                    key={label.id}
                    aria-hidden
                    title={label.name}
                    className={cn(
                      "h-2 w-2 rounded-full",
                      LABEL_COLOR_DOT[label.color],
                    )}
                  />
                ))}
              </span>
            ) : null}
            {linkFacts?.blocked ? (
              <span
                data-testid="card-blocked"
                role="img"
                aria-label={t("card.links.blockedBadge")}
                title={t("card.links.blockedTooltip")}
                className="h-2 w-2 shrink-0 rounded-full bg-danger"
              />
            ) : null}
            {total > 0 ? (
              <span
                data-testid="card-checklist-badge"
                title={t("checklist.badgeTooltip", { done, total })}
                className={cn(
                  "shrink-0 text-ui-micro font-medium tabular-nums",
                  done === total
                    ? "text-(--chip-green)"
                    : "text-muted-foreground",
                )}
              >
                {done}/{total}
              </span>
            ) : null}
            {epicChip ? <EpicChip {...epicChip} /> : null}
            <PriorityBadge priority={priority} />
            {card.assigneeId ? (
              <AssigneeBadge assigneeId={card.assigneeId} boardId={boardId} />
            ) : null}
            {/* Foreign-change dot only — the animated ring is full-face. */}
            {foreignAuthor ? (
              <span
                aria-hidden="true"
                data-foreign={foreignAuthor.userId}
                className="janosik-foreign-dot pointer-events-none h-1.5 w-1.5 shrink-0 rounded-full"
                style={{ backgroundColor: foreignColor }}
              />
            ) : null}
          </>
        ) : (
          <>
            {/* Cover: a slim top strip — same height for colors and gradients
          (matches the label chip row scale). Absolutely positioned so the
          fixed-height tile never reflows: it just paints the padding band. */}
            {card.cover ? (
              <div
                aria-hidden
                data-testid="card-cover"
                data-cover-type={card.cover.type}
                className="absolute inset-x-0 top-0 h-1.5"
                style={{ background: coverBackground(card.cover) }}
              />
            ) : null}
            {/* First two lines: the title. A labelled card keeps the due badge
          beside it so the label chips get a full-width line of their own;
          unlabelled cards keep the original second due row. */}
            <div className="flex min-h-10 shrink-0 items-start gap-2">
              {/* `overflow-wrap:anywhere` (not just break-words) so a pasted URL
            can't blow out the tile's intrinsic width. The full text stays in
            the accessibility tree and a native `title` tooltip surfaces it,
            only when truncated. */}
              <p
                ref={titleRef}
                title={titleClamped ? card.title : undefined}
                className={cn(
                  "line-clamp-2 break-words text-ui-body leading-5 text-foreground/90 [overflow-wrap:anywhere]",
                  labels.length > 0 ? "min-w-0 flex-1" : "w-3/4 shrink-0",
                )}
                data-testid="card-title"
              >
                <HighlightedText text={card.title} query={highlight ?? ""} />
              </p>
              {labels.length > 0 && hasDueDate ? (
                <DueBadge dueDate={card.dueDate as number} />
              ) : null}
            </div>
            {labels.length > 0 ? (
              <div
                data-testid="card-labels"
                aria-label={labels.map((label) => label.name).join(", ")}
                className="flex h-[19px] shrink-0 flex-wrap content-start items-center gap-1 overflow-hidden"
              >
                {labels.map((label) => (
                  <span
                    key={label.id}
                    title={label.name}
                    className={cn(
                      "inline-flex max-w-full min-w-0 items-center gap-1.5 rounded-full px-1.5 py-0.5 text-ui-micro font-semibold uppercase tracking-wide",
                      LABEL_COLOR_CHIP[label.color],
                    )}
                  >
                    <span
                      className="h-1.5 w-1.5 shrink-0 rounded-full bg-current"
                      aria-hidden
                    />
                    <span className="min-w-0 truncate">{label.name}</span>
                  </span>
                ))}
              </div>
            ) : (
              /* Due row: only the date badge. */
              <div className="flex h-5 shrink-0 items-center overflow-hidden">
                {hasDueDate ? (
                  <DueBadge dueDate={card.dueDate as number} />
                ) : null}
              </div>
            )}
            {/* Last line: meta badges (description presence, linked cards,
          checklist progress) on the left, the priority beside the assignee's
          avatar on the right. No overflow clipping here — the 24px avatar
          was getting shaved by sub-pixel rounding; the card's own clip plus
          the padding absorb any stray pixel. */}
            <div className="mt-auto flex h-7 shrink-0 items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-1.5 overflow-hidden">
                {epicChip ? <EpicChip {...epicChip} /> : null}
                {hasDescription ? (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span
                        className={cn(
                          "inline-flex h-5 shrink-0 items-center rounded-md border px-1.5 text-muted-foreground transition-colors group-hover:border-primary/40 group-hover:text-(--tab-text)",
                          descriptionOnly &&
                            "border-primary/40 bg-primary/10 text-(--tab-text)",
                        )}
                        data-testid="card-description-badge"
                        {...(descriptionOnly
                          ? { "data-highlight": "description" }
                          : {})}
                      >
                        <AlignLeft className="h-3.5 w-3.5" aria-hidden />
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>
                      {descriptionOnly && snippetText
                        ? snippetText
                        : t("card.hasDescription")}
                    </TooltipContent>
                  </Tooltip>
                ) : null}
                {/* Linked-cards badges (TASK-46): both the red blocker icon
              and the link count open the linked-cards popover instead of
              bubbling into the card dialog. The blocker is icon-only on the
              card face so the meta row does not crowd the priority. */}
                {linkFacts ? (
                  <LinkedCardsPopover
                    boardId={boardId}
                    cardId={card.id}
                    facts={linkFacts}
                  />
                ) : null}
                {total > 0 ? (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span
                        className={cn(
                          "inline-flex h-5 shrink-0 items-center gap-1 rounded-md border px-1.5 text-ui-micro font-medium tabular-nums transition-colors",
                          done === total
                            ? "border-success/40 bg-success/10 text-(--chip-green)"
                            : "border-border/60 bg-muted/50 text-muted-foreground group-hover:border-primary/40 group-hover:text-(--tab-text)",
                        )}
                        data-testid="card-checklist-badge"
                      >
                        <ListTodo className="h-3.5 w-3.5" aria-hidden />
                        {done}/{total}
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>
                      {t("checklist.badgeTooltip", { done, total })}
                    </TooltipContent>
                  </Tooltip>
                ) : null}
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <PriorityBadge priority={priority} />
                {card.assigneeId ? (
                  <AssigneeBadge
                    assigneeId={card.assigneeId}
                    boardId={boardId}
                  />
                ) : null}
              </div>
            </div>
            {/* Foreign-change highlight (TASK-36): a soft ring in the author's own
          color for two seconds, or — under reduced motion — a static dot
          badge instead of the animated ring. */}
            {foreignAuthor?.highlight ? (
              <span
                aria-hidden="true"
                data-foreign={foreignAuthor.userId}
                style={
                  {
                    "--janosik-foreign-color": foreignColor,
                  } as React.CSSProperties
                }
              >
                <span
                  className="janosik-foreign-ring pointer-events-none absolute inset-0 rounded-lg"
                  style={{
                    boxShadow: `inset 0 0 0 2px color-mix(in srgb, ${foreignColor} 65%, transparent)`,
                  }}
                />
                <span
                  className="janosik-foreign-dot pointer-events-none absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full"
                  style={{ backgroundColor: foreignColor }}
                />
              </span>
            ) : null}
          </>
        )}
      </article>
    </CardContextMenu>
  );
}

/**
 * Memoized: a column re-renders on every board change (a keystroke in
 * another card, a drag, a filter), and without this every card in view
 * would re-render with it. The props are stable by construction — `card`
 * comes straight from the store, `labels` from `useCardLabels`, and the
 * handlers take the card id so they can be hoisted (TASK-21.4).
 */
export const CardItem = memo(CardItemView);

/**
 * The assignee's avatar in the card face's footer row (TASK-49, reworked
 * to a fixed-size tile). Resolves display data from the member directory.
 * TASK-180.2 L35: a removed/expired assignee is "Unassigned" in the card
 * dialog, so the face must not keep showing an initials avatar for an id the
 * roster no longer contains. The id survives in the aggregate; the badge
 * simply renders nothing until a current member owns it.
 */
function AssigneeBadge({
  assigneeId,
  boardId,
}: {
  assigneeId: string;
  boardId?: string;
}) {
  const { t } = useI18n();
  const openProfile = useOpenProfile();
  const member = useBoardMember(boardId, assigneeId);
  if (member === undefined) return null;
  const name = userLabel(member.displayName, member.email);
  const initials = userInitials(member.displayName, member.email);
  const assignedLabel = t("card.assignee.assignedTo", { name });

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          data-testid="card-assignee"
          aria-label={`${assignedLabel} ${initials}`}
          onClick={(event) => {
            // Don't let the click open the card dialog.
            event.stopPropagation();
            openProfile(assigneeId);
          }}
          className="relative shrink-0 rounded-full transition-transform after:absolute after:-inset-2.5 after:content-[''] hover:scale-110"
        >
          {/* The initials are decorative; the button name is "Assigned to…". */}
          <span aria-hidden="true" className="inline-flex">
            <UserAvatar
              userId={member?.userId ?? assigneeId}
              displayName={member?.displayName ?? null}
              email={member?.email ?? ""}
              color={member?.avatarColor}
              avatarPath={member?.avatarPath}
              size="sm"
            />
          </span>
        </button>
      </TooltipTrigger>
      <TooltipContent>{assignedLabel}</TooltipContent>
    </Tooltip>
  );
}
