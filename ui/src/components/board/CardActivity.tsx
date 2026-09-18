import { useState } from "react";
import { ChevronDown } from "lucide-react";
import type { CardActivityEvent } from "@janosik/shared";

import { CardComments } from "@/components/board/CardComments";
import { CardHistory } from "@/components/board/CardHistory";
import { CollapsibleSection } from "@/components/board/CollapsibleSection";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useI18n } from "@/i18n";

/** The two projections of one card's story (Jira's Activity tabs). */
type ActivityView = "comments" | "history";

const VIEW_KEYS = {
  comments: "activity.comments",
  history: "activity.history",
} as const;

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
 * The card's Activity section (TASK-37): a Jira-style chip row where the
 * active view (Comments by default) sits next to a "More" menu holding the
 * other one — History, the server-fed timeline with from → to diffs.
 *
 * It is deliberately the last section of the dialog: a busy comment thread
 * is what people scroll for, so it gets the tail of the page instead of
 * pushing editable fields around. The comment count rides in the header
 * badge, visible while collapsed.
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
  const other: ActivityView[] =
    view === "comments" ? ["history"] : ["comments"];

  return (
    <CollapsibleSection
      title={t("activity.title")}
      badge={commentCount > 0 ? commentCount : undefined}
      defaultExpanded
      testId="activity-toggle"
      contentClassName="mt-2 space-y-3"
    >
      <div
        role="tablist"
        aria-label={t("activity.title")}
        className="flex items-center gap-2"
      >
        <button
          type="button"
          role="tab"
          aria-selected
          data-testid={`activity-tab-${view}`}
          className="inline-flex items-center rounded-md border border-primary/30 bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary transition-colors"
        >
          {t(VIEW_KEYS[view])}
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground"
              data-testid="activity-more"
            >
              {t("activity.more")}
              <ChevronDown className="h-3.5 w-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {other.map((target) => (
              <DropdownMenuItem
                key={target}
                data-testid={`activity-more-${target}`}
                onClick={() => setView(target)}
              >
                {t(VIEW_KEYS[target])}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
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
        />
      )}
    </CollapsibleSection>
  );
}
