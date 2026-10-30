import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type {
  ActivityChange,
  ActivityFeedEntry,
  BoardMemberDto,
} from "@janosik/shared";

import { api, isApiEnabled } from "@/api/client";
import { useHour12, useI18n } from "@/i18n";
import { useBoard } from "@/store/BoardContext";
import {
  useBoardLive,
  useBoardMembersList,
  useBoardPresence,
} from "@/store/board-live";
import { FIELD_KEYS, formatChangeValue, sentenceFor } from "@/utils/activity";
import { userLabel } from "@/utils/avatar";

/** Newest-first page size of the watch feed (server max is 100). */
const FEED_LIMIT = 50;
/** How often the feed is re-read; commands have no per-event SSE push. */
const POLL_MS = 3000;
/** The most changed fields rendered inline (the rest stay off the line). */
const MAX_CHANGE_LINES = 3;

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
 * or a settled own command. Each line carries the Jira-style `from → to` diff
 * frozen at command time (the same snapshot the card History renders), so a
 * move or an edit reads as more than "someone did something". Older entries
 * page in with a plain "Show older" button. Presence and the column counts
 * ride the normal realtime stream.
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
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const inFlight = useRef(false);
  // The cursor after the oldest *loaded* page; `undefined` = never loaded.
  const cursorRef = useRef<string | null | undefined>(undefined);

  const refreshNewest = useCallback(async () => {
    if (!serverMode || inFlight.current) return;
    inFlight.current = true;
    try {
      const page = await api.boardActivity(boardId, undefined, FEED_LIMIT);
      setEntries((prev) => {
        const seen = new Set(prev.map(keyOf));
        const fresh = page.items.filter((entry) => !seen.has(keyOf(entry)));
        return fresh.length === 0 ? prev : [...fresh, ...prev];
      });
      if (cursorRef.current === undefined) {
        cursorRef.current = page.nextCursor;
        setNextCursor(page.nextCursor);
      }
    } catch {
      /* best effort — the next tick retries */
    } finally {
      inFlight.current = false;
    }
  }, [boardId, serverMode]);

  const loadOlder = useCallback(async () => {
    if (
      !serverMode ||
      loadingOlder ||
      cursorRef.current === undefined ||
      cursorRef.current === null
    ) {
      return;
    }
    setLoadingOlder(true);
    try {
      const page = await api.boardActivity(
        boardId,
        cursorRef.current,
        FEED_LIMIT,
      );
      setEntries((prev) => {
        const seen = new Set(prev.map(keyOf));
        const older = page.items.filter((entry) => !seen.has(keyOf(entry)));
        return older.length === 0 ? prev : [...prev, ...older];
      });
      cursorRef.current = page.nextCursor;
      setNextCursor(page.nextCursor);
    } catch {
      /* keep the button; the next press retries */
    } finally {
      setLoadingOlder(false);
    }
  }, [boardId, loadingOlder, serverMode]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the page lands after the await, not synchronously
    void refreshNewest();
  }, [refreshNewest]);

  useEffect(() => {
    if (!serverMode) return;
    const timer = window.setInterval(() => {
      if (!document.hidden) void refreshNewest();
    }, POLL_MS);
    const onVisible = () => {
      if (!document.hidden) void refreshNewest();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refreshNewest, serverMode]);

  // A comment frame and our own settled commands are the moments the feed can
  // change sooner than the poll.
  useEffect(() => {
    if (!serverMode) return;
    const offActivity = activity.subscribe((event) => {
      if (event.boardId === boardId) void refreshNewest();
    });
    const offCommits = commits.subscribe((id) => {
      if (id === boardId) void refreshNewest();
    });
    return () => {
      offActivity();
      offCommits();
    };
  }, [activity, commits, boardId, refreshNewest, serverMode]);

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
              <>
                <ol data-testid="watch-feed">
                  {entries.map((entry) => (
                    <WatchRow
                      key={keyOf(entry)}
                      entry={entry}
                      members={membersById}
                      cards={board.cards}
                      lang={lang}
                      hour12={hour12}
                    />
                  ))}
                </ol>
                {nextCursor !== null ? (
                  <div className="px-5 py-2">
                    <button
                      type="button"
                      disabled={loadingOlder}
                      onClick={() => void loadOlder()}
                      className="rounded-sm text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-60"
                      data-testid="watch-show-older"
                    >
                      {loadingOlder ? t("watch.loading") : t("watch.showOlder")}
                    </button>
                  </div>
                ) : null}
              </>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

/** Stable per-entry key: a command id and an activity id never share a space. */
function keyOf(entry: ActivityFeedEntry): string {
  return `${entry.source}:${entry.id}`;
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

interface DetailPart {
  /** Field name (already localized); empty for a comment/detail-only part. */
  label: string;
  /** Absent for a creation/comment (nothing to strike through). */
  from?: string;
  to: string;
}

type Translate = ReturnType<typeof useI18n>["t"];

/**
 * One feed line: time, actor, action sentence and the inline diff. Plain
 * text only — no buttons, no avatars, no nested diffs.
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

  const memberName = (userId: string) => {
    const member = members.get(userId);
    return userLabel(member?.displayName ?? null, member?.email ?? userId);
  };

  const isAssigneeEntry =
    entry.type === "SET_CARD_ASSIGN" || entry.type === "assignee-set";
  const assigneeTo = !isAssigneeEntry
    ? null
    : entry.type === "SET_CARD_ASSIGN"
      ? (entry.changes?.[0]?.to ?? null)
      : entry.detail || null;
  const assigneeName =
    assigneeTo === null
      ? null
      : assigneeTo === ""
        ? ""
        : memberName(assigneeTo);

  const sentence = sentenceFor(entry, lang, hour12, assigneeName);
  const details = detailsFor(entry, t, memberName, lang, hour12);
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
      <span className="truncate text-foreground/80" title={actorName}>
        {actorName}
      </span>
      <span className="min-w-0 text-foreground/90">
        {card ? (
          <span className="text-muted-foreground" title={card.title}>
            {card.title} ·{" "}
          </span>
        ) : null}
        {t(sentence.key, sentence.params)}
        {details.length > 0 ? (
          <span className="ml-2 inline-flex flex-wrap items-baseline gap-x-2 text-[11px]">
            {details.map((detail, index) => (
              <span key={`${detail.label}-${index}`} className="min-w-0">
                {detail.label ? (
                  <span className="text-muted-foreground">
                    {detail.label}:{" "}
                  </span>
                ) : null}
                {detail.from !== undefined ? (
                  <>
                    <span className="text-danger/80 line-through">
                      {detail.from}
                    </span>
                    <span className="mx-1 text-muted-foreground/60">→</span>
                  </>
                ) : null}
                <span className="text-success/90">{detail.to}</span>
              </span>
            ))}
          </span>
        ) : null}
      </span>
    </li>
  );
}

/** The inline diff of one entry, or a single fallback `detail` part. */
function detailsFor(
  entry: ActivityFeedEntry,
  t: Translate,
  memberName: (userId: string) => string,
  lang: "en" | "ru",
  hour12: boolean,
): DetailPart[] {
  const changes: ActivityChange[] = (entry.changes ?? []).filter(
    (change) => change.field !== "checklistItemDone",
  );
  const parts: DetailPart[] = [];
  for (const change of changes.slice(0, MAX_CHANGE_LINES)) {
    if (change.field === "comment") {
      parts.push({ label: "", to: `“${change.to ?? ""}”` });
      continue;
    }
    parts.push({
      label: t(FIELD_KEYS[change.field] ?? "history.field.title"),
      ...(change.from !== null
        ? {
            from: formatChangeValue(
              change.field,
              change.from,
              lang,
              hour12,
              memberName,
            ),
          }
        : {}),
      to: formatChangeValue(change.field, change.to, lang, hour12, memberName),
    });
  }
  if (parts.length === 0 && entry.detail) {
    parts.push({ label: "", to: entry.detail });
  }
  return parts;
}
