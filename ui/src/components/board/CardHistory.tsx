import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import type {
  ActivityChange,
  ActivityFeedEntry,
  ActivitySseEvent,
  CardActivityEvent,
  CardPriority,
} from "@janosik/shared";
import { CARD_PRIORITIES } from "@janosik/shared";
import { priorityLabel } from "@/utils/priority";

import { api, isApiEnabled } from "@/api/client";
import {
  appendOlderActivity,
  CARD_ACTIVITY_PAGE_SIZE,
  mergeNewestActivity,
  type ActivityCount,
  type ActivityPage,
} from "@/components/board/card-activity-count";
import { CardSectionSkeleton } from "@/components/board/CardSectionSkeleton";
import { Button } from "@/components/ui/button";
import { SkeletonRegion } from "@/components/ui/skeleton";
import { UserAvatar } from "@/components/ui/user-avatar";
import { useOpenProfile } from "@/components/board/UserProfileDialog";
import { useToast } from "@/components/Toast";
import { cn } from "@/lib/utils";
import { formatDate, formatRelative, useHour12, useI18n } from "@/i18n";
import { useBoardLive, useBoardMember } from "@/store/board-live";
import {
  FIELD_KEYS,
  isStaleDeletedCommentEntry,
  reconcileRestoredComments,
  sentenceFor,
} from "@/utils/activity";
import { AgentAttribution } from "@/components/agents/AgentAttribution";
import { userLabel } from "@/utils/avatar";
import { diffSides, type DiffSegment } from "@/utils/diff-words";
import { foldHistory } from "@/utils/history-fold";

const PAGE_SIZE = CARD_ACTIVITY_PAGE_SIZE;

interface CardHistoryProps {
  cardId: string;
  boardId: string;
  updatedAt: number;
  /** Local-mode timeline (`card.activity`) when no server is reachable. */
  localActivity?: CardActivityEvent[];
  /** Undefined while loading, null when unavailable. */
  onCountChange?: (count: ActivityCount | null | undefined) => void;
}

/**
 * The History subsection of the Activity section (TASK-37): the server feed
 * of everything that happened to the card, newest-first, with Jira-style
 * "from → to" diffs frozen at command time (`Command.details`).
 *
 * Without a server the feed falls back to the in-memory reducer timeline —
 * the same events the old Activity block rendered, no diffs (the local
 * model never stored before/after pairs).
 */
export function CardHistory({
  cardId,
  boardId,
  updatedAt,
  localActivity,
  onCountChange,
}: CardHistoryProps) {
  const { t } = useI18n();
  const toast = useToast();
  const serverMode = isApiEnabled();
  const { activity, commits } = useBoardLive();

  const [feed, setFeed] = useState<ActivityPage<ActivityFeedEntry> | null>(
    null,
  );
  const nextCursor = feed?.nextCursor ?? null;
  // Distinguishes a real empty history from the first page still in flight.
  const [loaded, setLoaded] = useState(!serverMode);
  const aliveRef = useRef(true);
  // TASK-185.2: an in-flight page can resolve after the deletion frame.
  const deletedCommentIdsRef = useRef(new Map<string, number>());
  const deletionGenerationRef = useRef(0);
  const reconcileFreshPage = useCallback(
    (items: ActivityFeedEntry[], requestGeneration: number) => {
      reconcileRestoredComments(
        items,
        deletedCommentIdsRef.current,
        requestGeneration,
        (entry) => entry.commentId ?? entry.detail,
      );
    },
    [],
  );
  const withoutStaleDeleted = useCallback(
    (items: ActivityFeedEntry[], requestGeneration: number) =>
      items.filter(
        (entry) =>
          !isStaleDeletedCommentEntry(
            entry,
            deletedCommentIdsRef.current,
            requestGeneration,
          ),
      ),
    [],
  );
  /** Fresh page rows win on an id collision (a restore changes the projection). */
  const replacePageRows = useCallback(
    (items: ActivityFeedEntry[], pageItems: ActivityFeedEntry[]) => {
      const fresh = new Map(pageItems.map((entry) => [entry.id, entry]));
      return items.map((entry) => fresh.get(entry.id) ?? entry);
    },
    [],
  );
  const [loadingOlder, setLoadingOlder] = useState(false);

  const loadFirst = useCallback(async () => {
    if (!serverMode) return;
    const generation = deletionGenerationRef.current;
    try {
      const page = await api.cardActivity(cardId, undefined, PAGE_SIZE);
      if (!aliveRef.current) return;
      reconcileFreshPage(page.items, generation);
      setFeed({ ...page, items: withoutStaleDeleted(page.items, generation) });
    } catch {
      if (!aliveRef.current) return;
      toast.error(t("history.loadError"));
    } finally {
      if (aliveRef.current) setLoaded(true);
    }
  }, [cardId, reconcileFreshPage, serverMode, t, toast, withoutStaleDeleted]);

  // Threads are keyed by card id upstream, so mount state is the reset.
  useEffect(() => {
    aliveRef.current = true;
    void loadFirst();
    return () => {
      aliveRef.current = false;
    };
  }, [loadFirst]);

  const refreshNewest = useCallback(async () => {
    if (!serverMode) return;
    const generation = deletionGenerationRef.current;
    try {
      const page = await api.cardActivity(cardId, undefined, PAGE_SIZE);
      if (!aliveRef.current) return;
      reconcileFreshPage(page.items, generation);
      setFeed((current) => {
        const merged = current ? mergeNewestActivity(current, page) : page;
        return {
          ...merged,
          items: withoutStaleDeleted(
            replacePageRows(merged.items, page.items),
            generation,
          ),
        };
      });
    } catch {
      /* best effort */
    }
  }, [
    cardId,
    reconcileFreshPage,
    replacePageRows,
    serverMode,
    withoutStaleDeleted,
  ]);

  // A committed edit moves `updatedAt` (once per editing session — quiet
  // keystrokes only touch it at the end), so this is a cheap trigger for a
  // history refresh that is already debounced by the editing model itself.
  const firstUpdate = useRef(true);
  useEffect(() => {
    if (firstUpdate.current) {
      firstUpdate.current = false;
      return;
    }
    void refreshNewest();
  }, [updatedAt, refreshNewest]);

  useEffect(() => {
    if (!serverMode) return;
    return activity.subscribe((event: ActivitySseEvent) => {
      if (event.boardId !== boardId || event.cardId !== cardId) return;
      if (event.kind === "comment_deleted") {
        const deletedId = event.commentId ?? event.detail;
        if (deletedId) {
          deletionGenerationRef.current += 1;
          deletedCommentIdsRef.current.set(
            deletedId,
            deletionGenerationRef.current,
          );
          // TASK-185.2: drop the cached text/diff immediately and let the
          // refetch return the text-free tombstones. Keying on the typed id
          // also works for an actor-less master frame.
          setFeed((current) =>
            current
              ? {
                  ...current,
                  items: current.items.filter(
                    (entry) => (entry.commentId ?? entry.detail) !== deletedId,
                  ),
                }
              : current,
          );
        }
      }
      void refreshNewest();
    });
  }, [activity, boardId, cardId, serverMode, refreshNewest]);

  // Own commands settle here only after the server has them. The
  // optimistic `updatedAt` bump fires earlier and its fetch runs before
  // the command commits — without this signal the newest entry would
  // appear one action late.
  useEffect(() => {
    if (!serverMode) return;
    return commits.subscribe((committedBoardId) => {
      if (committedBoardId !== boardId) return;
      void refreshNewest();
    });
  }, [commits, boardId, serverMode, refreshNewest]);

  const handleShowOlder = async () => {
    if (nextCursor === null || loadingOlder) return;
    const generation = deletionGenerationRef.current;
    setLoadingOlder(true);
    try {
      const page = await api.cardActivity(cardId, nextCursor, PAGE_SIZE);
      reconcileFreshPage(page.items, generation);
      setFeed((current) => {
        if (!current) return current;
        const merged = appendOlderActivity(current, page, nextCursor);
        return {
          ...merged,
          items: withoutStaleDeleted(
            replacePageRows(merged.items, page.items),
            generation,
          ),
        };
      });
    } catch {
      toast.error(t("history.loadError"));
    } finally {
      setLoadingOlder(false);
    }
  };

  const visible: ActivityFeedEntry[] = serverMode
    ? foldHistory(feed?.items ?? [])
    : localEntries(localActivity ?? [], updatedAt);

  const loadedEvents = feed?.items.length ?? 0;
  const total = feed?.total;
  const hasCount = feed !== null || !serverMode;
  useEffect(() => {
    const count = hasCount
      ? {
          visible: visible.length,
          loaded: loadedEvents,
          truncated: nextCursor !== null,
          total,
        }
      : null;
    onCountChange?.(loaded ? count : undefined);
  }, [
    visible.length,
    loadedEvents,
    hasCount,
    loaded,
    nextCursor,
    total,
    onCountChange,
  ]);

  return (
    <div className="space-y-2" aria-busy={!loaded}>
      {!loaded ? (
        <SkeletonRegion
          label={t("history.loading")}
          testId="card-history-skeleton"
        >
          <CardSectionSkeleton kind="history" rows={4} />
        </SkeletonRegion>
      ) : visible.length === 0 && nextCursor === null ? (
        <p className="py-1 text-sm text-muted-foreground">
          {t("history.empty")}
        </p>
      ) : visible.length > 0 ? (
        <ol className="space-y-3" data-testid="history-list">
          {visible.map((entry) => (
            <HistoryRow boardId={boardId} entry={entry} key={entry.id} />
          ))}
        </ol>
      ) : null}
      {nextCursor !== null ? (
        <div className="pl-[36px]">
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground"
            disabled={loadingOlder}
            data-testid="history-show-older"
            onClick={() => void handleShowOlder()}
          >
            {loadingOlder ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : null}
            {t("history.showOlder")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/**
 * The local timeline as feed entries, newest-first, with the legacy
 * "created" fallback. Diffs are absent by design — only the server freezes
 * before/after snapshots.
 */
function localEntries(
  activity: CardActivityEvent[],
  updatedAt: number,
): ActivityFeedEntry[] {
  const events = [...activity];
  if (!events.some((event) => event.type === "created")) {
    events.unshift({
      id: "created",
      type: "created",
      at: 0,
      actorId: null,
    });
  }
  return events
    .reverse()
    .map((event, index) => ({
      source: "activity" as const,
      // Legacy synthesis has no stable id beyond the fallback position.
      id: event.id || `local-${index}-${event.at}`,
      at: event.at || updatedAt,
      type: event.type,
      actorId: event.actorId ?? "",
      ...(event.detail !== undefined ? { detail: event.detail } : {}),
    }))
    .filter((entry) => entry.at > 0);
}

interface HistoryRowProps {
  boardId: string;
  entry: ActivityFeedEntry;
}

function HistoryRow({ boardId, entry }: HistoryRowProps) {
  const { t, lang } = useI18n();
  const hour12 = useHour12();
  const openProfile = useOpenProfile();
  const member = useBoardMember(boardId, entry.actorId || undefined);
  const name =
    entry.actorType === "admin"
      ? t("activity.administrator")
      : entry.actorId
        ? userLabel(
            member?.displayName ?? entry.actorName ?? null,
            member?.email ?? entry.actorEmail ?? "",
          )
        : "";

  // An assignee entry names its subject in the sentence (TASK-49) — the
  // raw id from the change log resolves through the member directory. The
  // command reads the diff (`to`), the activity event the `detail`.
  const isAssigneeEntry =
    entry.type === "SET_CARD_ASSIGN" || entry.type === "assignee-set";
  const assigneeTo = !isAssigneeEntry
    ? undefined
    : entry.type === "SET_CARD_ASSIGN"
      ? (entry.changes?.[0]?.to ?? null)
      : entry.detail || null;
  const assigneeMember = useBoardMember(boardId, assigneeTo ?? undefined);
  const assigneeName =
    assigneeTo === undefined
      ? null
      : assigneeTo === null
        ? ""
        : userLabel(
            assigneeMember?.displayName ?? null,
            assigneeMember?.email ?? assigneeTo,
          );

  const sentence = sentenceFor(entry, lang, hour12, assigneeName);
  const changes = renderedChanges(entry);

  return (
    <li
      className="flex items-start gap-2.5 text-sm"
      data-testid="history-entry"
    >
      {entry.actorId && entry.actorType !== "admin" ? (
        <button
          type="button"
          aria-label={t("profile.open", { name })}
          onClick={() => openProfile(entry.actorId)}
          className="ml-0.5 mt-0.5 inline-flex shrink-0 rounded-full"
        >
          <UserAvatar
            userId={entry.actorId}
            displayName={member?.displayName ?? null}
            email={member?.email ?? ""}
            color={member?.avatarColor}
            avatarPath={member?.avatarPath}
            size="sm"
            className="ring-1 ring-border/60"
          />
        </button>
      ) : (
        <span className="ml-0.5 mt-0.5 h-6 w-6 shrink-0" aria-hidden />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <p className="min-w-0 flex-1 text-foreground/90">
            {name ? (
              <>
                {entry.actorType === "admin" ? (
                  <span className="font-medium">{name}</span>
                ) : (
                  <button
                    type="button"
                    onClick={() => openProfile(entry.actorId)}
                    className="font-medium hover:underline"
                  >
                    {name}
                  </button>
                )}
                <span className="text-muted-foreground/60"> · </span>
              </>
            ) : null}
            {entry.actorType === "agent" ? (
              <span
                className="mr-1 rounded bg-muted px-1 py-0.5 align-middle text-[10px] font-medium uppercase tracking-wide text-muted-foreground"
                data-testid="actor-agent-badge"
                title={t("activity.agent")}
              >
                {t("activity.agent")}
              </span>
            ) : null}
            {t(sentence.key, sentence.params)}
          </p>
          <time
            className="shrink-0 text-[11px] text-muted-foreground"
            dateTime={new Date(entry.at).toISOString()}
            title={formatDate(entry.at, lang, hour12)}
          >
            {/* eslint-disable-next-line react-hooks/purity -- relative time is refreshed every render on purpose */}
            {formatRelative(entry.at, lang, Date.now(), hour12)}
          </time>
        </div>
        {entry.actorType === "agent" &&
        (entry.apiTokenId || entry.agentSessionId || entry.runId) ? (
          <AgentAttribution
            apiTokenId={entry.apiTokenId}
            agentSessionId={entry.agentSessionId}
            runId={entry.runId}
            agentName={entry.agentName}
            className="mt-0.5"
          />
        ) : null}
        {changes && changes.length > 0 ? (
          <ul className="mt-1 space-y-0.5" data-testid="history-diff">
            {changes.map((change, index) => {
              const diffable =
                change.from !== null &&
                change.to !== null &&
                change.field !== "dueDate" &&
                change.field !== "priority" &&
                change.field !== "assignee";
              const sides = diffable
                ? diffSides(change.from ?? "", change.to ?? "")
                : null;
              return (
                <li
                  key={`${change.field}-${index}`}
                  className="grid grid-cols-[auto_minmax(0,1fr)_auto_minmax(0,1fr)] items-baseline gap-x-2 text-xs text-muted-foreground"
                >
                  <span className="font-medium text-foreground/70">
                    {t(FIELD_KEYS[change.field] ?? "history.field.title")}
                  </span>
                  {/* Jira's halves: what was on the left of the arrow, what
                      appeared on the right — equal space, wrapping freely.
                      The unchanged context shrinks to an ellipsis stub so
                      the highlighted fragment is what the eye lands on. */}
                  <span className="min-w-0 text-right [overflow-wrap:anywhere]">
                    {sides ? (
                      <DiffSegments segments={sides.left} />
                    ) : (
                      <HistoryValue
                        field={change.field}
                        value={change.from}
                        boardId={boardId}
                      />
                    )}
                  </span>
                  <span className="text-muted-foreground/50">→</span>
                  <span className="min-w-0 [overflow-wrap:anywhere]">
                    {sides ? (
                      <DiffSegments segments={sides.right} />
                    ) : (
                      <HistoryValue
                        field={change.field}
                        value={change.to}
                        boardId={boardId}
                      />
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        ) : null}
      </div>
    </li>
  );
}

/**
 * The diff lines worth showing. The done-toggle is encoded as a change so
 * the sentence can tell checked from unchecked; it is not a "from → to"
 * value the reader needs to see.
 */
function renderedChanges(
  entry: ActivityFeedEntry,
): ActivityChange[] | undefined {
  // Deletion is a metadata-only tombstone: a legacy/cached payload must not
  // resurrect the old body or a text → null diff.
  if (entry.type === "comment_deleted") return undefined;
  if (entry.changes === undefined) return undefined;
  const visible = entry.changes.filter(
    (change) => change.field !== "checklistItemDone",
  );
  return visible.length > 0 ? visible : undefined;
}

/**
 * One half of a word-diff: unchanged context in the muted body color, the
 * removed fragment struck through in red, the added one in green.
 */
function DiffSegments({ segments }: { segments: DiffSegment[] }) {
  return (
    <>
      {segments.map((segment, index) => {
        if (segment.kind === "same") {
          return (
            <span
              key={index}
              className="whitespace-pre-wrap text-foreground/70"
            >
              {segment.text}
            </span>
          );
        }
        return (
          <span
            key={index}
            data-diff={segment.kind}
            className={cn(
              "whitespace-pre-wrap rounded-sm px-0.5 font-medium",
              segment.kind === "removed"
                ? "bg-danger/10 text-(--chip-red) line-through decoration-danger/50"
                : "bg-success/10 text-(--chip-green)",
            )}
          >
            {segment.text}
          </span>
        );
      })}
    </>
  );
}

function HistoryValue({
  field,
  value,
  boardId,
  className,
}: {
  field: string;
  value: string | null;
  boardId?: string;
  className?: string;
}) {
  const { lang } = useI18n();
  const hour12 = useHour12();
  // An assignee half shows the member's name, not the raw user id —
  // resolved through the directory with an id fallback (left the board).
  const member = useBoardMember(
    boardId,
    field === "assignee" ? value : undefined,
  );
  if (value === null) {
    return <span className="text-muted-foreground/50">—</span>;
  }
  if (field === "dueDate") {
    const at = Date.parse(value);
    if (Number.isFinite(at)) {
      return (
        <span className={cn("text-foreground/80", className)}>
          {formatDate(at, lang, hour12)}
        </span>
      );
    }
  }
  // A priority half shows the localized level name, not the raw enum.
  if (field === "priority" && CARD_PRIORITIES.includes(value as CardPriority)) {
    return (
      <span className={cn("text-foreground/80", className)}>
        {priorityLabel(value as CardPriority, lang)}
      </span>
    );
  }
  if (field === "assignee") {
    return (
      <span className={cn("text-foreground/80", className)}>
        {userLabel(member?.displayName ?? null, member?.email ?? value)}
      </span>
    );
  }
  return (
    <span className={cn("whitespace-pre-wrap text-foreground/80", className)}>
      {value}
    </span>
  );
}
