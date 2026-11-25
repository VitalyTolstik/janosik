import { useState } from "react";
import { History, MessageSquare } from "lucide-react";
import type { CardActivityEvent } from "@janosik/shared";

import {
  CARD_ACTIVITY_PAGE_SIZE,
  type ActivityCount,
} from "@/components/board/card-activity-count";
import { ActivityCountSkeleton } from "@/components/board/CardSectionSkeleton";
import { CardComments } from "@/components/board/CardComments";
import { CardHistory } from "@/components/board/CardHistory";
import { CollapsibleSection } from "@/components/board/CollapsibleSection";
import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n";

/** The two projections of one card's story (Jira's Activity tabs). */
type ActivityView = "comments" | "history";

const VIEWS: {
  id: ActivityView;
  icon: typeof MessageSquare;
  labelKey: "activity.comments" | "activity.history";
  testId: string;
}[] = [
  {
    id: "comments",
    icon: MessageSquare,
    labelKey: "activity.comments",
    testId: "activity-tab-comments",
  },
  {
    id: "history",
    icon: History,
    labelKey: "activity.history",
    testId: "activity-tab-history",
  },
];

interface CardActivityProps {
  cardId: string;
  boardId: string;
  /** Bumped on committed edits — the History view refetches on change. */
  updatedAt: number;
  /** Local-mode timeline when no server is reachable. */
  localActivity?: CardActivityEvent[];
  readOnly?: boolean;
  /** Search deep link (TASK-177.13): comment row to reveal and highlight. */
  focusCommentId?: string;
}

/**
 * The card's Activity section (TASK-37): a segmented control — the same
 * pattern as the board's view switcher — over the comment thread and the
 * History timeline with from → to diffs. Each tab reports its count once
 * its feed loads.
 *
 * It is deliberately the last section of the dialog: a busy comment thread
 * is what people scroll for, so it gets the tail of the page instead of
 * pushing editable fields around.
 */
export function CardActivity({
  cardId,
  boardId,
  updatedAt,
  localActivity,
  readOnly = false,
  focusCommentId,
}: CardActivityProps) {
  const { t, tp } = useI18n();
  const [view, setView] = useState<ActivityView>("comments");
  const [commentCount, setCommentCount] = useState<ActivityCount | null>();
  const [historyCount, setHistoryCount] = useState<ActivityCount | null>();

  function badge(view: ActivityView, count: ActivityCount) {
    const { total } = count;
    const hasTotal =
      total !== undefined &&
      Number.isSafeInteger(total) &&
      total >= count.loaded &&
      (!count.truncated || total > count.loaded);
    const progress = hasTotal
      ? t("activity.countOf", { shown: count.loaded, total })
      : count.truncated
        ? t("activity.countMore", { shown: CARD_ACTIVITY_PAGE_SIZE })
        : null;
    if (view === "comments") return progress ?? count.visible;

    const rows = tp("activity.historyRows", count.visible);
    return progress === null
      ? rows
      : t("activity.historyProgress", { rows, events: progress });
  }

  return (
    <CollapsibleSection
      title={t("activity.title")}
      defaultExpanded
      testId="activity-toggle"
      contentClassName="mt-3 space-y-3"
    >
      <div
        role="group"
        aria-label={t("activity.title")}
        className="inline-flex flex-wrap items-center gap-1 rounded-lg border border-border/60 bg-card/80 p-1 shadow-sm"
      >
        {VIEWS.map(({ id, icon: Icon, labelKey, testId }) => {
          const count = id === "comments" ? commentCount : historyCount;
          return (
            <button
              key={id}
              type="button"
              aria-pressed={view === id}
              data-testid={testId}
              onClick={() => setView(id)}
              className={cn(
                "flex items-center gap-1.5 rounded-md px-2.5 py-1 text-ui-label font-medium transition-colors",
                view === id
                  ? "bg-primary/15 text-(--tab-text)"
                  : "text-muted-foreground hover:bg-hover hover:text-foreground",
              )}
            >
              <Icon className="h-3.5 w-3.5" aria-hidden />
              {t(labelKey)}
              {count &&
              (count.visible > 0 ||
                count.truncated ||
                count.total !== undefined) ? (
                <span
                  data-testid={`${testId}-count`}
                  className="rounded-full bg-muted px-1.5 text-ui-micro tabular-nums text-muted-foreground"
                >
                  {badge(id, count)}
                </span>
              ) : count === undefined ? (
                <ActivityCountSkeleton />
              ) : null}
            </button>
          );
        })}
      </div>

      {/* Both views stay mounted (the inactive one is display-hidden): the
          counts load with the dialog instead of after the first tab click,
          and the SSE subscriptions inside each view keep the hidden thread
          fresh, so switching tabs shows live data without a refetch. */}
      <div className={cn(view !== "comments" && "hidden")}>
        <CardComments
          key={cardId}
          cardId={cardId}
          boardId={boardId}
          readOnly={readOnly}
          focusId={focusCommentId}
          onCountChange={setCommentCount}
        />
      </div>
      <div className={cn(view !== "history" && "hidden")}>
        <CardHistory
          key={cardId}
          cardId={cardId}
          boardId={boardId}
          updatedAt={updatedAt}
          localActivity={localActivity}
          onCountChange={setHistoryCount}
        />
      </div>
    </CollapsibleSection>
  );
}
