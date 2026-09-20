import { useState } from "react";
import { History, MessageSquare } from "lucide-react";
import type { CardActivityEvent } from "@janosik/shared";

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
}

/**
 * The card's Activity section (TASK-37): a segmented control — the same
 * pattern as the board's view switcher — over the comment thread and the
 * History timeline with from → to diffs. The comment count rides in the
 * header badge, visible while collapsed.
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
}: CardActivityProps) {
  const { t } = useI18n();
  const [view, setView] = useState<ActivityView>("comments");
  const [commentCount, setCommentCount] = useState(0);
  const [historyCount, setHistoryCount] = useState(0);

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
        className="inline-flex items-center gap-1 rounded-lg border border-border/60 bg-card/80 p-1 shadow-sm"
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
                "flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                view === id
                  ? "bg-primary/15 text-primary"
                  : "text-muted-foreground hover:bg-hover hover:text-foreground",
              )}
            >
              <Icon className="h-3.5 w-3.5" aria-hidden />
              {t(labelKey)}
              {count > 0 ? (
                <span
                  data-testid={`${testId}-count`}
                  className="rounded-full bg-muted px-1.5 text-[11px] tabular-nums text-muted-foreground"
                >
                  {count}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      {/* The inactive view unmounts: returning to it re-reads the newest
          page, which keeps a long thread from going stale in the background. */}
      {view === "comments" ? (
        <CardComments
          key={cardId}
          cardId={cardId}
          boardId={boardId}
          readOnly={readOnly}
          onCountChange={setCommentCount}
        />
      ) : (
        <CardHistory
          key={cardId}
          cardId={cardId}
          boardId={boardId}
          updatedAt={updatedAt}
          localActivity={localActivity}
          onCountChange={setHistoryCount}
        />
      )}
    </CollapsibleSection>
  );
}
