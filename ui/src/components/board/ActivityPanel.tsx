import { useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  ACTIVITY_PAGE_SIZE,
  useBoardActivityFeed,
} from "@/hooks/use-board-activity-feed";
import { formatDate, useHour12, useI18n } from "@/i18n";
import { useBoardState } from "@/store/BoardContext";
import { useBoardMembersList } from "@/store/board-live";
import { cardById } from "@/store/read-model";
import {
  activityAssignee,
  activityEntryKey,
  activityHasStory,
  sentenceFor,
} from "@/utils/activity";
import { userLabel } from "@/utils/avatar";

export function ActivityPanel({
  boardId,
  cardId,
  onClearCard,
}: {
  boardId: string;
  cardId?: string;
  onClearCard: () => void;
}) {
  const { t, lang } = useI18n();
  const hour12 = useHour12();
  const { board } = useBoardState();
  const members = useBoardMembersList(boardId);
  const byId = useMemo(
    () => new Map(members.map((member) => [member.userId, member])),
    [members],
  );
  const { page, error, refresh } = useBoardActivityFeed(boardId, { cardId });
  const rows =
    page?.items.filter(activityHasStory).slice(0, ACTIVITY_PAGE_SIZE) ?? [];
  const newest = rows[0];
  const [seen, setSeen] = useState<{ key: string; at: number } | null>();
  const [announcements, setAnnouncements] = useState(0);
  const heading = useRef<HTMLHeadingElement>(null);
  function latest() {
    return newest ? { key: activityEntryKey(newest), at: newest.at } : null;
  }
  if (page && seen === undefined) setSeen(latest());
  const seenIndex = seen
    ? rows.findIndex((entry) => activityEntryKey(entry) === seen.key)
    : -1;
  const pending =
    seenIndex >= 0
      ? seenIndex
      : rows.filter((entry) => entry.at >= (seen?.at ?? -Infinity)).length;
  const visible = rows.slice(pending);
  const selectedCard = cardById(board?.cards, cardId);

  function memberName(id: string) {
    const member = byId.get(id);
    return userLabel(member?.displayName, member?.email ?? id);
  }

  return (
    <section
      className="space-y-3 p-4 [overflow-wrap:anywhere]"
      aria-busy={!page && !error}
    >
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
        <h3
          ref={heading}
          tabIndex={-1}
          className="min-w-0 text-ui-title font-semibold"
        >
          {selectedCard?.title ?? t("inspector.boardActivity")}
        </h3>
        {cardId ? (
          <Button
            variant="ghost"
            size="sm"
            className="inspector-action max-w-full whitespace-normal"
            onClick={onClearCard}
          >
            {t("inspector.boardActivity")}
          </Button>
        ) : null}
      </div>
      {error ? (
        <div className="flex flex-wrap items-center gap-2 text-ui-body">
          <p>{t("watch.feedError")}</p>
          <Button
            variant="outline"
            size="sm"
            className="inspector-action"
            onClick={refresh}
          >
            {t("sync.retry")}
          </Button>
        </div>
      ) : null}
      {!page && !error ? (
        <p className="text-ui-body text-muted-foreground">
          {t("watch.feedLoading")}
        </p>
      ) : null}
      {pending > 0 ? (
        <Button
          variant="outline"
          size="sm"
          className="inspector-action w-full"
          onClick={() => {
            setSeen(latest());
            setAnnouncements((count) => count + 1);
            heading.current?.focus();
          }}
        >
          {t("inspector.newActivity")}
        </Button>
      ) : null}
      <p className="sr-only" role="status">
        {announcements > 0 ? (
          <span key={announcements}>{t("inspector.activityShown")}</span>
        ) : null}
      </p>
      {page && rows.length === 0 ? (
        <p className="text-ui-body text-muted-foreground">
          {t("watch.feedEmpty")}
        </p>
      ) : null}
      {visible.length > 0 ? (
        <ol className="divide-y border-t">
          {visible.map((entry) => {
            const member = entry.actorId ? byId.get(entry.actorId) : undefined;
            const actorName =
              entry.actorType === "admin"
                ? t("activity.administrator")
                : (entry.agentName ??
                  userLabel(
                    member?.displayName ?? entry.actorName,
                    member?.email ?? entry.actorEmail ?? entry.actorId ?? "—",
                  ));
            const sentence = sentenceFor(
              entry,
              lang,
              hour12,
              activityAssignee(entry, memberName),
            );
            const card = cardId
              ? undefined
              : cardById(board?.cards, entry.cardId);
            return (
              <li
                key={activityEntryKey(entry)}
                className="space-y-0.5 py-2 text-ui-body"
              >
                <div className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3">
                  <span className="truncate font-semibold" title={actorName}>
                    {actorName}
                  </span>
                  <time
                    className="text-ui-label text-muted-foreground tabular-nums"
                    dateTime={new Date(entry.at).toISOString()}
                  >
                    {formatDate(entry.at, lang, hour12)}
                  </time>
                </div>
                <p className="line-clamp-3">
                  {card ? (
                    <span className="text-muted-foreground">
                      {card.title} ·{" "}
                    </span>
                  ) : null}
                  {t(sentence.key, sentence.params)}
                </p>
              </li>
            );
          })}
        </ol>
      ) : null}
    </section>
  );
}
