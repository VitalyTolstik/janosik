import { Ban, Link2 } from "lucide-react";
import { useState } from "react";
import { useSearchParams } from "react-router-dom";

import { PriorityBadge } from "@/components/board/PriorityBadge";
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
import { UserAvatar } from "@/components/ui/user-avatar";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import { useBoardState } from "@/store/BoardContext";
import { useBoardMember } from "@/store/board-live";
import { routes } from "@/routes";
import { linkRowGroups, type CardLinkFacts, type LinkRow } from "@/utils/links";

interface LinkedCardsPopoverProps {
  /** Resolves the assignee's avatar through the member directory. */
  boardId?: string;
  /** Full facts from the WeakMap-cached link index (stable identity). */
  facts: CardLinkFacts;
}

/**
 * The linked-cards list behind the card-front badges (Jira's linked-issues
 * widget): clicking the "N links" count or the red "Blocked" badge opens a
 * popover with one row per relation — grouped by how it reads from this
 * card, each row carrying the linked card's title, column (its status),
 * priority and assignee. A row click navigates to that card via the
 * `?card=` deep link, exactly like the dialog section's rows.
 *
 * The badges are triggers, never bubbles: `stopPropagation` keeps the
 * click from opening the host card's dialog (the badge used to open "a
 * random card" — the host itself — instead of anything link-related).
 */
export function LinkedCardsPopover({
  boardId,
  facts,
}: LinkedCardsPopoverProps) {
  const [open, setOpen] = useState(false);
  if (facts.degree === 0 && !facts.blocked) return null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      {facts.blocked ? <BlockedBadgeTrigger /> : null}
      {facts.degree > 0 ? <CountBadgeTrigger degree={facts.degree} /> : null}
      <LinkedCardsContent
        boardId={boardId}
        facts={facts}
        close={() => setOpen(false)}
      />
    </Popover>
  );
}

/**
 * The red "Blocked" badge — a second trigger into the same list: the
 * blocker is just one of the relations the popover already renders.
 */
function BlockedBadgeTrigger() {
  const { t } = useI18n();
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={t("card.links.blockedTooltip")}
            data-testid="card-blocked-badge"
            className="inline-flex h-5 items-center gap-1 rounded-md border border-danger/40 bg-danger/10 px-1.5 text-[11px] font-semibold text-danger transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger/50"
            onClick={(event) => {
              // Don't let the click open the card dialog.
              event.stopPropagation();
            }}
          >
            <Ban className="h-3 w-3" aria-hidden />
            {t("card.links.blockedBadge")}
          </button>
        </PopoverTrigger>
      </TooltipTrigger>
      <TooltipContent>{t("card.links.blockedTooltip")}</TooltipContent>
    </Tooltip>
  );
}

function CountBadgeTrigger({ degree }: { degree: number }) {
  const { t } = useI18n();
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={t("card.links.badgeTooltip", { count: degree })}
            data-testid="card-links-badge"
            className="inline-flex h-5 items-center gap-1 rounded-md border border-border/60 bg-muted/50 px-1.5 text-[11px] font-medium tabular-nums text-muted-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 group-hover:border-primary/40 group-hover:text-primary"
            onClick={(event) => {
              // Don't let the click open the card dialog.
              event.stopPropagation();
            }}
          >
            <Link2 className="h-3.5 w-3.5" aria-hidden />
            {degree}
          </button>
        </PopoverTrigger>
      </TooltipTrigger>
      <TooltipContent>
        {t("card.links.badgeTooltip", { count: degree })}
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * The popover body. Subscribes to the board store only while open — the
 * memoized card face (TASK-21.4) never sees board edits through it, the
 * popover costs one subscription for the moment it exists.
 */
function LinkedCardsContent({
  boardId,
  facts,
  close,
}: {
  boardId?: string;
  facts: CardLinkFacts;
  close: () => void;
}) {
  const { t } = useI18n();
  const { board } = useBoardState();
  const [searchParams, setSearchParams] = useSearchParams();
  if (!board) return null;

  // A linked card's "status" (Jira shows the status in the same spot) is
  // the column it sits in — one lookup map for the whole popover.
  const columnTitles = new Map<string, string>();
  for (const column of board.columns) {
    for (const id of column.cardIds) columnTitles.set(id, column.title);
  }
  const groups = linkRowGroups(board.cards, facts, t("card.links.deletedCard"));

  const openCard = (targetCardId: string) => {
    const next = new URLSearchParams(searchParams);
    next.set("card", targetCardId);
    setSearchParams(next);
    close();
  };

  return (
    <PopoverContent
      align="start"
      className="w-72 p-2"
      data-testid="card-links-popover"
      /* React events bubble through the React tree — and the portaled
         content is still a child of the card's <article onClick> there.
         Without this, every row click ALSO fired the host card's dialog,
         whose handler ran last and re-pointed ?card= back at the host
         (the "random card" bug). */
      onClick={(event) => event.stopPropagation()}
    >
      <p className="px-1 pb-1 text-xs font-medium text-muted-foreground">
        {t("card.links.title")}
      </p>
      <div className="max-h-64 space-y-1.5 overflow-y-auto">
        {groups.map((group) => (
          <div key={group.key}>
            <p className="px-1 pb-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground/70">
              {t(`card.links.type.${group.key}`)}
            </p>
            <ul className="space-y-0.5">
              {group.rows.map((row) => (
                <LinkedCardRow
                  key={row.linkId}
                  row={row}
                  boardId={boardId}
                  columnTitle={columnTitles.get(row.targetCardId)}
                  onOpen={openCard}
                />
              ))}
            </ul>
          </div>
        ))}
      </div>
    </PopoverContent>
  );
}

/** One linked card: title, column, priority, assignee — Jira's row set. */
function LinkedCardRow({
  row,
  boardId,
  columnTitle,
  onOpen,
}: {
  row: LinkRow;
  boardId?: string;
  columnTitle?: string;
  onOpen: (cardId: string) => void;
}) {
  const { board } = useBoardState();
  const target = board?.cards[row.targetCardId];
  // A real anchor, not a button: the browser's own affordances work —
  // middle-click (wheel click) and Cmd/Ctrl+click open the card in a new
  // tab, because there is a genuine href to navigate to. The left click
  // stays an SPA transition: preventDefault + the `?card=` deep link, so
  // the dialog swaps in place instead of a full page load.
  const boardPath = board ? routes.board(board.id) : "";
  const href = `${boardPath}?card=${row.targetCardId}`;
  return (
    <li>
      <a
        href={row.live ? href : undefined}
        aria-disabled={!row.live}
        title={row.title}
        data-testid="card-link-popover-row"
        data-card-id={row.targetCardId}
        className={cn(
          "flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-sm transition-colors hover:bg-hover focus-visible:bg-hover focus-visible:outline-none",
          !row.live &&
            "pointer-events-none cursor-default text-muted-foreground/70",
          target?.archivedAt !== undefined && "opacity-60",
        )}
        onClick={(event) => {
          // Left click only; modifier clicks keep the browser's behavior
          // (new tab) and default is what the new tab navigates to.
          if (event.button !== 0 || event.metaKey || event.ctrlKey) return;
          event.preventDefault();
          onOpen(row.targetCardId);
        }}
        onAuxClick={(event) => {
          // The popover must not close on a middle-click new-tab open.
          event.stopPropagation();
        }}
      >
        <span className="min-w-0 flex-1 truncate">{row.title}</span>
        {columnTitle ? (
          <span className="max-w-20 shrink-0 truncate text-[11px] text-muted-foreground/70">
            {columnTitle}
          </span>
        ) : null}
        {target?.priority !== undefined ? (
          <PriorityBadge priority={target.priority} />
        ) : null}
        {target?.assigneeId ? (
          <RowAssignee boardId={boardId} userId={target.assigneeId} />
        ) : null}
      </a>
    </li>
  );
}

/** The linked card's assignee, resolved through the member directory. */
function RowAssignee({
  boardId,
  userId,
}: {
  boardId?: string;
  userId: string;
}) {
  const member = useBoardMember(boardId, userId);
  return (
    <UserAvatar
      userId={member?.userId ?? userId}
      displayName={member?.displayName ?? null}
      email={member?.email ?? ""}
      color={member?.avatarColor}
      avatarPath={member?.avatarPath}
      size="xs"
    />
  );
}
