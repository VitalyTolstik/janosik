import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type {
  ActivityChange,
  ActivityFeedEntry,
  BoardMemberDto,
} from "@janosik/shared";

import { AgentAttribution } from "@/components/agents/AgentAttribution";
import { shortId } from "@/components/agents/agent-model";
import { WatchFeedSkeleton } from "@/components/board/ViewSkeleton";
import { SkeletonRegion } from "@/components/ui/skeleton";
import {
  ACTIVITY_PAGE_SIZE,
  useBoardActivityFeed,
} from "@/hooks/use-board-activity-feed";
import { useHour12, useI18n } from "@/i18n";
import { useBoard } from "@/store/BoardContext";
import { useBoardMembersList, useBoardPresence } from "@/store/board-live";
import {
  activityEntryKey,
  activityHasStory,
  activityAssignee,
  FIELD_KEYS,
  formatChangeValue,
  sentenceFor,
} from "@/utils/activity";
import { userLabel } from "@/utils/avatar";
import { diffSides, type DiffSides } from "@/utils/diff-words";

/** A feed value is a display snippet, not the whole field: cap its width. */
const MAX_VALUE_CHARS = 120;
/** Page buttons kept around the current one before an ellipsis. */
const PAGE_WINDOW = 2;
/** How far back an agent's action still counts as "working now" (TASK-157). */
const AGENT_WINDOW_MS = 180_000;

/** One recently-active agent and how long ago it last acted. */
interface AgentActivity {
  /** Token/session identity: two PATs of one account are two agents. */
  key: string;
  actorId: string;
  tokenId?: string;
  sessionId?: string;
  runId?: string;
  agentName?: string;
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
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(ACTIVITY_PAGE_SIZE);
  const feed = useBoardActivityFeed(boardId, {
    active: page === 0,
    size: pageSize,
  });
  const { serverMode, loadPage, refresh } = feed;
  const [history, setHistory] = useState(
    () => new Map<number, Awaited<ReturnType<typeof loadPage>>>(),
  );
  const [pageLoading, setPageLoading] = useState(false);
  const [historyError, setHistoryError] = useState<number | null>(null);
  const current = page === 0 ? feed.page : history.get(page);
  const loaded = current != null;
  const loading = pageLoading || (page === 0 && feed.size !== pageSize);
  const error = historyError !== null || (page === 0 && feed.error);
  const items =
    current?.items.filter((entry) => {
      if (page === 0) return true;
      const deletedAt = feed.deleted.get(entry.commentId ?? entry.detail ?? "");
      return (
        deletedAt === undefined ||
        deletedAt <= current.generation ||
        entry.type === "comment_deleted"
      );
    }) ?? [];
  const newestKnown = history.size > 0 ? history.get(history.size) : feed.page;
  const atEnd = newestKnown?.nextCursor == null;
  const lastPage = history.size + (atEnd ? 0 : 2);
  const [activeAgents, setActiveAgents] = useState<AgentActivity[]>([]);
  // Last action time per agent, kept across page loads so membership is a
  // real sliding window (AGENT_WINDOW_MS), not "whoever is on the newest page"
  // — under a swarm 50 rows can span a few seconds. The key is the token (or
  // the session when no token id is present): TASK-166 made two PATs of one
  // account distinguishable, and the rail must not merge them back.
  const agentSeen = useRef(
    new Map<
      string,
      {
        at: number;
        actorId: string;
        tokenId?: string;
        sessionId?: string;
        runId?: string;
        agentName?: string;
      }
    >(),
  );

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
      const key =
        entry.apiTokenId ?? entry.agentSessionId ?? `actor:${entry.actorId}`;
      const current = seen.get(key);
      // Keep the newest identity snapshot (token name/session id) with the
      // newest timestamp; older pages must not overwrite it with NULLs.
      if (current === undefined || entry.at >= current.at) {
        seen.set(key, {
          at: Math.max(current?.at ?? 0, entry.at),
          actorId: entry.actorId,
          tokenId: entry.apiTokenId ?? current?.tokenId,
          sessionId: entry.agentSessionId ?? current?.sessionId,
          runId: entry.runId ?? current?.runId ?? undefined,
          agentName: entry.agentName ?? current?.agentName,
        });
      }
    }
    const now = Date.now();
    const active: AgentActivity[] = [];
    for (const [key, last] of seen) {
      if (now - last.at > AGENT_WINDOW_MS) {
        seen.delete(key);
        continue;
      }
      active.push({
        key,
        actorId: last.actorId,
        tokenId: last.tokenId,
        sessionId: last.sessionId,
        runId: last.runId,
        agentName: last.agentName,
        ageMs: now - last.at,
      });
    }
    active.sort((a, b) => a.ageMs - b.ageMs);
    setActiveAgents(active);
  }, []);

  useEffect(() => {
    if (page !== 0 || !feed.page) return;
    // Age the rolling agent rail on every successful newest-page refresh.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    rememberAgents(feed.page.items);
  }, [feed.page, page, rememberAgents]);

  async function goToPage(target: number) {
    if (target < 0 || loading) return;
    setHistoryError(null);
    if (target === 0) {
      setHistory(new Map());
      setPage(0);
      return;
    }
    const cached = history.get(target);
    const deletionIsNewer = (generation: number) =>
      [...feed.deleted.values()].some((at) => at > generation);
    if (cached && !deletionIsNewer(cached.generation)) {
      setPage(target);
      return;
    }
    setPageLoading(true);
    const pages = new Map(history);
    try {
      let previous = feed.page;
      for (let index = 1; index <= target; index += 1) {
        const existing = pages.get(index);
        if (
          existing &&
          (index !== target || !deletionIsNewer(existing.generation))
        ) {
          previous = existing;
          continue;
        }
        if (!previous?.nextCursor) return;
        previous = await loadPage(previous.nextCursor, pageSize);
        pages.set(index, previous);
      }
      setPage(target);
    } catch {
      setHistoryError(target);
    } finally {
      setHistory(pages);
      setPageLoading(false);
    }
  }

  function selectPageSize(size: number) {
    if (size === pageSize) return;
    setHistoryError(null);
    setHistory(new Map());
    setPage(0);
    setPageSize(size);
  }

  function retryFeed() {
    if (historyError === null) refresh();
    else void goToPage(historyError);
  }

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
  // Only active cards: archived cards live in `board.cards` but not in any
  // column, and a status wall must agree with the column sums next to it.
  const totalCards = cardCount;

  return (
    <section
      data-watch
      data-testid="watch-view"
      className="flex min-h-0 flex-1 flex-col overflow-hidden border border-muted-foreground/40 font-mono"
    >
      {/* Big status header: the whole point of the view. The board name is
          already in the top bar, so it is not repeated here. */}
      <header className="flex flex-wrap items-baseline gap-x-8 gap-y-2 border-b border-muted-foreground/40 px-5 py-4">
        <h2 className="text-ui-micro uppercase tracking-widest text-muted-foreground">
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
              ? "ml-auto text-ui-micro font-semibold uppercase tracking-widest text-(--chip-red)"
              : "ml-auto text-ui-micro uppercase tracking-widest text-muted-foreground"
          }
        >
          {serverMode ? t("watch.live") : t("watch.local")}
        </span>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(14rem,20rem)_1fr]">
        {/* Left rail: column status + who is online. */}
        <aside className="min-h-0 overflow-y-auto overflow-x-hidden overscroll-contain border-b border-muted-foreground/30 lg:border-b-0 lg:border-r">
          <Section title={t("watch.columnList")}>
            <ul data-testid="watch-column-list">
              {board.columns.map((column) => {
                const count = column.cardIds.length;
                return (
                  <li
                    key={column.id}
                    className="flex items-baseline justify-between gap-3 border-b border-muted-foreground/30 py-1.5 text-ui-body last:border-b-0"
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
              <p className="py-1 text-ui-body text-muted-foreground">
                {t("watch.nobody")}
              </p>
            ) : (
              <ul data-testid="watch-presence-list">
                {presence.map((user) => (
                  <li
                    key={user.id}
                    className="truncate border-b border-muted-foreground/30 py-1.5 text-ui-body text-foreground/90 last:border-b-0"
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
              <p className="py-1 text-ui-body text-muted-foreground">
                {t("watch.noAgents")}
              </p>
            ) : (
              <ul data-testid="watch-agents-list">
                {activeAgents.map((agent) => {
                  const member = membersById.get(agent.actorId);
                  const human = userLabel(
                    member?.displayName ?? null,
                    member?.email ?? agent.actorId,
                  );
                  const name = agent.agentName ?? human;
                  return (
                    <li
                      key={agent.key}
                      className="flex items-baseline justify-between gap-3 border-b border-muted-foreground/30 py-1.5 text-ui-body last:border-b-0"
                    >
                      <span className="min-w-0" title={name}>
                        <span className="block truncate text-foreground/90">
                          {name}
                        </span>
                        <span
                          className="block truncate text-ui-micro text-muted-foreground"
                          title={`${human}${agent.sessionId ? ` · session ${agent.sessionId}` : ""}`}
                        >
                          {human}
                          {agent.sessionId
                            ? ` · ${t("agents.attribution.session")} ${shortId(agent.sessionId, 6)}`
                            : ""}
                        </span>
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
          <div className="border-b border-muted-foreground/40 px-5 py-2 text-ui-micro uppercase tracking-widest text-muted-foreground">
            {t("watch.feed")}
          </div>
          <div
            role="region"
            aria-label={t("watch.feed")}
            tabIndex={0}
            className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-busy={serverMode && !loaded && !error}
          >
            {error ? (
              <div
                data-testid="watch-error"
                className="flex items-center gap-3 border-b border-danger/30 bg-danger/10 px-5 py-3 text-ui-body text-(--chip-red)"
              >
                <span>{t("watch.feedError")}</span>
                <button
                  type="button"
                  data-testid="watch-retry"
                  onClick={retryFeed}
                  className="rounded-sm border border-danger/40 px-2 py-0.5 text-ui-label font-medium hover:bg-danger/10"
                >
                  {t("sync.retry")}
                </button>
              </div>
            ) : null}
            {!serverMode ? (
              <p className="px-5 py-4 text-ui-body text-muted-foreground">
                {t("watch.feedLocal")}
              </p>
            ) : !loaded && !error ? (
              <SkeletonRegion
                label={t("watch.feedLoading")}
                testId="watch-feed-skeleton"
              >
                <WatchFeedSkeleton rows={8} />
              </SkeletonRegion>
            ) : items.length === 0 ? (
              error ? null : (
                <p className="px-5 py-4 text-ui-body text-muted-foreground">
                  {t("watch.feedEmpty")}
                </p>
              )
            ) : (
              <ol data-testid="watch-feed">
                {items.filter(activityHasStory).map((entry) => (
                  <WatchRow
                    key={activityEntryKey(entry)}
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
      className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-muted-foreground/40 px-5 py-2 text-ui-label"
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
              className="px-1 text-muted-foreground"
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
                  ? "h-6 min-w-6 rounded-sm border border-primary/50 px-1.5 tabular-nums text-foreground max-lg:min-h-11 max-lg:min-w-11"
                  : "h-6 min-w-6 rounded-sm border border-transparent px-1.5 tabular-nums text-muted-foreground hover:border-border hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-60 max-lg:min-h-11 max-lg:min-w-11"
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
                ? "h-6 min-w-7 rounded-sm border border-primary/50 px-1.5 tabular-nums text-foreground max-lg:min-h-11 max-lg:min-w-11"
                : "h-6 min-w-7 rounded-sm border border-transparent px-1.5 tabular-nums text-muted-foreground hover:border-border hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-60 max-lg:min-h-11 max-lg:min-w-11"
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
      className="h-6 rounded-sm border border-border px-1.5 text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-40 max-lg:min-h-11 max-lg:min-w-11"
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
      <span className="text-ui-micro uppercase tracking-wide text-muted-foreground">
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
      <h3 className="mb-1 text-ui-micro uppercase tracking-widest text-muted-foreground">
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
  /** Character-level common prefix/suffix split for a two-sided text change. */
  sides?: DiffSides;
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
  const [expanded, setExpanded] = useState(false);
  const actor = entry.actorId ? members.get(entry.actorId) : undefined;
  const actorName =
    entry.actorType === "admin"
      ? t("activity.administrator")
      : entry.actorId
        ? userLabel(
            actor?.displayName ?? entry.actorName ?? null,
            actor?.email ?? entry.actorEmail ?? entry.actorId,
          )
        : "—";

  const card = entry.cardId ? cards[entry.cardId] : undefined;

  const memberName = (userId: string) => {
    const member = members.get(userId);
    return userLabel(member?.displayName ?? null, member?.email ?? userId);
  };

  const assigneeName = activityAssignee(entry, memberName);

  const sentence = sentenceFor(entry, lang, hour12, assigneeName);
  const details = detailsFor(entry, t, memberName, lang, hour12, expanded);
  const canExpand =
    entry.type !== "comment_deleted" &&
    ((entry.changes ?? []).some(
      (change) =>
        (change.from?.length ?? 0) > MAX_VALUE_CHARS ||
        (change.to?.length ?? 0) > MAX_VALUE_CHARS,
    ) ||
      (entry.detail?.length ?? 0) > MAX_VALUE_CHARS);
  const clock = new Date(entry.at).toLocaleTimeString(
    lang === "ru" ? "ru-RU" : "en-US",
    { hour12, hour: "2-digit", minute: "2-digit", second: "2-digit" },
  );

  return (
    <li
      data-testid="watch-entry"
      // Below 1024 px the feed pane is too narrow for the three-column row:
      // time + actor share the first line and the sentence gets the full
      // width on the next one. The fixed time/actor widths only return when
      // the header can afford them (QA-05).
      className="grid max-w-full grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 border-b border-muted-foreground/40 px-5 py-1.5 text-ui-body last:border-b-0 lg:grid-cols-[7.5rem_minmax(6rem,10rem)_1fr] lg:items-start lg:gap-x-0 lg:gap-y-0 lg:divide-x lg:divide-muted-foreground/40 lg:[&>*]:px-2 lg:[&>*:first-child]:pl-0 lg:[&>*:last-child]:pr-0"
    >
      <time
        data-testid="watch-entry-time"
        className="whitespace-nowrap pl-0 tabular-nums text-muted-foreground lg:border-r lg:border-muted-foreground/40 lg:px-2"
        dateTime={new Date(entry.at).toISOString()}
      >
        {clock}
      </time>
      <span
        data-testid="watch-entry-actor"
        className="flex min-w-0 items-center gap-1.5 text-foreground/80 lg:border-r lg:border-muted-foreground/40 lg:px-2"
        title={actorName}
      >
        <span className="truncate">{actorName}</span>
        {entry.actorType === "agent" ? (
          <span
            className="shrink-0 rounded bg-muted px-1 text-ui-micro font-medium uppercase tracking-wide text-muted-foreground"
            data-testid="actor-agent-badge"
            title={t("activity.agent")}
          >
            {t("activity.agent")}
          </span>
        ) : null}
      </span>
      <div
        data-testid="watch-entry-body"
        className="col-span-2 min-w-0 max-w-full break-words text-foreground/90 [overflow-wrap:anywhere] lg:col-span-1 lg:px-2 lg:pr-0"
      >
        <span
          data-testid="watch-entry-sentence"
          className="block min-w-0 break-words [overflow-wrap:anywhere]"
        >
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
            <span className="ml-2 inline-flex max-w-[calc(100%_-_0.5rem)] min-w-0 flex-wrap items-baseline gap-x-2 text-ui-meta [overflow-wrap:anywhere]">
              {details.map((detail, index) => (
                <span key={`${detail.label}-${index}`} className="min-w-0">
                  {detail.label ? (
                    <span className="text-muted-foreground">
                      {detail.label}:{" "}
                    </span>
                  ) : null}
                  {detail.from !== undefined && detail.sides === undefined ? (
                    <>
                      <span className="whitespace-pre-wrap text-(--chip-red) line-through [overflow-wrap:anywhere]">
                        {detail.from}
                      </span>
                      <span className="mx-1 text-muted-foreground">→</span>
                    </>
                  ) : null}
                  {detail.sides !== undefined ? (
                    <span className="inline-flex min-w-0 max-w-full flex-wrap items-baseline gap-x-1 [overflow-wrap:anywhere]">
                      <span className="min-w-0 whitespace-pre-wrap [overflow-wrap:anywhere]">
                        <DiffSegments segments={detail.sides.left} />
                      </span>
                      <span className="text-muted-foreground">→</span>
                      <span className="min-w-0 whitespace-pre-wrap [overflow-wrap:anywhere]">
                        <DiffSegments segments={detail.sides.right} />
                      </span>
                    </span>
                  ) : (
                    <span className="whitespace-pre-wrap text-(--chip-green) [overflow-wrap:anywhere]">
                      {detail.to}
                    </span>
                  )}
                </span>
              ))}
            </span>
          ) : null}
          {entry.actorType === "agent" ? (
            <AgentAttribution
              apiTokenId={entry.apiTokenId}
              agentSessionId={entry.agentSessionId}
              runId={entry.runId}
              agentName={entry.agentName}
              compact
              className="ml-2 align-baseline"
            />
          ) : null}
          {canExpand ? (
            <button
              type="button"
              className="ml-2 text-ui-label text-primary underline"
              onClick={() => setExpanded(!expanded)}
            >
              {t(expanded ? "watch.showLess" : "watch.showMore")}
            </button>
          ) : null}
        </span>
      </div>
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
  expanded: boolean,
): DetailPart[] {
  // A deletion is always a text-free tombstone, even when an old cached
  // payload still carries `changes`/`details`/`detail` from the pre-185.2
  // contract.
  if (entry.type === "comment_deleted") return [];
  const display = (value: string) => (expanded ? value : shorten(value));
  const changes: ActivityChange[] = (entry.changes ?? []).filter(
    (change) => change.field !== "checklistItemDone",
  );
  const parts: DetailPart[] = [];
  if (
    (entry.type === "member_role_changed" ||
      entry.type === "member_expiry_changed" ||
      entry.type === "SET_COLUMN_WIP_LIMIT" ||
      entry.type === "SORT_COLUMN" ||
      entry.type === "SET_COLUMN_CARD_ORDER") &&
    entry.detail
  ) {
    parts.push({ label: "", to: display(entry.detail) });
  }
  for (const change of changes) {
    // TASK-185.2: a long text field uses the shared character-level common
    // prefix/suffix split, so a long comment shows the changed fragment
    // instead of two almost identical walls. Short values keep the plain
    // `from → to` contract (`watch-details.spec`: one line-through with the
    // whole saved value). Collapsed rows are head-only so the value's hidden
    // tail cannot leak before "Show full values"; expanded rows fall back to
    // the full stored snapshot (the feed's stand-in until the revisions view).
    const longValue =
      (change.from?.length ?? 0) > MAX_VALUE_CHARS ||
      (change.to?.length ?? 0) > MAX_VALUE_CHARS;
    const diffable =
      !expanded &&
      longValue &&
      change.from !== null &&
      change.to !== null &&
      change.field !== "dueDate" &&
      change.field !== "priority" &&
      change.field !== "assignee" &&
      change.field !== "claimedBy" &&
      change.field !== "role" &&
      change.field !== "expiresAt";
    const sides =
      diffable && change.from !== null && change.to !== null
        ? diffSides(change.from, change.to, { headOnly: true })
        : null;
    if (change.field === "comment") {
      parts.push({
        label: "",
        ...(sides !== null
          ? { to: "", sides }
          : {
              ...(change.from !== null
                ? { from: `“${display(change.from)}”` }
                : {}),
              to: change.to === null ? "—" : `“${display(change.to)}”`,
            }),
      });
      continue;
    }
    parts.push({
      label: t(FIELD_KEYS[change.field] ?? "history.field.title"),
      ...(sides !== null
        ? { to: "", sides }
        : {
            ...(change.from !== null
              ? {
                  from: display(
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
            to: display(
              formatChangeValue(
                change.field,
                change.to,
                lang,
                hour12,
                memberName,
              ),
            ),
          }),
    });
  }
  // TASK-185.2: never fall back to a raw comment id. A `comment_updated`
  // row without a confirmed revision (or a legacy snapshot) keeps only the
  // localized sentence.
  if (
    parts.length === 0 &&
    entry.detail &&
    !entry.type.startsWith("comment_")
  ) {
    parts.push({ label: "", to: display(entry.detail) });
  }
  return parts;
}

/**
 * One half of a character diff: unchanged context muted, removed text struck
 * through, added text green. Text is rendered as text — no markdown, mentions
 * or URLs are interpreted — and `whitespace-pre-wrap` keeps line breaks.
 */
function DiffSegments({ segments }: { segments: DiffSides["left"] }) {
  return (
    <>
      {segments.map((segment, index) => {
        if (segment.kind === "same") {
          return (
            <span key={index} className="whitespace-pre-wrap">
              {segment.text}
            </span>
          );
        }
        return (
          <span
            key={index}
            data-diff={segment.kind}
            className={
              segment.kind === "removed"
                ? "whitespace-pre-wrap rounded-sm bg-danger/10 px-0.5 font-medium text-(--chip-red) line-through decoration-danger/50"
                : "whitespace-pre-wrap rounded-sm bg-success/10 px-0.5 font-medium text-(--chip-green)"
            }
          >
            {segment.text}
          </span>
        );
      })}
    </>
  );
}
