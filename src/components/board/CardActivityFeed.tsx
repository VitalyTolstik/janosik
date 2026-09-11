import {
  CalendarClock,
  CalendarX,
  ArrowRightLeft,
  AlignLeft,
  Plus,
  Tag,
  TagX,
  Type,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { formatDate, formatRelative, useI18n } from "@/i18n";
import type { CardActivityEvent, CardActivityType } from "@/types/kanban";

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
};

interface CardActivityFeedProps {
  activity?: CardActivityEvent[];
  /**
   * Fallback for cards created before the feature (no stored events):
   * the feed shows a single "created" row from this timestamp.
   */
  createdAt: number;
}

/**
 * A card's mini-biography: newest-first timeline of what happened to it.
 * Events are stored on the card by the reducer; legacy cards (and brand
 * new ones from old data) fall back to a single "created" entry.
 */
export function CardActivityFeed({ activity, createdAt }: CardActivityFeedProps) {
  const { t, lang } = useI18n();

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
    <section aria-label={t("activity.title")}>
      <h3 className="text-xs font-medium text-muted-foreground">
        {t("activity.title")}
      </h3>
      <ol className="mt-2 space-y-1.5">
        {timeline.map((event) => {
          const Icon = ACTIVITY_ICONS[event.type] ?? Plus;
          return (
            <li
              className="flex items-center gap-2 text-sm"
              data-testid="activity-event"
              key={event.id}
            >
              <Icon
                aria-hidden="true"
                className="h-3.5 w-3.5 shrink-0 text-muted-foreground/70"
              />
              <span className="min-w-0 flex-1 truncate text-foreground/90">
                {t(`activity.${event.type}`, {
                  defaultValue: event.type,
                  detail: event.detail ?? "",
                })}
              </span>
              {/* Relative time up close; the exact timestamp on hover. */}
              <time
                className="shrink-0 text-[11px] text-muted-foreground/70"
                dateTime={new Date(event.at).toISOString()}
                title={formatDate(event.at, lang)}
              >
                {formatRelative(event.at, lang)}
              </time>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
