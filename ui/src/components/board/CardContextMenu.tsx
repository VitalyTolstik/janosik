import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactElement,
} from "react";
import {
  Archive,
  ArrowUpRight,
  CalendarClock,
  Check,
  CircleUserRound,
  CopyPlus,
  Link2,
  ListChecks,
  MessageSquare,
  Palette,
  Search,
  SquarePen,
  Tag,
  UserRound,
} from "lucide-react";
import type {
  Card,
  CardCover,
  CardPriority,
  LabelColor,
} from "@janosik/shared";
import {
  COVER_COLORS,
  COVER_COLOR_CSS,
  COVER_GRADIENTS,
  COVER_GRADIENT_CSS,
  DEFAULT_CARD_PRIORITY,
  LABEL_COLORS,
  LABEL_COLOR_CHIP,
  LABEL_COLOR_DOT,
  LIMITS,
} from "@janosik/shared";

import { api, isApiEnabled } from "@/api/client";
import { appShareUrl } from "@/utils/app-path";
import { useAuth } from "@/auth/AuthContext";
import {
  COVER_COLOR_KEYS,
  COVER_GRADIENT_KEYS,
  LABEL_COLOR_KEYS,
} from "@/utils/palette-keys";
import { DueDatePickerContent } from "@/components/board/CardDueDate";
import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Input } from "@/components/ui/input";
import { UserAvatar } from "@/components/ui/user-avatar";
import { useToast } from "@/components/Toast";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import { useBoardActions, useBoardState } from "@/store/BoardContext";
import { useBoardMembersList } from "@/store/board-live";
import { userLabel } from "@/utils/avatar";
import { cardHref } from "@/utils/card-nav";
import { PRIORITY_META, PRIORITY_ORDER } from "@/utils/priority";
import {
  LINK_TYPE_OPTIONS,
  suggestLinkTargets,
  wouldCreateCycle,
} from "@/utils/links";
import { createId } from "@/utils/id";

/**
 * Right-click (mouse button 2) menu for a card, on every surface that shows
 * one: the board face, the calendar (date chips, the unscheduled list,
 * day-panel rows) and the table rows. The menu carries the card's quick
 * editors — labels, due date, priority, assignee, link card, cover,
 * checklist, comment — plus open / copy-link / new-tab / duplicate / archive.
 *
 * The trigger is the caller's element passed through Base UI's `render` prop,
 * so no extra DOM wraps it. The body mounts only while the menu is open
 * (Base UI unmounts the popup when closed), which keeps the memoized card
 * faces (TASK-21.4) free of board subscriptions.
 */
export interface CardContextMenuProps {
  cardId: string;
  /** The element the menu opens from — rendered as-is, right-click attached. */
  children: ReactElement;
  /** VIEWER mode (TASK-35): only the read-only actions stay in the menu. */
  readOnly?: boolean;
  /** Opens the card dialog — the "Open card" item. */
  onOpen?: (cardId: string) => void;
  /** The hover duplicate button's handler — absent for viewers/full columns. */
  onDuplicate?: (cardId: string) => void;
  /** The hover archive button's handler — absent for viewers. */
  onArchive?: (cardId: string) => void;
}

export function CardContextMenu({
  cardId,
  children,
  readOnly = false,
  onOpen,
  onDuplicate,
  onArchive,
}: CardContextMenuProps) {
  const [open, setOpen] = useState(false);
  return (
    <ContextMenu open={open} onOpenChange={setOpen}>
      <ContextMenuTrigger render={children} />
      <ContextMenuContent data-testid="card-context-menu">
        <CardContextMenuBody
          cardId={cardId}
          readOnly={readOnly}
          onOpen={onOpen}
          onDuplicate={onDuplicate}
          onArchive={onArchive}
          close={() => setOpen(false)}
        />
      </ContextMenuContent>
    </ContextMenu>
  );
}

/**
 * Keys typed inside the menu's own inputs must not reach the popup —
 * the menu's typeahead and arrow-key navigation would eat them. Escape
 * keeps bubbling so the menu still closes.
 */
function stopInputKeys(event: ReactKeyboardEvent) {
  if (event.key === "Escape") return;
  event.stopPropagation();
}

function CardContextMenuBody({
  cardId,
  readOnly,
  onOpen,
  onDuplicate,
  onArchive,
  close,
}: Omit<CardContextMenuProps, "children"> & { close: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const { board } = useBoardState();
  const {
    toggleCardLabel,
    addLabel,
    setCardPriority,
    setCardAssign,
    addCardLink,
    setCardCover,
    addChecklist,
    addChecklistItem,
    toggleChecklistItem,
  } = useBoardActions();

  const [linkQuery, setLinkQuery] = useState("");
  const [linkOption, setLinkOption] = useState(LINK_TYPE_OPTIONS[0]);
  const linkTargets = useMemo(
    () => suggestLinkTargets(board?.cards ?? {}, cardId, linkQuery),
    [board?.cards, cardId, linkQuery],
  );

  const copyLink = useCallback(() => {
    if (!board) return;
    const url = appShareUrl(cardHref(board.id, cardId));
    void navigator.clipboard
      ?.writeText(url)
      .then(() => toast.success(t("card.linkCopied")));
  }, [board, cardId, toast, t]);

  if (!board) return null;
  const card = board.cards[cardId];
  if (!card) return null;

  const boardId = board.id;

  const linkPick = (target: Card) => {
    const option = linkOption ?? LINK_TYPE_OPTIONS[0];
    // "is blocked by X" stores the row on X — the holder (and its cap and
    // cycle check) is the target, mirroring CardLinks (TASK-46).
    const [holderId, otherId] =
      option.holder === "source" ? [cardId, target.id] : [target.id, cardId];
    if ((card.links?.length ?? 0) >= LIMITS.linksPerCard) {
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
    setLinkQuery("");
  };

  const toggleLabel = (labelId: string, checked: boolean) => {
    if (checked && card.labelIds.length >= LIMITS.labelsPerCard) {
      toast.error(t("limits.maxLabelsOnCard", { limit: LIMITS.labelsPerCard }));
      return;
    }
    toggleCardLabel(cardId, labelId);
  };

  const columnTitleOf = (id: string) =>
    board.columns.find((column) => column.cardIds.includes(id))?.title;

  return (
    <>
      {onOpen ? (
        <ContextMenuItem onClick={() => onOpen(cardId)} data-testid="ctx-open">
          <SquarePen />
          {t("card.menu.open")}
        </ContextMenuItem>
      ) : null}

      {!readOnly ? (
        <>
          {onOpen ? <ContextMenuSeparator /> : null}
          <LabelsSub
            card={card}
            labels={board.labels}
            onToggle={toggleLabel}
            onCreate={(name, color) => {
              const label = { id: createId(), name, color };
              addLabel(label);
              toggleCardLabel(cardId, label.id);
            }}
          />
          <DueSub cardId={cardId} dueDate={card.dueDate} />
          <PrioritySub
            priority={card.priority}
            onPick={(priority) => setCardPriority(cardId, priority)}
          />
          <AssigneeSub
            boardId={boardId}
            assigneeId={card.assigneeId}
            onPick={(userId) => setCardAssign(cardId, userId)}
          />
          <ContextMenuSub>
            <ContextMenuSubTrigger data-testid="ctx-link-trigger">
              <Link2 />
              {t("card.menu.linkCard")}
            </ContextMenuSubTrigger>
            <ContextMenuSubContent
              className="w-64 p-0"
              data-testid="ctx-link-content"
            >
              <div className="flex flex-wrap gap-1 border-b border-border/60 p-2">
                {LINK_TYPE_OPTIONS.map((entry) => (
                  <button
                    key={entry.option}
                    type="button"
                    data-testid={`ctx-link-type-${entry.option}`}
                    onClick={() => setLinkOption(entry)}
                    className={cn(
                      "rounded-full border px-2 py-0.5 text-[11px] leading-tight transition-colors",
                      linkOption?.option === entry.option
                        ? "border-primary/60 bg-primary/10 text-foreground"
                        : "border-border/60 text-muted-foreground hover:bg-muted/60",
                    )}
                  >
                    {t(`card.links.type.${entry.option}`)}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-2 border-b border-border/60 px-3 py-2">
                <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <input
                  value={linkQuery}
                  onChange={(event) => setLinkQuery(event.target.value)}
                  onKeyDown={stopInputKeys}
                  placeholder={t("card.links.searchPlaceholder")}
                  aria-label={t("card.links.searchAria")}
                  maxLength={LIMITS.cardTitle}
                  data-testid="ctx-link-search"
                  className="h-6 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                />
              </div>
              <div className="max-h-52 overflow-y-auto p-1">
                {linkTargets.map((target) => (
                  <ContextMenuItem
                    key={target.id}
                    onClick={() => linkPick(target)}
                    data-testid={`ctx-link-target-${target.id}`}
                  >
                    <span className="min-w-0 flex-1 truncate">
                      {target.title}
                    </span>
                    <span className="shrink-0 text-[10px] text-muted-foreground">
                      {columnTitleOf(target.id)}
                    </span>
                  </ContextMenuItem>
                ))}
                {linkQuery.trim() !== "" && linkTargets.length === 0 ? (
                  <p className="px-2 py-1.5 text-xs text-muted-foreground">
                    {t("card.links.empty")}
                  </p>
                ) : null}
              </div>
            </ContextMenuSubContent>
          </ContextMenuSub>
          <CoverSub
            cover={card.cover}
            onPick={(cover) => setCardCover(cardId, cover)}
            onRemove={() => setCardCover(cardId, undefined)}
          />
          <ChecklistSub
            checklists={card.checklists ?? []}
            onAddChecklist={(title) => addChecklist(cardId, title)}
            onAddItem={(checklistId, text) =>
              addChecklistItem(cardId, checklistId, text)
            }
            onToggleItem={(checklistId, itemId) =>
              toggleChecklistItem(cardId, checklistId, itemId)
            }
          />
          <CommentSub cardId={cardId} onSent={close} />
        </>
      ) : null}

      <ContextMenuSeparator />
      <ContextMenuItem onClick={copyLink} data-testid="ctx-copy-link">
        {/* Jira-style: the chain link is tilted, not horizontal. */}
        <Link2 className="-rotate-45" />
        {t("card.copyLink")}
      </ContextMenuItem>
      <ContextMenuItem
        onClick={() =>
          window.open(
            appShareUrl(cardHref(boardId, cardId)),
            "_blank",
            "noopener,noreferrer",
          )
        }
        data-testid="ctx-open-new-tab"
      >
        <ArrowUpRight />
        {t("card.menu.openNewTab")}
      </ContextMenuItem>

      {!readOnly && (onDuplicate || onArchive) ? (
        <ContextMenuSeparator />
      ) : null}
      {onDuplicate && !readOnly ? (
        <ContextMenuItem
          onClick={() => onDuplicate(cardId)}
          data-testid="ctx-duplicate"
        >
          <CopyPlus />
          {t("card.duplicate")}
        </ContextMenuItem>
      ) : null}
      {onArchive && !readOnly ? (
        <ContextMenuItem
          variant="destructive"
          onClick={() => onArchive(cardId)}
          data-testid="ctx-archive"
        >
          <Archive />
          {t("card.archive")}
        </ContextMenuItem>
      ) : null}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Labels                                                              */
/* ------------------------------------------------------------------ */

function LabelsSub({
  card,
  labels,
  onToggle,
  onCreate,
}: {
  card: Card;
  labels: { id: string; name: string; color: LabelColor }[];
  onToggle: (labelId: string, checked: boolean) => void;
  onCreate: (name: string, color: LabelColor) => void;
}) {
  const { t } = useI18n();
  const [name, setName] = useState("");
  const [color, setColor] = useState<LabelColor>("green");
  const inputRef = useRef<HTMLInputElement>(null);

  const create = () => {
    const trimmed = name.trim();
    if (!trimmed) {
      inputRef.current?.focus();
      return;
    }
    onCreate(trimmed, color);
    setName("");
    setColor("green");
  };

  return (
    <ContextMenuSub>
      <ContextMenuSubTrigger data-testid="ctx-labels-trigger">
        <Tag />
        {t("card.menu.labels")}
        {card.labelIds.length > 0 ? (
          <span className="ml-auto mr-1 rounded-full bg-muted px-1.5 text-[10px] font-medium text-muted-foreground">
            {card.labelIds.length}
          </span>
        ) : null}
      </ContextMenuSubTrigger>
      <ContextMenuSubContent className="w-56" data-testid="ctx-labels-content">
        {labels.map((label) => (
          <ContextMenuCheckboxItem
            key={label.id}
            checked={card.labelIds.includes(label.id)}
            onCheckedChange={(checked) => onToggle(label.id, checked === true)}
            data-testid={`ctx-label-${label.id}`}
          >
            <span
              className={cn(
                "size-2.5 shrink-0 rounded-full",
                LABEL_COLOR_DOT[label.color],
              )}
              aria-hidden
            />
            <span className="min-w-0 flex-1 truncate">{label.name}</span>
          </ContextMenuCheckboxItem>
        ))}
        {labels.length > 0 ? <ContextMenuSeparator /> : null}
        <div className="p-1" onClick={(event) => event.stopPropagation()}>
          <Input
            ref={inputRef}
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              stopInputKeys(event);
              if (event.key === "Enter") {
                event.preventDefault();
                create();
              }
            }}
            maxLength={LIMITS.labelName}
            placeholder={t("label.namePlaceholder")}
            aria-label={t("label.new")}
            data-testid="ctx-new-label-name"
            className="h-7 text-sm"
          />
          <div className="mt-1.5 flex flex-wrap gap-1">
            {LABEL_COLORS.map((entry) => (
              <button
                key={entry}
                type="button"
                aria-label={t(LABEL_COLOR_KEYS[entry])}
                onClick={() => setColor(entry)}
                data-testid={`ctx-label-color-${entry}`}
                className={cn(
                  "size-4 rounded-full transition-shadow",
                  LABEL_COLOR_CHIP[entry],
                  color === entry &&
                    "ring-2 ring-ring ring-offset-1 ring-offset-popover",
                )}
              />
            ))}
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="mt-1.5 h-7 w-full text-xs"
            disabled={name.trim() === ""}
            onClick={create}
            data-testid="ctx-label-create"
          >
            {t("label.create")}
          </Button>
        </div>
      </ContextMenuSubContent>
    </ContextMenuSub>
  );
}

/* ------------------------------------------------------------------ */
/* Due date                                                            */
/* ------------------------------------------------------------------ */

function DueSub({ cardId, dueDate }: { cardId: string; dueDate?: number }) {
  const { t } = useI18n();
  return (
    <ContextMenuSub>
      <ContextMenuSubTrigger data-testid="ctx-due-trigger">
        <CalendarClock />
        {t("dueDate.label")}
      </ContextMenuSubTrigger>
      <ContextMenuSubContent
        className="w-auto p-2"
        data-testid="ctx-due-content"
      >
        {/* DueDatePickerContent is the dialog's own editor — the calendar,
            the time panel and the remove button all dispatch on their own. */}
        <div className="relative">
          <DueDatePickerContent cardId={cardId} dueDate={dueDate} />
        </div>
      </ContextMenuSubContent>
    </ContextMenuSub>
  );
}

/* ------------------------------------------------------------------ */
/* Priority                                                            */
/* ------------------------------------------------------------------ */

function PrioritySub({
  priority,
  onPick,
}: {
  priority?: CardPriority;
  onPick: (priority: CardPriority) => void;
}) {
  const { t } = useI18n();
  const current = priority ?? DEFAULT_CARD_PRIORITY;
  const meta = PRIORITY_META[current];
  const Glyph = meta.icon;
  return (
    <ContextMenuSub>
      <ContextMenuSubTrigger data-testid="ctx-priority-trigger">
        <Glyph className={cn("shrink-0", meta.iconClass)} />
        {t("priority.label")}
      </ContextMenuSubTrigger>
      <ContextMenuSubContent data-testid="ctx-priority-content">
        <ContextMenuRadioGroup
          value={current}
          onValueChange={(value) => onPick(value as CardPriority)}
        >
          {PRIORITY_ORDER.map((entry) => {
            const entryMeta = PRIORITY_META[entry];
            const EntryIcon = entryMeta.icon;
            return (
              <ContextMenuRadioItem
                key={entry}
                value={entry}
                data-testid={`ctx-priority-${entry}`}
              >
                <EntryIcon className={cn("shrink-0", entryMeta.iconClass)} />
                {t(`priority.${entry}`)}
              </ContextMenuRadioItem>
            );
          })}
        </ContextMenuRadioGroup>
      </ContextMenuSubContent>
    </ContextMenuSub>
  );
}

/* ------------------------------------------------------------------ */
/* Assignee                                                            */
/* ------------------------------------------------------------------ */

const ASSIGNEE_SUGGESTION_LIMIT = 8;

function AssigneeSub({
  boardId,
  assigneeId,
  onPick,
}: {
  boardId: string;
  assigneeId?: string;
  onPick: (userId: string | null) => void;
}) {
  const { t } = useI18n();
  const members = useBoardMembersList(boardId);
  const [query, setQuery] = useState("");

  const suggestions = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const pool = members.filter(
      (member) =>
        needle === "" ||
        (member.displayName ?? "").toLowerCase().includes(needle) ||
        member.email.toLowerCase().includes(needle),
    );
    const rank = (member: (typeof members)[number]): number => {
      const label = userLabel(member.displayName, member.email).toLowerCase();
      return label.startsWith(needle) ? 0 : 1;
    };
    return [...pool]
      .sort(
        (a, b) =>
          rank(a) - rank(b) ||
          userLabel(a.displayName, a.email).localeCompare(
            userLabel(b.displayName, b.email),
          ),
      )
      .slice(0, ASSIGNEE_SUGGESTION_LIMIT);
  }, [members, query]);

  return (
    <ContextMenuSub>
      <ContextMenuSubTrigger data-testid="ctx-assignee-trigger">
        <UserRound />
        {t("card.assigneeLabel")}
      </ContextMenuSubTrigger>
      <ContextMenuSubContent
        className="w-60 p-0"
        data-testid="ctx-assignee-content"
      >
        <div className="flex items-center gap-2 border-b border-border/60 px-3 py-2">
          <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={stopInputKeys}
            placeholder={t("card.assignee.searchPlaceholder")}
            aria-label={t("card.assignee.searchPlaceholder")}
            data-testid="ctx-assignee-search"
            className="h-6 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>
        <div className="max-h-56 overflow-y-auto p-1">
          <ContextMenuItem
            onClick={() => onPick(null)}
            data-testid="ctx-assignee-unassign"
            className={cn(assigneeId === undefined && "bg-accent/60")}
          >
            <CircleUserRound />
            {t("card.assignee.unassigned")}
            {assigneeId === undefined ? (
              <Check className="text-foreground" />
            ) : null}
          </ContextMenuItem>
          {suggestions.map((member) => (
            <ContextMenuItem
              key={member.userId}
              onClick={() => onPick(member.userId)}
              data-testid={`ctx-assignee-${member.userId}`}
              className={cn(assigneeId === member.userId && "bg-accent/60")}
            >
              <UserAvatar
                userId={member.userId}
                displayName={member.displayName}
                email={member.email}
                color={member.avatarColor}
                avatarPath={member.avatarPath}
                size="xs"
              />
              <span className="min-w-0 flex-1 truncate">
                {userLabel(member.displayName, member.email)}
              </span>
              {assigneeId === member.userId ? (
                <Check className="text-foreground" />
              ) : null}
            </ContextMenuItem>
          ))}
          {suggestions.length === 0 ? (
            <p className="px-2 py-1.5 text-xs text-muted-foreground">
              {t("card.assignee.empty")}
            </p>
          ) : null}
        </div>
      </ContextMenuSubContent>
    </ContextMenuSub>
  );
}

/* ------------------------------------------------------------------ */
/* Cover                                                               */
/* ------------------------------------------------------------------ */

function CoverSub({
  cover,
  onPick,
  onRemove,
}: {
  cover?: CardCover;
  onPick: (cover: CardCover) => void;
  onRemove: () => void;
}) {
  const { t } = useI18n();
  return (
    <ContextMenuSub>
      <ContextMenuSubTrigger data-testid="ctx-cover-trigger">
        <Palette />
        {t("card.coverLabel")}
      </ContextMenuSubTrigger>
      <ContextMenuSubContent
        className="w-56 p-2"
        data-testid="ctx-cover-content"
      >
        <ContextMenuLabel className="px-0 py-0 text-xs font-medium text-muted-foreground">
          {t("card.coverColors")}
        </ContextMenuLabel>
        <div className="mt-1 flex flex-wrap gap-1.5">
          {COVER_COLORS.map((entry) => (
            <button
              key={entry}
              type="button"
              aria-label={t(COVER_COLOR_KEYS[entry])}
              data-testid={`ctx-cover-color-${entry}`}
              onClick={() => onPick({ type: "color", value: entry })}
              style={{ backgroundColor: COVER_COLOR_CSS[entry] }}
              className={cn(
                "size-6 rounded-md border border-border/40 transition-transform hover:scale-105",
                cover?.type === "color" &&
                  cover.value === entry &&
                  "ring-2 ring-ring ring-offset-1 ring-offset-popover",
              )}
            />
          ))}
        </div>
        <ContextMenuLabel className="mt-2 px-0 py-0 text-xs font-medium text-muted-foreground">
          {t("card.coverGradients")}
        </ContextMenuLabel>
        <div className="mt-1 flex flex-wrap gap-1.5">
          {COVER_GRADIENTS.map((entry) => (
            <button
              key={entry}
              type="button"
              aria-label={t(COVER_GRADIENT_KEYS[entry])}
              data-testid={`ctx-cover-gradient-${entry}`}
              onClick={() => onPick({ type: "gradient", value: entry })}
              style={{ backgroundImage: COVER_GRADIENT_CSS[entry] }}
              className={cn(
                "size-6 rounded-md border border-border/40 transition-transform hover:scale-105",
                cover?.type === "gradient" &&
                  cover.value === entry &&
                  "ring-2 ring-ring ring-offset-1 ring-offset-popover",
              )}
            />
          ))}
        </div>
        {cover ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="mt-2 h-7 w-full text-xs text-destructive hover:bg-destructive/10 hover:text-destructive"
            onClick={onRemove}
            data-testid="ctx-cover-remove"
          >
            {t("card.coverRemove")}
          </Button>
        ) : null}
      </ContextMenuSubContent>
    </ContextMenuSub>
  );
}

/* ------------------------------------------------------------------ */
/* Checklist                                                           */
/* ------------------------------------------------------------------ */

function ChecklistSub({
  checklists,
  onAddChecklist,
  onAddItem,
  onToggleItem,
}: {
  checklists: NonNullable<Card["checklists"]>;
  onAddChecklist: (title: string) => void;
  onAddItem: (checklistId: string, text: string) => void;
  onToggleItem: (checklistId: string, itemId: string) => void;
}) {
  const { t } = useI18n();
  return (
    <ContextMenuSub>
      <ContextMenuSubTrigger data-testid="ctx-checklist-trigger">
        <ListChecks />
        {t("checklist.sectionLabel")}
        {checklists.length > 0 ? (
          <span className="ml-auto mr-1 rounded-full bg-muted px-1.5 text-[10px] font-medium text-muted-foreground">
            {checklists.reduce((total, list) => total + list.items.length, 0)}
          </span>
        ) : null}
      </ContextMenuSubTrigger>
      <ContextMenuSubContent
        className="w-64"
        data-testid="ctx-checklist-content"
      >
        <div className="max-h-64 overflow-y-auto">
          {checklists.map((checklist) => {
            const done = checklist.items.filter((item) => item.done).length;
            return (
              <div key={checklist.id} className="px-1 py-1.5">
                <div className="flex items-center justify-between gap-2 px-1">
                  <span className="min-w-0 truncate text-xs font-semibold text-foreground">
                    {checklist.title}
                  </span>
                  <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">
                    {done}/{checklist.items.length}
                  </span>
                </div>
                {checklist.items.map((item) => (
                  <ContextMenuCheckboxItem
                    key={item.id}
                    checked={item.done}
                    onCheckedChange={() => onToggleItem(checklist.id, item.id)}
                    hideIndicator
                    data-testid={`ctx-checklist-item-${item.id}`}
                  >
                    {/* A always-visible checkbox square — the plain check
                        indicator alone reads as empty space while unticked. */}
                    <span
                      aria-hidden
                      className={cn(
                        "pointer-events-none absolute left-2 flex size-3.5 shrink-0 items-center justify-center rounded-[4px] border transition-colors",
                        item.done
                          ? "border-primary bg-primary"
                          : "border-muted-foreground/40 bg-background",
                      )}
                    >
                      {item.done ? (
                        <Check className="size-3 text-primary-foreground" />
                      ) : null}
                    </span>
                    <span
                      className={cn(
                        "min-w-0 flex-1 truncate text-xs",
                        item.done && "text-muted-foreground line-through",
                      )}
                    >
                      {item.text}
                    </span>
                  </ContextMenuCheckboxItem>
                ))}
                <div className="flex items-center px-2 py-1">
                  <input
                    placeholder={t("checklist.itemPlaceholder")}
                    maxLength={LIMITS.checklistItem}
                    aria-label={t("checklist.itemPlaceholder")}
                    data-testid={`ctx-checklist-add-item-${checklist.id}`}
                    onKeyDown={(event) => {
                      stopInputKeys(event);
                      if (event.key === "Enter") {
                        event.preventDefault();
                        const text = event.currentTarget.value.trim();
                        if (text === "") return;
                        onAddItem(checklist.id, text);
                        event.currentTarget.value = "";
                      }
                    }}
                    className="h-6 w-full bg-transparent text-xs outline-none placeholder:text-muted-foreground"
                  />
                </div>
              </div>
            );
          })}
        </div>
        <ContextMenuSeparator />
        <div className="flex items-center px-2 py-1.5">
          <input
            placeholder={t("checklist.add")}
            maxLength={LIMITS.checklistTitle}
            aria-label={t("checklist.add")}
            data-testid="ctx-checklist-new"
            onKeyDown={(event) => {
              stopInputKeys(event);
              if (event.key === "Enter") {
                event.preventDefault();
                const title = event.currentTarget.value.trim();
                onAddChecklist(
                  title === "" ? t("checklist.defaultTitle") : title,
                );
                event.currentTarget.value = "";
              }
            }}
            className="h-6 w-full bg-transparent text-xs outline-none placeholder:text-muted-foreground"
          />
        </div>
      </ContextMenuSubContent>
    </ContextMenuSub>
  );
}

/* ------------------------------------------------------------------ */
/* Comment                                                             */
/* ------------------------------------------------------------------ */

function CommentSub({
  cardId,
  onSent,
}: {
  cardId: string;
  onSent: () => void;
}) {
  const { t } = useI18n();
  const toast = useToast();
  const { user } = useAuth();
  const serverMode = isApiEnabled();
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);

  const trimmed = text.trim();
  const canSend =
    serverMode &&
    user !== null &&
    !sending &&
    trimmed.length > 0 &&
    trimmed.length <= LIMITS.comment;

  const send = async () => {
    if (!canSend) return;
    const body = trimmed;
    setSending(true);
    try {
      await api.createComment(cardId, body);
      setText("");
      // The send button is not a menu item — close the menu ourselves.
      onSent();
    } catch {
      toast.error(t("comment.sendError"));
    } finally {
      setSending(false);
    }
  };

  return (
    <ContextMenuSub>
      <ContextMenuSubTrigger data-testid="ctx-comment-trigger">
        <MessageSquare />
        {t("card.menu.comment")}
      </ContextMenuSubTrigger>
      <ContextMenuSubContent
        className="w-64 p-2"
        data-testid="ctx-comment-content"
      >
        <textarea
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            stopInputKeys(event);
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              void send();
            }
          }}
          placeholder={t("comment.placeholder")}
          aria-label={t("card.menu.comment")}
          maxLength={LIMITS.comment}
          rows={3}
          data-testid="ctx-comment-input"
          className="w-full resize-none rounded-md border border-border/60 bg-transparent p-2 text-sm outline-none placeholder:text-muted-foreground focus:border-primary/50"
        />
        <div className="mt-1 flex items-center justify-between gap-2">
          <span className="text-[10px] tabular-nums text-muted-foreground">
            {text.length}/{LIMITS.comment}
          </span>
          <Button
            type="button"
            size="sm"
            className="h-7 px-3 text-xs"
            disabled={!canSend}
            onClick={() => void send()}
            data-testid="ctx-comment-send"
          >
            {t("comment.send")}
          </Button>
        </div>
      </ContextMenuSubContent>
    </ContextMenuSub>
  );
}
