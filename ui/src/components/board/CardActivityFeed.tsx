import {
  Archive,
  ArchiveRestore,
  CalendarClock,
  CalendarX,
  ArrowRightLeft,
  AlignLeft,
  CircleCheck,
  CircleDashed,
  CircleX,
  ImageOff,
  ListPlus,
  ListTodo,
  ListX,
  Paintbrush,
  PencilLine,
  Plus,
  Tag,
  TagX,
  Type,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import {
  formatDate,
  formatRelative,
  useHour12,
  useI18n,
  type MessageKey,
} from "@/i18n";
import { UserAvatar } from "@/components/ui/user-avatar";
import { CollapsibleSection } from "@/components/board/CollapsibleSection";
import { useOpenProfile } from "@/components/board/UserProfileDialog";
import { useBoardMember } from "@/store/board-live";
import { userLabel } from "@/utils/avatar";
import type { CardActivityEvent, CardActivityType } from "@janosik/shared";

/** Muted icon per event kind — the timeline's visual anchor. */
const ACTIVITY_ICONS: Record<CardActivityType, LucideIcon> = {
  created: Plus,
  renamed: Type,
  "description-changed": AlignLeft,
  moved: ArrowRightLeft,
  "label-added": Tag,
  "label-removed": TagX,
  "due-date-set": CalendarClock,
  "due-date-removed": CalendarX,
  "cover-set": Paintbrush,
  "cover-removed": ImageOff,
  "checklist-added": ListPlus,
  "checklist-removed": ListX,
  "checklist-renamed": PencilLine,
  "checklist-item-added": ListTodo,
  "checklist-item-checked": CircleCheck,
  "checklist-item-unchecked": CircleDashed,
  "checklist-item-removed": CircleX,
  "checklist-item-renamed": PencilLine,
  archived: Archive,
  unarchived: ArchiveRestore,
};

/**
 * Typed label key per event kind (N-6): a dictionary keyed by the known ids
 * keeps `t()` on real `MessageKey`s and makes catalog drift a compile error.
 */
const ACTIVITY_KEYS = {
  created: "activity.created",
  renamed: "activity.renamed",
  "description-changed": "activity.description-changed",
  moved: "activity.moved",
  "label-added": "activity.label-added",
  "label-removed": "activity.label-removed",
  "due-date-set": "activity.due-date-set",
  "due-date-removed": "activity.due-date-removed",
  "cover-set": "activity.cover-set",
  "cover-removed": "activity.cover-removed",
  "checklist-added": "activity.checklist-added",
  "checklist-removed": "activity.checklist-removed",
  "checklist-renamed": "activity.checklist-renamed",
  "checklist-item-added": "activity.checklist-item-added",
  "checklist-item-checked": "activity.checklist-item-checked",
  "checklist-item-unchecked": "activity.checklist-item-unchecked",
  "checklist-item-removed": "activity.checklist-item-removed",
  "checklist-item-renamed": "activity.checklist-item-renamed",
  archived: "activity.archived",
  unarchived: "activity.unarchived",
} satisfies Record<CardActivityType, MessageKey>;

interface CardActivityFeedProps {
  activity?: CardActivityEvent[];
  /**
   * Fallback for cards created before the feature (no stored events):
   * the feed shows a single "created" row from this timestamp.
   */
  createdAt: number;
  /** Board whose member directory names the actors (TASK-36). */
  boardId?: string;
}

/**
 * A card's mini-biography: newest-first timeline of what happened to it.
 * Events are stored on the card by the reducer; legacy cards (and brand
 * new ones from old data) fall back to a single "created" entry.
 *
 * The timeline is collapsed behind a "Activity (n)" header (Trello-style):
 * feeds can grow long, and history is a look-up, not a reading flow — so
 * it opens on demand and starts collapsed again on the next card visit.
 */
export function CardActivityFeed({
  activity,
  createdAt,
  boardId,
}: CardActivityFeedProps) {
  const { t } = useI18n();

  const stored = activity ?? [];
  // The "created" row is guaranteed: cards made before the feature (or
  // edited after a legacy load) have no stored one — synthesize it from
  // `createdAt` so the timeline never loses its first entry.
  const events: CardActivityEvent[] = stored.some(
    (event) => event.type === "created",
  )
    ? stored
    : [
        // `createdAt` is always the oldest point of a card's life.
        { id: "created", type: "created", at: createdAt, actorId: null },
        ...stored,
      ];
  // Newest first — the recent history is what you open the card for.
  const timeline = [...events].reverse();

  return (
    <CollapsibleSection
      title={t("activity.title")}
      badge={timeline.length}
      defaultExpanded={false}
      testId="activity-toggle"
      contentClassName="mt-2 border-l border-border/60 pl-3"
    >
      <ol className="space-y-1.5">
        {timeline.map((event) => (
          <ActivityRow boardId={boardId} event={event} key={event.id} />
        ))}
      </ol>
    </CollapsibleSection>
  );
}

/**
 * One feed line (TASK-36): the actor's avatar and name lead when the event
 * has one — the timeline answers "who" at a glance — and the type icon
 * stands in for the times nobody could be attributed (legacy or local).
 */
function ActivityRow({
  boardId,
  event,
}: {
  boardId?: string;
  event: CardActivityEvent;
}) {
  const { t, lang } = useI18n();
  const hour12 = useHour12();
  const member = useBoardMember(boardId, event.actorId);
  const openProfile = useOpenProfile();
  const name = event.actorId
    ? userLabel(member?.displayName ?? null, member?.email ?? "")
    : "";
  const Icon = ACTIVITY_ICONS[event.type] ?? Plus;
  const actorId = event.actorId;

  return (
    <li
      className="flex items-center gap-2 text-sm"
      data-testid="activity-event"
    >
      {name && actorId ? (
        <button
          type="button"
          data-testid="activity-actor"
          aria-label={t("profile.open", { name })}
          onClick={() => openProfile(actorId)}
          className="inline-flex rounded-full"
        >
          <UserAvatar
            userId={actorId}
            displayName={member?.displayName ?? null}
            email={member?.email ?? ""}
            color={member?.avatarColor}
            size="xs"
            className="ring-1 ring-border/60"
          />
        </button>
      ) : (
        <Icon
          aria-hidden="true"
          className="h-3.5 w-3.5 shrink-0 text-muted-foreground/70"
        />
      )}
      <span className="min-w-0 flex-1 truncate text-foreground/90">
        {name && actorId ? (
          <>
            <button
              type="button"
              onClick={() => openProfile(actorId)}
              className="font-medium hover:underline"
            >
              {name}
            </button>
            <span className="text-muted-foreground/60"> · </span>
          </>
        ) : null}
        {t(ACTIVITY_KEYS[event.type], {
          detail: event.detail ?? "",
        })}
      </span>
      {/* Relative time up close; the exact timestamp on hover. */}
      <time
        className="shrink-0 text-[11px] text-muted-foreground/70"
        dateTime={new Date(event.at).toISOString()}
        title={formatDate(event.at, lang, hour12)}
      >
        {formatRelative(event.at, lang, Date.now(), hour12)}
      </time>
    </li>
  );
}
