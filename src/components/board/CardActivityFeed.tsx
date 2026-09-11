import { useState } from "react";
import {
  CalendarClock,
  CalendarX,
  ArrowRightLeft,
  AlignLeft,
  ChevronRight,
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
 *
 * The timeline is collapsed behind a "Activity (n)" header (Trello-style):
 * feeds can grow long, and history is a look-up, not a reading flow — so
 * it opens on demand and starts collapsed again on the next card visit.
 */
export function CardActivityFeed({ activity, createdAt }: CardActivityFeedProps) {
  const { t, lang } = useI18n();
  const [expanded, setExpanded] = useState(false);

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
      <button
        aria-expanded={expanded}
        className="flex w-full items-center gap-1.5 rounded text-left text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
        data-testid="activity-toggle"
        onClick={() => setExpanded((value) => !value)}
        type="button"
      >
        <ChevronRight
          aria-hidden="true"
          className={`h-3.5 w-3.5 transition-transform ${expanded ? "rotate-90" : ""}`}
        />
        {t("activity.title")}
        {/* Jira-style count badge, visible even while collapsed. */}
        <span className="rounded-full bg-muted px-1.5 text-[11px] tabular-nums text-muted-foreground">
          {timeline.length}
        </span>
      </button>

      {expanded && (
        <ol className="mt-2 space-y-1.5 border-l border-border/60 pl-3">
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
      )}
    </section>
  );
}
