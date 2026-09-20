import {
  AlignLeft,
  Archive,
  Ban,
  Check,
  CopyPlus,
  Link2,
  ListTodo,
  Paperclip,
  X,
} from "lucide-react";
import { memo, useEffect, useRef, useState } from "react";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { DueBadge } from "@/components/board/DueBadge";
import { PriorityBadge } from "@/components/board/PriorityBadge";
import type { CardPriority } from "@janosik/shared";
import { DEFAULT_CARD_PRIORITY } from "@janosik/shared";
import { useOpenProfile } from "@/components/board/UserProfileDialog";
import { HighlightedText } from "@/components/ui/highlight";
import { UserAvatar } from "@/components/ui/user-avatar";
import { useAuth } from "@/auth/AuthContext";
import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n";
import { useBoardMember, useEntityAttribution } from "@/store/board-live";
import { descriptionSnippet } from "@/utils/filter";
import { userAvatarVar, userLabel } from "@/utils/avatar";
import {
  LABEL_COLOR_CHIP,
  coverBackground,
  type Card,
  type Label,
} from "@janosik/shared";

interface CardItemProps {
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
   * Jira-style link facts (TASK-46): total link count for the badge and
   * the red "Blocked" marker for an incoming `blocks` from a live card.
   * Computed once per board change by the caller (WeakMap-cached index)
   * so this memoized component stays free of board subscriptions.
   */
  linkFacts?: { degree: number; blocked: boolean };
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
}

/**
 * True while the title is visually clipped by `line-clamp-3` (scrollHeight
 * exceeds the clamped clientHeight). Mirrors Jira's behaviour: the native
 * `title` tooltip appears only when something is actually hidden — no
 * tooltip noise on short titles.
 */
function useClamped(): [React.RefCallback<HTMLParagraphElement>, boolean] {
  const elRef = useRef<HTMLParagraphElement | null>(null);
  const [clamped, setClamped] = useState(false);
  useEffect(() => {
    const el = elRef.current;
    if (!el) return;
    const check = () => setClamped(el.scrollHeight > el.clientHeight + 1);
    check();
    // Re-check when the card content reflows (fonts, resize, label wrap).
    const observer = new ResizeObserver(check);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const ref: React.RefCallback<HTMLParagraphElement> = (node) => {
    elRef.current = node;
  };
  return [ref, clamped];
}

/**
 * A single card inside a column.
 * Hover uses border/shadow changes (no transform) so it stays compatible
 * with the drag layer that @dnd-kit applies on top of it.
 *
 * The title is clamped to 3 lines (Jira's budget — Linear clips at 1,
 * Trello/Notion don't clamp at all and grow runaway-tall cards). The clip
 * is purely visual: the full text stays in the accessibility tree and a
 * native `title` tooltip surfaces it on hover, only when truncated.
 *
 * The description itself is not rendered on the front (Trello-style):
 * a compact badge only signals that the card has one — full text lives
 * in the card dialog.
 */
function CardItemView({
  card,
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
}: CardItemProps) {
  const [titleRef, titleClamped] = useClamped();
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
  const hasDescription = Boolean(card.description?.trim());
  // Checklist progress summed across all of the card's checklists.
  const items = (card.checklists ?? []).flatMap((c) => c.items);
  const done = items.filter((item) => item.done).length;
  const total = items.length;

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
  const descriptionOnly =
    query !== "" && !titleMatched && !labelMatched && hasDescription;
  const snippet = descriptionOnly
    ? descriptionSnippet(card.description ?? "", query)
    : null;
  const snippetText = snippet
    ?.map((segment) => (typeof segment === "string" ? segment : segment.text))
    .join("");

  // Due-date badge: overdue (red) / due within 24h (yellow) / later.
  const hasDueDate = typeof card.dueDate === "number";
  // The face stays quiet about the default "medium" (TASK-45).
  const hasPriority =
    card.priority !== undefined && card.priority !== DEFAULT_CARD_PRIORITY;
  const hasLinks = (linkFacts?.degree ?? 0) > 0;
  const attachmentCount = card.attachmentCount ?? 0;

  return (
    <article
      onClick={onClick ? () => onClick(card.id) : undefined}
      data-card-cursor={isCursor || undefined}
      className={cn(
        "group animate-card-in relative cursor-pointer overflow-hidden rounded-lg border border-border/70 bg-card px-3 py-2.5 shadow-sm transition-[border-color,box-shadow] hover:border-primary/40 hover:shadow-md",
        isDragging && "opacity-40",
        isCursor && "border-primary ring-2 ring-primary/60",
      )}
    >
      {/* Hover duplicate (Trello quick-edit style): a compact icon in the
          top-right corner, visible only while hovered. Hidden while dragging
          and when there is nowhere to put the copy handler. Disabled when
          the card's column is full — the reducer would refuse the copy.
          Touch devices have no hover: there the button would stay invisible
          yet tappable, so it is removed entirely (`no-hover`) — the card
          dialog owns duplicate/archive on touch. */}
      {onDuplicate && !isDragging && !confirmArchive ? (
        <Tooltip>
          <TooltipTrigger asChild>
            {/* Positioning and hover-visibility live on the wrapper: a
                disabled button drops pointer events, and the tooltip needs
                an element that still receives them. */}
            <span className="no-hover:hidden absolute right-1.5 top-1.5 z-10 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
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
            className="absolute right-1.5 top-1.5 z-10 flex h-6 items-center gap-0.5 rounded-md border border-border/60 bg-card/95 px-0.5 shadow-sm backdrop-blur-sm"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              aria-label={t("card.archiveConfirmYes")}
              className="flex h-5 w-5 items-center justify-center rounded-md text-danger hover:bg-danger/10"
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
                className="no-hover:hidden absolute right-8 top-1.5 z-10 flex h-6 w-6 items-center justify-center rounded-md border border-border/60 bg-card/90 text-muted-foreground opacity-0 shadow-sm backdrop-blur-sm transition-opacity focus-visible:opacity-100 hover:bg-warning/10 hover:text-warning group-hover:opacity-100"
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
      {/* Cover: a slim top strip — same height for colors and gradients
          (matches the label chip row scale). Negative margins bleed it into
          the card padding; the card clips it (overflow-hidden). */}
      {card.cover ? (
        <div
          aria-hidden
          data-testid="card-cover"
          data-cover-type={card.cover.type}
          className="-mx-3 -mt-2.5 mb-2.5 h-1.5 w-[calc(100%+1.5rem)]"
          style={{ background: coverBackground(card.cover) }}
        />
      ) : null}
      {labels.length > 0 ? (
        <div className="mb-1.5 flex flex-wrap items-center gap-1">
          {labels.map((label) => (
            <span
              key={label.id}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                LABEL_COLOR_CHIP[label.color],
              )}
            >
              <span
                className="h-1.5 w-1.5 rounded-full bg-current"
                aria-hidden
              />
              {label.name}
            </span>
          ))}
        </div>
      ) : null}
      {/* `overflow-wrap:anywhere` (not just break-words) so a pasted URL
          can't blow out the card's intrinsic width; `text-wrap:pretty`
          avoids orphan single-word last lines under the clamp. */}
      <p
        ref={titleRef}
        title={titleClamped ? card.title : undefined}
        className="line-clamp-3 break-words text-sm leading-snug text-foreground/90 [overflow-wrap:anywhere] [text-wrap:pretty]"
        data-testid="card-title"
      >
        <HighlightedText text={card.title} query={highlight ?? ""} />
      </p>
      {hasDescription ||
      total > 0 ||
      hasDueDate ||
      hasPriority ||
      hasLinks ||
      attachmentCount > 0 ? (
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          {linkFacts?.blocked ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <span
                  className="inline-flex h-5 items-center gap-1 rounded-md border border-danger/40 bg-danger/10 px-1.5 text-[11px] font-semibold text-danger"
                  data-testid="card-blocked-badge"
                >
                  <Ban className="h-3 w-3" aria-hidden />
                  {t("card.links.blockedBadge")}
                </span>
              </TooltipTrigger>
              <TooltipContent>{t("card.links.blockedTooltip")}</TooltipContent>
            </Tooltip>
          ) : null}
          {hasDueDate ? <DueBadge dueDate={card.dueDate as number} /> : null}
          {hasPriority ? (
            <PriorityBadge priority={card.priority as CardPriority} />
          ) : null}
          {hasLinks ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <span
                  className="inline-flex h-5 items-center gap-1 rounded-md border border-border/60 bg-muted/50 px-1.5 text-[11px] font-medium tabular-nums text-muted-foreground transition-colors group-hover:border-primary/40 group-hover:text-primary"
                  data-testid="card-links-badge"
                >
                  <Link2 className="h-3.5 w-3.5" aria-hidden />
                  {linkFacts?.degree}
                </span>
              </TooltipTrigger>
              <TooltipContent>
                {t("card.links.badgeTooltip", {
                  count: linkFacts?.degree ?? 0,
                })}
              </TooltipContent>
            </Tooltip>
          ) : null}
          {attachmentCount > 0 ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <span
                  className="inline-flex h-5 items-center gap-1 rounded-md border border-border/60 bg-muted/50 px-1.5 text-[11px] font-medium tabular-nums text-muted-foreground transition-colors group-hover:border-primary/40 group-hover:text-primary"
                  data-testid="card-attachments-badge"
                >
                  <Paperclip className="h-3.5 w-3.5" aria-hidden />
                  {attachmentCount}
                </span>
              </TooltipTrigger>
              <TooltipContent>
                {t("card.attachments.badgeTooltip", { count: attachmentCount })}
              </TooltipContent>
            </Tooltip>
          ) : null}
          {total > 0 ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <span
                  className={cn(
                    "inline-flex h-5 items-center gap-1 rounded-md border px-1.5 text-[11px] font-medium tabular-nums transition-colors",
                    done === total
                      ? "border-success/40 bg-success/10 text-success"
                      : "border-border/60 bg-muted/50 text-muted-foreground group-hover:border-primary/40 group-hover:text-primary",
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
          {hasDescription ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <span
                  className={cn(
                    "inline-flex h-5 items-center rounded-md border px-1.5 text-muted-foreground transition-colors group-hover:border-primary/40 group-hover:text-primary",
                    descriptionOnly &&
                      "border-primary/40 bg-primary/10 text-primary",
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
        </div>
      ) : null}
      {/* Assignee (TASK-49): Jira puts the assignee's avatar in the card's
          bottom-right corner — visible without opening the card, opening the
          profile on click like the other identity chips. The member
          directory (not the board JSON) owns the display data. */}
      {card.assigneeId ? (
        <AssigneeBadge assigneeId={card.assigneeId} boardId={boardId} />
      ) : null}
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
    </article>
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
 * The assignee's avatar in the card face's bottom-right corner (TASK-49).
 * Resolves display data from the member directory; falls back to initials
 * when the assignee has left the board (the id survives in the aggregate).
 * Rendered only when the card is assigned — the face stays quiet otherwise.
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
  const name = userLabel(member?.displayName ?? null, member?.email ?? "");

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          data-testid="card-assignee"
          aria-label={t("card.assignee.assignedTo", { name })}
          onClick={(event) => {
            // Don't let the click open the card dialog.
            event.stopPropagation();
            openProfile(assigneeId);
          }}
          className="absolute bottom-2 right-2 z-10 rounded-full transition-transform hover:scale-110"
        >
          <UserAvatar
            userId={member?.userId ?? assigneeId}
            displayName={member?.displayName ?? null}
            email={member?.email ?? ""}
            color={member?.avatarColor}
            avatarPath={member?.avatarPath}
            size="sm"
          />
        </button>
      </TooltipTrigger>
      <TooltipContent>{t("card.assignee.assignedTo", { name })}</TooltipContent>
    </Tooltip>
  );
}
