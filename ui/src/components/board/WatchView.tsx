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

/** Entries per page of the watch feed (server max is 100). */
const PAGE_SIZE = 50;
/** How often the newest page is re-read; commands have no SSE frame. */
const POLL_MS = 3000;
/** Coalesce SSE-triggered refreshes so a busy board cannot storm the API. */
const REFRESH_COALESCE_MS = 1000;
/** The most changed fields rendered inline (the rest stay off the line). */
const MAX_CHANGE_LINES = 3;
/** A feed value is a display snippet, not the whole field: cap its width. */
const MAX_VALUE_CHARS = 120;
/** Page buttons kept around the current one before an ellipsis. */
const PAGE_WINDOW = 2;
/** How far back an agent's action still counts as "working now" (TASK-157). */
const AGENT_WINDOW_MS = 180_000;

/** One recently-active agent and how long ago it last acted. */
interface AgentActivity {
  actorId: string;
  ageMs: number;
}

/** A compact "12s" / "3m" age label. */
function ageLabel(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  return seconds < 60 ? `${seconds}s` : `${Math.round(seconds / 60)}m`;
}

function shorten(value: string): string {
  return value.length > MAX_VALUE_CHARS
    ? `${value.slice(0, MAX_VALUE_CHARS)}…`
    : value;
}

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
 * The feed is `GET /boards/:id/activity` (commands + comments) and carries the
 * Jira-style `from → to` snapshot the card History renders, so a move or an
 * edit reads as more than "someone did something". The API pages by opaque
 * cursor, not by offset, so the numbered pager walks the cursor chain and
 * caches each page; page 1 keeps refreshing live, older pages stay put.
 * Presence and the column counts ride the normal realtime stream.
 */
export function WatchView({ boardId }: WatchViewProps) {
  const { board } = useBoard();
  const { t, lang } = useI18n();
  const hour12 = useHour12();
  const presence = useBoardPresence(boardId);
  const members = useBoardMembersList(boardId);
  const { activity, commits } = useBoardLive();
  const serverMode = isApiEnabled();

  const [items, setItems] = useState<ActivityFeedEntry[]>([]);
  const [page, setPage] = useState(0);
  const [maxPage, setMaxPage] = useState(0);
  const [atEnd, setAtEnd] = useState(false);
  const [loading, setLoading] = useState(false);
  const [pageSize, setPageSize] = useState(PAGE_SIZE);
  const [activeAgents, setActiveAgents] = useState<AgentActivity[]>([]);
  // Last action time per agent, kept across page loads so membership is a
  // real sliding window (AGENT_WINDOW_MS), not "whoever is on the newest page"
  // — under a swarm 50 rows can span a few seconds.
  const agentSeen = useRef(new Map<string, number>());

  // Cursor that fetches a given page (page 0 has none). A missing entry means
  // the page is not reachable yet — the chain is discovered by walking.
  const cursorByPage = useRef(new Map<number, string | null>([[0, null]]));
  const pageCache = useRef(new Map<number, ActivityFeedEntry[]>());
  const atEndRef = useRef(false);
  const pageRef = useRef(0);
  const inFlight = useRef(false);
  // Mirror the page for the stable poll callback without reading a ref in
  // render (react-hooks/refs).
  useEffect(() => {
    pageRef.current = page;
  }, [page]);

  /**
   * Fold the newest page into the rolling agent map and publish the agents
   * seen within {@link AGENT_WINDOW_MS}, most recent first. An agent keeps its
   * slot for the whole window even after its rows scroll off the page, and
   * drops out only once it has been idle that long.
   */
  const rememberAgents = useCallback((items: ActivityFeedEntry[]) => {
    const seen = agentSeen.current;
    for (const entry of items) {
      if (entry.actorType !== "agent" || !entry.actorId) continue;
      seen.set(entry.actorId, Math.max(seen.get(entry.actorId) ?? 0, entry.at));
    }
    const now = Date.now();
    const active: AgentActivity[] = [];
    for (const [actorId, lastAt] of seen) {
      if (now - lastAt > AGENT_WINDOW_MS) {
        seen.delete(actorId);
        continue;
      }
      active.push({ actorId, ageMs: now - lastAt });
    }
    active.sort((a, b) => a.ageMs - b.ageMs);
    setActiveAgents(active);
  }, []);

  /** Fetch (and cache) one page, discovering the next page's cursor. */
  const fetchPage = useCallback(
    async (index: number): Promise<ActivityFeedEntry[] | null> => {
      const cached = pageCache.current.get(index);
      if (cached !== undefined) return cached;
      if (!cursorByPage.current.has(index)) return null;
      const cursor = cursorByPage.current.get(index) ?? undefined;
      const result = await api.boardActivity(boardId, cursor, pageSize);
      pageCache.current.set(index, result.items);
      if (result.nextCursor === null) {
        atEndRef.current = true;
        setAtEnd(true);
      } else {
        cursorByPage.current.set(index + 1, result.nextCursor);
        setMaxPage(Math.max(...cursorByPage.current.keys()));
      }
      return result.items;
    },
    [boardId, pageSize],
  );

  const goToPage = useCallback(
    async (target: number) => {
      if (target < 0 || loading) return;
      setLoading(true);
      try {
        // Walk the cursor chain until the target page is reachable.
        let index = 0;
        while (index < target) {
          if (!cursorByPage.current.has(index + 1)) {
            if (atEndRef.current) break;
            await fetchPage(index);
            if (atEndRef.current) break;
          }
          index += 1;
        }
        const targetItems = await fetchPage(target);
        if (targetItems === null) return; // beyond the last page
        setItems(targetItems);
        setPage(target);
      } catch {
        /* keep the current page; the next click retries */
      } finally {
        setLoading(false);
      }
    },
    [fetchPage, loading],
  );

  /** Load page 0 at `size` and reset the cursor chain to it. */
  const loadFirst = useCallback(
    async (size: number) => {
      const result = await api.boardActivity(boardId, undefined, size);
      pageCache.current.clear();
      pageCache.current.set(0, result.items);
      cursorByPage.current.clear();
      cursorByPage.current.set(0, null);
      atEndRef.current = result.nextCursor === null;
      setAtEnd(result.nextCursor === null);
      if (result.nextCursor !== null) {
        cursorByPage.current.set(1, result.nextCursor);
      }
      setMaxPage(Math.max(...cursorByPage.current.keys()));
      setItems(result.items);
      rememberAgents(result.items);
      setPage(0);
      pageRef.current = 0;
    },
    [boardId, rememberAgents],
  );

  // The newest page stays live; when the user pages into history, polling
  // pauses (their page must not shift under them).
  const refreshNewest = useCallback(async () => {
    if (!serverMode || inFlight.current || pageRef.current !== 0) return;
    inFlight.current = true;
    try {
      await loadFirst(pageSize);
    } catch {
      /* best effort — the next tick retries */
    } finally {
      inFlight.current = false;
    }
  }, [loadFirst, pageSize, serverMode]);

  // SSE frames arrive per command; on a busy board a refetch per frame would
  // hammer the feed endpoint (and the rate limit), so bursts are coalesced
  // into at most one refresh per REFRESH_COALESCE_MS.
  const refreshTimer = useRef<number | null>(null);
  const scheduleRefresh = useCallback(() => {
    if (refreshTimer.current !== null) return;
    refreshTimer.current = window.setTimeout(() => {
      refreshTimer.current = null;
      void refreshNewest();
    }, REFRESH_COALESCE_MS);
  }, [refreshNewest]);

  /** Change the page size and jump back to the live first page. */
  const selectPageSize = useCallback(
    (size: number) => {
      if (size === pageSize) return;
      setPageSize(size);
      setLoading(true);
      void loadFirst(size)
        .catch(() => undefined)
        .finally(() => setLoading(false));
    },
    [loadFirst, pageSize],
  );

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
  // change sooner than the poll. Coalesced: a swarm can emit frames far faster
  // than a refetch is worth.
  useEffect(() => {
    if (!serverMode) return;
    const offActivity = activity.subscribe((event) => {
      if (event.boardId === boardId) scheduleRefresh();
    });
    const offCommits = commits.subscribe((id) => {
      if (id === boardId) scheduleRefresh();
    });
    return () => {
      offActivity();
      offCommits();
      if (refreshTimer.current !== null) {
        window.clearTimeout(refreshTimer.current);
        refreshTimer.current = null;
      }
    };
  }, [activity, commits, boardId, scheduleRefresh, serverMode]);

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
  const lastPage = atEnd ? maxPage : maxPage + 1;

  return (
    <section
      data-watch
      data-testid="watch-view"
      className="flex min-h-0 flex-1 flex-col overflow-hidden border border-muted-foreground/40 font-mono"
    >
      {/* Big status header: the whole point of the view. The board name is
          already in the top bar, so it is not repeated here. */}
      <header className="flex flex-wrap items-baseline gap-x-8 gap-y-2 border-b border-muted-foreground/40 px-5 py-4">
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
          <Stat
            label={t("watch.agents")}
            value={String(activeAgents.length)}
            testId="watch-agents"
          />
        </div>
        <span
          className={
            serverMode
              ? "ml-auto text-xs font-semibold uppercase tracking-widest text-danger"
              : "ml-auto text-xs uppercase tracking-widest text-muted-foreground"
          }
        >
          {serverMode ? t("watch.live") : t("watch.local")}
        </span>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[minmax(14rem,20rem)_1fr]">
        {/* Left rail: column status + who is online. */}
        <aside className="min-h-0 overflow-y-auto overflow-x-hidden overscroll-contain border-b border-muted-foreground/30 md:border-b-0 md:border-r">
          <Section title={t("watch.columnList")}>
            <ul data-testid="watch-column-list">
              {board.columns.map((column) => {
                const count = column.cardIds.length;
                return (
                  <li
                    key={column.id}
                    className="flex items-baseline justify-between gap-3 border-b border-muted-foreground/30 py-1.5 text-sm last:border-b-0"
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
                    className="truncate border-b border-muted-foreground/30 py-1.5 text-sm text-foreground/90 last:border-b-0"
                  >
                    {user.displayName || user.id}
                  </li>
                ))}
              </ul>
            )}
          </Section>

          {/* Agents never open an SSE stream, so they are not in "Online";
              their recent activity is shown here instead (TASK-157). */}
          <Section title={t("watch.agentsList")}>
            {activeAgents.length === 0 ? (
              <p className="py-1 text-sm text-muted-foreground/70">
                {t("watch.noAgents")}
              </p>
            ) : (
              <ul data-testid="watch-agents-list">
                {activeAgents.map((agent) => {
                  const member = membersById.get(agent.actorId);
                  const name = userLabel(
                    member?.displayName ?? null,
                    member?.email ?? agent.actorId,
                  );
                  return (
                    <li
                      key={agent.actorId}
                      className="flex items-baseline justify-between gap-3 border-b border-muted-foreground/30 py-1.5 text-sm last:border-b-0"
                    >
                      <span
                        className="min-w-0 truncate text-foreground/90"
                        title={name}
                      >
                        {name}
                      </span>
                      <span
                        className="shrink-0 tabular-nums text-muted-foreground"
                        title={t("watch.agentAge")}
                      >
                        {ageLabel(agent.ageMs)}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </Section>
        </aside>

        {/* Right pane: the paged live feed. */}
        <div className="flex min-h-0 flex-col">
          <div className="border-b border-muted-foreground/40 px-5 py-2 text-[11px] uppercase tracking-widest text-muted-foreground">
            {t("watch.feed")}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain">
            {!serverMode ? (
              <p className="px-5 py-4 text-sm text-muted-foreground/70">
                {t("watch.feedLocal")}
              </p>
            ) : items.length === 0 ? (
              <p className="px-5 py-4 text-sm text-muted-foreground/70">
                {t("watch.feedEmpty")}
              </p>
            ) : (
              <ol data-testid="watch-feed">
                {items.filter(hasStory).map((entry) => (
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
            )}
          </div>
          {serverMode ? (
            <Pager
              page={page}
              lastPage={lastPage}
              atEnd={atEnd}
              loading={loading}
              pageSize={pageSize}
              onGo={(target) => void goToPage(target)}
              onPageSize={selectPageSize}
            />
          ) : null}
        </div>
      </div>
    </section>
  );
}

/** Stable per-entry key: a command id and an activity id never share a space. */
function keyOf(entry: ActivityFeedEntry): string {
  return `${entry.source}:${entry.id}`;
}

/**
 * Does this entry say anything? `TOUCH_CARD` only stamps `updatedAt` after an
 * edit session, and an `UPDATE_CARD` with no captured diff would read as a
 * bare "Updated the card" — both are noise on a watch wall. Everything else
 * (creates, moves, comments, archive, links) carries a story.
 */
function hasStory(entry: ActivityFeedEntry): boolean {
  if (entry.type === "TOUCH_CARD") return false;
  if (entry.type === "UPDATE_CARD") {
    const changes = (entry.changes ?? []).filter(
      (change) => change.field !== "checklistItemDone",
    );
    return changes.length > 0 || Boolean(entry.detail);
  }
  return true;
}

/** The page numbers to show: a window around the current page plus the ends. */
function pageNumbers(page: number, lastPage: number): (number | "gap")[] {
  const total = lastPage + 1; // 1-based count of known pages
  if (total <= 2 * PAGE_WINDOW + 3) {
    return Array.from({ length: total }, (_, index) => index);
  }
  const out: (number | "gap")[] = [];
  const from = Math.max(1, page - PAGE_WINDOW);
  const to = Math.min(lastPage - 1, page + PAGE_WINDOW);
  out.push(0);
  if (from > 1) out.push("gap");
  for (let index = from; index <= to; index += 1) out.push(index);
  if (to < lastPage - 1) out.push("gap");
  out.push(lastPage);
  return out;
}

function Pager({
  page,
  lastPage,
  atEnd,
  loading,
  pageSize,
  onGo,
  onPageSize,
}: {
  page: number;
  lastPage: number;
  atEnd: boolean;
  loading: boolean;
  pageSize: number;
  onGo: (target: number) => void;
  onPageSize: (size: number) => void;
}) {
  const { t } = useI18n();
  const canNext = !atEnd || page < lastPage;
  return (
    <nav
      aria-label={t("watch.feed")}
      data-testid="watch-pager"
      className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-muted-foreground/40 px-5 py-2 text-xs"
    >
      <div className="flex items-center gap-1">
        <PageButton
          label={t("watch.prev")}
          disabled={page === 0 || loading}
          onClick={() => onGo(page - 1)}
          testId="watch-prev"
        />
        {pageNumbers(page, lastPage).map((entry, index) =>
          entry === "gap" ? (
            <span
              key={`gap-${index}`}
              className="px-1 text-muted-foreground/60"
              aria-hidden
            >
              …
            </span>
          ) : (
            <button
              key={entry}
              type="button"
              disabled={loading}
              aria-current={entry === page ? "page" : undefined}
              aria-label={t("watch.page", { page: String(entry + 1) })}
              onClick={() => onGo(entry)}
              data-testid={`watch-page-${entry + 1}`}
              className={
                entry === page
                  ? "h-6 min-w-6 rounded-sm border border-primary/50 px-1.5 tabular-nums text-foreground"
                  : "h-6 min-w-6 rounded-sm border border-transparent px-1.5 tabular-nums text-muted-foreground hover:border-border hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-60"
              }
            >
              {entry + 1}
            </button>
          ),
        )}
        <PageButton
          label={t("watch.next")}
          disabled={!canNext || loading}
          onClick={() => onGo(page + 1)}
          testId="watch-next"
        />
        {loading ? (
          <span className="ml-1 text-muted-foreground">
            {t("watch.loading")}
          </span>
        ) : null}
      </div>
      <span
        role="group"
        aria-label={t("watch.perPage")}
        className="ml-auto flex items-center gap-1 whitespace-nowrap text-muted-foreground"
      >
        {t("watch.perPage")}
        {[20, 50, 100].map((size) => (
          <button
            key={size}
            type="button"
            disabled={loading}
            aria-pressed={pageSize === size}
            onClick={() => onPageSize(size)}
            data-testid={`watch-page-size-${size}`}
            className={
              pageSize === size
                ? "h-6 min-w-7 rounded-sm border border-primary/50 px-1.5 tabular-nums text-foreground"
                : "h-6 min-w-7 rounded-sm border border-transparent px-1.5 tabular-nums text-muted-foreground hover:border-border hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-60"
            }
          >
            {size}
          </button>
        ))}
      </span>
    </nav>
  );
}

function PageButton({
  label,
  disabled,
  onClick,
  testId,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  testId: string;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      data-testid={testId}
      className="h-6 rounded-sm border border-border px-1.5 text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-40"
    >
      {label}
    </button>
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
  const assigneeName = assigneeTo === null ? null : memberName(assigneeTo);

  const sentence = sentenceFor(entry, lang, hour12, assigneeName);
  const details = detailsFor(entry, t, memberName, lang, hour12);
  const clock = new Date(entry.at).toLocaleTimeString(
    lang === "ru" ? "ru-RU" : "en-US",
    { hour12, hour: "2-digit", minute: "2-digit", second: "2-digit" },
  );

  return (
    <li
      data-testid="watch-entry"
      className="grid grid-cols-[7.5rem_minmax(6rem,10rem)_1fr] divide-x divide-muted-foreground/40 border-b border-muted-foreground/40 px-5 py-1.5 text-sm last:border-b-0 [&>*]:px-2 [&>*:first-child]:pl-0 [&>*:last-child]:pr-0"
    >
      <time
        className="whitespace-nowrap tabular-nums text-muted-foreground"
        dateTime={new Date(entry.at).toISOString()}
      >
        {clock}
      </time>
      <span
        className="flex min-w-0 items-center gap-1.5 text-foreground/80"
        title={actorName}
      >
        <span className="truncate">{actorName}</span>
        {entry.actorType === "agent" ? (
          <span
            className="shrink-0 rounded bg-muted px-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground"
            data-testid="actor-agent-badge"
            title={t("activity.agent")}
          >
            {t("activity.agent")}
          </span>
        ) : null}
      </span>
      <span className="min-w-0 break-words text-foreground/90 [overflow-wrap:anywhere]">
        {card ? (
          <span
            className="text-muted-foreground [overflow-wrap:anywhere]"
            title={card.title}
          >
            {card.title} ·{" "}
          </span>
        ) : null}
        {t(sentence.key, sentence.params)}
        {details.length > 0 ? (
          <span className="ml-2 inline-flex flex-wrap items-baseline gap-x-2 text-[11px] [overflow-wrap:anywhere]">
            {details.map((detail, index) => (
              <span key={`${detail.label}-${index}`} className="min-w-0">
                {detail.label ? (
                  <span className="text-muted-foreground">
                    {detail.label}:{" "}
                  </span>
                ) : null}
                {detail.from !== undefined ? (
                  <>
                    <span className="text-danger/80 line-through [overflow-wrap:anywhere]">
                      {detail.from}
                    </span>
                    <span className="mx-1 text-muted-foreground/60">→</span>
                  </>
                ) : null}
                <span className="text-success/90 [overflow-wrap:anywhere]">
                  {detail.to}
                </span>
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
      parts.push({ label: "", to: `“${shorten(change.to ?? "")}”` });
      continue;
    }
    parts.push({
      label: t(FIELD_KEYS[change.field] ?? "history.field.title"),
      ...(change.from !== null
        ? {
            from: shorten(
              formatChangeValue(
                change.field,
                change.from,
                lang,
                hour12,
                memberName,
              ),
            ),
          }
        : {}),
      to: shorten(
        formatChangeValue(change.field, change.to, lang, hour12, memberName),
      ),
    });
  }
  if (parts.length === 0 && entry.detail) {
    parts.push({ label: "", to: shorten(entry.detail) });
  }
  return parts;
}
