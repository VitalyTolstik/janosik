import { useDroppable } from "@dnd-kit/core";
import { ChevronDown, Ellipsis, Plus } from "lucide-react";
import { memo, useId, useState } from "react";
import {
  LABEL_COLOR_CHIP,
  type Card,
  type Epic,
  type Label,
} from "@janosik/shared";

import { CardComposer } from "@/components/board/CardComposer";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { UserAvatar } from "@/components/ui/user-avatar";
import { formatDateOnly, useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import { useBoardMember } from "@/store/board-live";
import { userLabel } from "@/utils/avatar";
import {
  epicChildrenId,
  OTHER_CARDS_DROP_ID,
  type BacklogEpic,
} from "@/utils/backlog-rows";

const TOUCH_TARGET =
  "min-h-11 min-w-11 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring";
export const EPIC_RAIL = "border-x border-(--epic-border) bg-(--epic-surface)";
const PAGE_SIZE = 12;

interface EpicCardsProps {
  entry: BacklogEpic;
  getCard: (id: string) => Card | undefined;
  onCardClick?: (id: string) => void;
}

function EpicCardLinks({
  entry,
  getCard,
  onCardClick,
  menu,
}: EpicCardsProps & { menu?: boolean }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const label = t("epic.cardsIn", { title: entry.epic.title });
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={t(menu ? "epic.menu" : "epic.showAllFor", {
            title: entry.epic.title,
          })}
          className={cn(
            TOUCH_TARGET,
            menu
              ? "absolute right-0 top-0 grid place-items-center text-muted-foreground hover:text-foreground"
              : "shrink-0 px-1 text-ui-meta font-semibold text-(--epic-ink) hover:underline",
          )}
        >
          {menu ? <Ellipsis size={16} aria-hidden /> : t("epic.showAll")}
        </button>
      </PopoverTrigger>
      <PopoverContent aria-label={label} align="end" className="p-2">
        <EpicCardList
          label={label}
          entry={entry}
          getCard={getCard}
          onCardClick={(id) => {
            setOpen(false);
            onCardClick?.(id);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

function EpicCardList({
  entry,
  getCard,
  onCardClick,
  label,
}: EpicCardsProps & { label: string }) {
  const { t } = useI18n();
  const [page, setPage] = useState(0);
  const lastPage = Math.max(
    0,
    Math.ceil(entry.childIds.length / PAGE_SIZE) - 1,
  );
  const current = Math.min(page, lastPage);
  return (
    <>
      <p
        className="mb-1 truncate px-2 text-ui-body font-semibold"
        title={label}
      >
        {label}
      </p>
      {entry.childIds.length === 0 ? (
        <p className="px-2 py-1 text-ui-label text-muted-foreground">
          {t("epic.noCards")}
        </p>
      ) : (
        <ul className="max-h-64 overflow-y-auto">
          {entry.childIds
            .slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE)
            .map((id) => (
              <li key={id}>
                <button
                  type="button"
                  className={cn(
                    TOUCH_TARGET,
                    "w-full truncate px-2 text-left text-ui-label hover:bg-hover",
                  )}
                  onClick={() => onCardClick?.(id)}
                >
                  {getCard(id)?.title}
                </button>
              </li>
            ))}
        </ul>
      )}
      {lastPage > 0 ? (
        <div className="flex items-center justify-between border-t text-ui-label">
          <button
            type="button"
            disabled={current === 0}
            className={cn(
              TOUCH_TARGET,
              "px-2 hover:bg-hover disabled:opacity-50",
            )}
            onClick={() => setPage(current - 1)}
          >
            {t("epic.previous")}
          </button>
          <span>
            {current + 1}/{lastPage + 1}
          </span>
          <button
            type="button"
            disabled={current === lastPage}
            className={cn(
              TOUCH_TARGET,
              "px-2 hover:bg-hover disabled:opacity-50",
            )}
            onClick={() => setPage(current + 1)}
          >
            {t("epic.next")}
          </button>
        </div>
      ) : null}
    </>
  );
}

const EpicFace = memo(function EpicFace({
  epic,
  code,
  labels,
  boardId,
  done,
  total,
  expanded,
  compact,
}: {
  epic: Epic;
  code: string;
  labels: Label[];
  boardId?: string;
  done: number;
  total: number;
  expanded: boolean;
  compact: boolean;
}) {
  const { lang, t, tp } = useI18n();
  const owner = useBoardMember(boardId, epic.ownerId);
  const ownerName = owner
    ? userLabel(owner.displayName, owner.email)
    : undefined;
  const due =
    epic.dueDate === undefined
      ? undefined
      : t("epic.due", { date: formatDateOnly(epic.dueDate, lang) });
  const completed = epic.status === "completed";
  return (
    <>
      <span
        className={cn(
          "flex min-w-0 items-center gap-1.5",
          compact ? "pr-8" : "h-5",
        )}
      >
        {completed ? null : (
          <ChevronDown
            aria-hidden
            size={14}
            className={cn(
              "shrink-0 text-(--epic-ink)",
              expanded && "rotate-180",
            )}
          />
        )}
        {compact ? null : (
          <span
            className="rounded-full border px-1.5 text-ui-micro font-bold text-(--epic-ink)"
            style={{
              borderColor: "var(--epic-border)",
              backgroundColor: "var(--epic-track)",
            }}
          >
            {t("epic.badge")}
          </span>
        )}
        <span className="shrink-0 text-ui-meta text-muted-foreground">
          {code}
        </span>
        {compact && (
          <span
            className="truncate text-ui-body font-semibold"
            title={epic.title}
          >
            {epic.title}
          </span>
        )}
      </span>
      {compact ? null : (
        <span
          className="line-clamp-2 break-words pr-7 text-ui-body font-semibold leading-tight"
          title={epic.title}
        >
          {epic.title}
        </span>
      )}
      <span className="mt-auto flex items-center gap-1.5 text-ui-meta tabular-nums">
        <span
          className="h-1 min-w-4 flex-1 overflow-hidden rounded-full"
          style={{
            backgroundColor: completed ? "var(--border)" : "var(--epic-track)",
          }}
          aria-hidden
        >
          <span
            className="block h-full rounded-full"
            style={{
              backgroundColor: completed
                ? "var(--muted-foreground)"
                : "var(--epic-accent)",
              width: `${total === 0 ? 0 : (done / total) * 100}%`,
            }}
          />
        </span>
        <span
          className={cn(
            "font-bold",
            completed ? "text-foreground" : "text-(--epic-ink)",
          )}
        >
          {done}/{total}
        </span>{" "}
        <span
          className={
            completed && done < total
              ? "text-(--chip-warning)"
              : "text-muted-foreground"
          }
        >
          {tp("epic.open", total - done)}
        </span>
      </span>{" "}
      {!compact && (ownerName || due || labels.length > 0) ? (
        <span className="flex h-4 min-w-0 items-center gap-1 overflow-hidden whitespace-nowrap text-ui-micro text-muted-foreground">
          {owner && ownerName ? (
            <span
              className="flex min-w-0 max-w-24 shrink items-center gap-1"
              title={ownerName}
            >
              <UserAvatar
                userId={owner.userId}
                displayName={owner.displayName}
                email={owner.email}
                color={owner.avatarColor}
                avatarPath={owner.avatarPath}
                className="size-4 text-[8px]"
              />
              <span className="truncate">{ownerName}</span>
            </span>
          ) : null}
          {due ? (
            <span className="min-w-0 shrink-0 truncate" title={due}>
              {due}
            </span>
          ) : null}
          {labels.slice(0, 3).map((label) => (
            <span
              key={label.id}
              title={label.name}
              className={cn(
                "min-w-0 truncate rounded px-1 font-medium",
                LABEL_COLOR_CHIP[label.color],
              )}
            >
              {label.name}
            </span>
          ))}
        </span>
      ) : null}
    </>
  );
});

export const BacklogEpicTile = memo(function BacklogEpicTile({
  entry,
  getCard,
  onCardClick,
  boardId,
  labels,
  compact,
  expanded,
  toggle,
  filterExpanded,
  dropDisabled,
}: EpicCardsProps & {
  boardId?: string;
  labels: Label[];
  compact: boolean;
  expanded: boolean;
  toggle: (id: string) => void;
  filterExpanded: boolean;
  dropDisabled: boolean;
}) {
  const { t } = useI18n();
  const progressId = useId();
  const { epic, code, dropId, done, total } = entry;
  const completed = epic.status === "completed";
  const { setNodeRef, isOver } = useDroppable({
    id: dropId,
    data: { type: "epic", epicId: epic.id },
    disabled: completed || dropDisabled,
  });
  const face = (
    <EpicFace
      epic={epic}
      code={code}
      labels={labels}
      boardId={boardId}
      done={done}
      total={total}
      expanded={expanded}
      compact={compact || completed}
    />
  );
  const faceClass =
    "flex h-full w-full flex-col gap-0.5 rounded-lg px-3 py-1.5 text-left";
  return (
    <div
      ref={setNodeRef}
      data-testid="backlog-epic"
      data-epic-expanded={expanded}
      data-epic-id={epic.id}
      data-epic-over={isOver || undefined}
      data-epic-completed={completed || undefined}
      className={cn(
        "relative h-full rounded-lg border",
        completed
          ? "border-border"
          : "border-(--epic-border) border-l-[3px] border-l-(--epic-accent) bg-(--epic-surface)",
      )}
      style={{
        backgroundColor: completed
          ? "color-mix(in oklab, var(--muted) 45%, transparent)"
          : undefined,
        borderBottomStyle: expanded ? "dashed" : undefined,
        borderBottomLeftRadius: expanded ? 0 : undefined,
        borderBottomRightRadius: expanded ? 0 : undefined,
        boxShadow: isOver ? "inset 0 0 0 2px var(--epic-accent)" : undefined,
      }}
    >
      {completed ? (
        <div className={faceClass}>{face}</div>
      ) : (
        <button
          type="button"
          aria-expanded={expanded}
          aria-disabled={filterExpanded || undefined}
          aria-controls={epicChildrenId(epic.id)}
          aria-describedby={progressId}
          onClick={filterExpanded ? undefined : () => toggle(epic.id)}
          className={cn(
            faceClass,
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
          )}
        >
          <span className="sr-only">
            {t(expanded ? "epic.collapse" : "epic.expand")}
          </span>
          {face}
        </button>
      )}
      {!completed && (
        <span id={progressId} hidden>
          {t("epic.progress", { done, total })}
        </span>
      )}
      <EpicCardLinks
        entry={entry}
        getCard={getCard}
        onCardClick={onCardClick}
        menu
      />
    </div>
  );
});

export function BacklogOtherCards({
  count,
  disabled,
}: {
  count: number;
  disabled: boolean;
}) {
  const { t } = useI18n();
  const { setNodeRef, isOver } = useDroppable({
    id: OTHER_CARDS_DROP_ID,
    disabled,
    data: { type: "other-cards" },
  });
  return (
    <div
      ref={setNodeRef}
      className={cn(
        "flex h-full items-center gap-2 rounded-md px-1 text-ui-label font-semibold text-muted-foreground",
        isOver && "bg-hover ring-1 ring-primary",
      )}
      data-testid="backlog-other"
    >
      <span>{t("epic.other", { count })}</span>
      <span className="h-px flex-1 bg-border" aria-hidden />
    </div>
  );
}

export function BacklogEpicFooter({
  entry,
  getCard,
  onCardClick,
  last,
}: EpicCardsProps & { last: boolean }) {
  const { t, tp } = useI18n();
  const { elsewhereOpen, elsewhereDone } = entry;
  return (
    <div
      className={cn(
        EPIC_RAIL,
        "flex h-full items-center gap-1 px-2",
        last && "rounded-b-lg border-b",
      )}
    >
      <span className="min-w-0 flex-1 text-ui-meta leading-tight text-muted-foreground">
        {entry.total === 0
          ? t("epic.noCards")
          : elsewhereOpen && elsewhereDone
            ? t("epic.elsewhereProgress", {
                open: elsewhereOpen,
                done: elsewhereDone,
              })
            : tp("epic.elsewhere", elsewhereOpen + elsewhereDone)}
      </span>
      {entry.childIds.length > 0 && (
        <EpicCardLinks
          entry={entry}
          getCard={getCard}
          onCardClick={onCardClick}
        />
      )}
    </div>
  );
}

export function BacklogCardComposer({
  labels,
  onSubmit,
  epic,
  columnId,
  disabled,
  disabledReason,
  onOpenChange,
}: {
  labels: Label[];
  onSubmit: (title: string, labels?: string[]) => void;
  epic?: Epic;
  columnId?: string;
  disabled: boolean;
  disabledReason?: string;
  onOpenChange?: (open: boolean) => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const changeOpen = (next: boolean) => {
    setOpen(next);
    onOpenChange?.(next);
  };
  const label = t(epic ? "epic.addSubtask" : "composer.add");
  const title = epic ? t("epic.newSubtask", { title: epic.title }) : label;
  return (
    <Popover open={open} onOpenChange={changeOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          title={disabled ? disabledReason : undefined}
          data-composer-trigger={columnId}
          className={cn(
            TOUCH_TARGET,
            "flex w-full items-center gap-1.5 px-2 text-ui-label font-semibold disabled:opacity-50",
            epic
              ? "justify-center border border-dashed border-(--epic-border) text-(--epic-ink) hover:bg-(--epic-track)"
              : "text-muted-foreground hover:bg-hover hover:text-foreground",
          )}
        >
          <Plus size={16} aria-hidden />
          {label}
        </button>
      </PopoverTrigger>
      <PopoverContent aria-label={title} className="p-2">
        <CardComposer
          labels={labels}
          defaultComposing
          inputLabel={title}
          onSubmit={onSubmit}
          onClose={() => changeOpen(false)}
        />
      </PopoverContent>
    </Popover>
  );
}
