import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { ActivityFeedEntry, BoardMemberDto } from "@janosik/shared";

import { api, isApiEnabled } from "@/api/client";
import { useHour12, useI18n } from "@/i18n";
import { useBoard } from "@/store/BoardContext";
import {
  useBoardLive,
  useBoardMembersList,
  useBoardPresence,
} from "@/store/board-live";
import { sentenceFor } from "@/utils/activity";
import { userLabel } from "@/utils/avatar";

/** Newest-first page size of the watch feed (server max is 100). */
const FEED_LIMIT = 50;
/** How often the feed is re-read; commands have no per-event SSE push. */
const POLL_MS = 3000;

interface WatchViewProps {
  boardId: string;
}

/**
 * Watch view (TASK-142) — the swarm observer. Deliberately bare: no cards,
 * no drag & drop, no hover chrome, no animations or transitions. It renders
 * the board's status (column counts, online agents) and a live, newest-first
 * feed of what happened on the board, so a person can watch a swarm work
 * without the wall of cards.
 *
 * The feed merges the command log with activity rows through
 * `GET /boards/:id/activity`; commands have no dedicated SSE frame, so the
 * view re-reads the newest page on a timer and immediately on a comment frame
 * or a settled own command. Presence and the column counts ride the normal
 * realtime stream.
 */
export function WatchView({ boardId }: WatchViewProps) {
  const { board } = useBoard();
  const { t, lang } = useI18n();
  const hour12 = useHour12();
  const presence = useBoardPresence(boardId);
  const members = useBoardMembersList(boardId);
  const { activity, commits } = useBoardLive();
  const serverMode = isApiEnabled();

  const [entries, setEntries] = useState<ActivityFeedEntry[]>([]);
  const inFlight = useRef(false);

  const load = useCallback(async () => {
    if (!serverMode || inFlight.current) return;
    inFlight.current = true;
    try {
      const page = await api.boardActivity(boardId, undefined, FEED_LIMIT);
      setEntries((prev) =>
        // The poll usually returns the same head; skip the state churn.
        prev.length === page.items.length &&
        prev[0]?.id === page.items[0]?.id &&
        prev[0]?.source === page.items[0]?.source
          ? prev
          : page.items,
      );
    } catch {
      /* best effort — the next tick retries */
    } finally {
      inFlight.current = false;
    }
  }, [boardId, serverMode]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the page lands after the await, not synchronously
    void load();
  }, [load]);

  useEffect(() => {
    if (!serverMode) return;
    const timer = window.setInterval(() => {
      if (!document.hidden) void load();
    }, POLL_MS);
    const onVisible = () => {
      if (!document.hidden) void load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [load, serverMode]);

  // A comment frame and our own settled commands are the moments the feed can
  // change sooner than the poll.
  useEffect(() => {
    if (!serverMode) return;
    const offActivity = activity.subscribe((event) => {
      if (event.boardId === boardId) void load();
    });
    const offCommits = commits.subscribe((id) => {
      if (id === boardId) void load();
    });
    return () => {
      offActivity();
      offCommits();
    };
  }, [activity, commits, boardId, load, serverMode]);

  const membersById = useMemo(() => {
    const map = new Map<string, BoardMemberDto>();
    for (const member of members) map.set(member.userId, member);
    return map;
  }, [members]);

  if (!board) return null;

  const cardCount = board.columns.reduce(
    (sum, column) => sum + column.cardIds.length,
    0,
  );
  const totalCards = Math.max(cardCount, Object.keys(board.cards).length);

  return (
    <section
      data-watch
      data-testid="watch-view"
      className="flex min-h-0 flex-1 flex-col overflow-hidden border border-border font-mono"
    >
      {/* Big status header: the whole point of the view. The board name is
          already in the top bar, so it is not repeated here. */}
      <header className="flex flex-wrap items-baseline gap-x-8 gap-y-2 border-b border-border px-5 py-4">
        <h2 className="text-xs uppercase tracking-widest text-muted-foreground">
          {t("watch.title")}
        </h2>
        <div className="flex flex-wrap items-baseline gap-x-8 gap-y-2">
          <Stat
            label={t("watch.cards")}
            value={String(totalCards)}
            testId="watch-cards"
          />
          <Stat
            label={t("watch.columns")}
            value={String(board.columns.length)}
            testId="watch-columns"
          />
          <Stat
            label={t("watch.online")}
            value={String(presence.length)}
            testId="watch-online"
          />
        </div>
        <span className="ml-auto text-xs uppercase tracking-widest text-muted-foreground">
          {serverMode ? t("watch.live") : t("watch.local")}
        </span>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[minmax(14rem,20rem)_1fr]">
        {/* Left rail: column status + who is online. */}
        <aside className="min-h-0 overflow-y-auto overscroll-contain border-b border-border md:border-b-0 md:border-r">
          <Section title={t("watch.columnList")}>
            <ul data-testid="watch-column-list">
              {board.columns.map((column) => {
                const count = column.cardIds.length;
                return (
                  <li
                    key={column.id}
                    className="flex items-baseline justify-between gap-3 border-b border-border/60 py-1.5 text-sm last:border-b-0"
                  >
                    <span className="min-w-0 truncate text-foreground/90">
                      {column.title}
                    </span>
                    <span className="shrink-0 tabular-nums text-muted-foreground">
                      {column.wipLimit !== undefined
                        ? `${count}/${column.wipLimit}`
                        : count}
                    </span>
                  </li>
                );
              })}
            </ul>
          </Section>

          <Section title={t("watch.onlineList")}>
            {presence.length === 0 ? (
              <p className="py-1 text-sm text-muted-foreground/70">
                {t("watch.nobody")}
              </p>
            ) : (
              <ul data-testid="watch-presence-list">
                {presence.map((user) => (
                  <li
                    key={user.id}
                    className="truncate border-b border-border/60 py-1.5 text-sm text-foreground/90 last:border-b-0"
                  >
                    {user.displayName || user.id}
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </aside>

        {/* Right pane: the live feed. */}
        <div className="flex min-h-0 flex-col">
          <div className="border-b border-border px-5 py-2 text-[11px] uppercase tracking-widest text-muted-foreground">
            {t("watch.feed")}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
            {!serverMode ? (
              <p className="px-5 py-4 text-sm text-muted-foreground/70">
                {t("watch.feedLocal")}
              </p>
            ) : entries.length === 0 ? (
              <p className="px-5 py-4 text-sm text-muted-foreground/70">
                {t("watch.feedEmpty")}
              </p>
            ) : (
              <ol data-testid="watch-feed">
                {entries.map((entry) => (
                  <WatchRow
                    key={`${entry.source}:${entry.id}`}
                    entry={entry}
                    members={membersById}
                    cards={board.cards}
                    lang={lang}
                    hour12={hour12}
                  />
                ))}
              </ol>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function Stat({
  label,
  value,
  testId,
}: {
  label: string;
  value: string;
  testId: string;
}) {
  return (
    <div className="flex items-baseline gap-2">
      <span
        data-testid={testId}
        className="text-2xl font-semibold tabular-nums text-foreground"
      >
        {value}
      </span>
      <span className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="px-5 py-3">
      <h3 className="mb-1 text-[11px] uppercase tracking-widest text-muted-foreground">
        {title}
      </h3>
      {children}
    </div>
  );
}

/**
 * One feed line. Plain text only — no buttons, no avatars, no diffs: the
 * watch view is for reading, not editing.
 */
function WatchRow({
  entry,
  members,
  cards,
  lang,
  hour12,
}: {
  entry: ActivityFeedEntry;
  members: Map<string, BoardMemberDto>;
  cards: Record<string, { title: string }>;
  lang: "en" | "ru";
  hour12: boolean;
}) {
  const { t } = useI18n();
  const actor = entry.actorId ? members.get(entry.actorId) : undefined;
  const actorName = entry.actorId
    ? userLabel(actor?.displayName ?? null, actor?.email ?? entry.actorId)
    : "—";

  const card = entry.cardId ? cards[entry.cardId] : undefined;

  const isAssigneeEntry =
    entry.type === "SET_CARD_ASSIGN" || entry.type === "assignee-set";
  const assigneeTo = !isAssigneeEntry
    ? null
    : entry.type === "SET_CARD_ASSIGN"
      ? (entry.changes?.[0]?.to ?? null)
      : entry.detail || null;
  const assigneeMember = assigneeTo ? members.get(assigneeTo) : undefined;
  const assigneeName =
    assigneeTo === null
      ? null
      : assigneeTo === ""
        ? ""
        : userLabel(
            assigneeMember?.displayName ?? null,
            assigneeMember?.email ?? assigneeTo,
          );

  const sentence = sentenceFor(entry, lang, hour12, assigneeName);
  const clock = new Date(entry.at).toLocaleTimeString(
    lang === "ru" ? "ru-RU" : "en-US",
    { hour12, hour: "2-digit", minute: "2-digit", second: "2-digit" },
  );

  return (
    <li
      data-testid="watch-entry"
      className="grid grid-cols-[7.5rem_minmax(6rem,10rem)_1fr] gap-3 border-b border-border/50 px-5 py-1.5 text-sm last:border-b-0"
    >
      <time
        className="whitespace-nowrap tabular-nums text-muted-foreground"
        dateTime={new Date(entry.at).toISOString()}
      >
        {clock}
      </time>
      <span className="truncate text-foreground/80">{actorName}</span>
      <span className="min-w-0 truncate text-foreground/90">
        {card ? (
          <span className="text-muted-foreground">{card.title} · </span>
        ) : null}
        {t(sentence.key, sentence.params)}
      </span>
    </li>
  );
}
