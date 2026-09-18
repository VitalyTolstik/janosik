import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import type {
  ActivityChange,
  ActivityFeedEntry,
  ActivitySseEvent,
  CardActivityEvent,
} from "@janosik/shared";

import { api, isApiEnabled } from "@/api/client";
import { Button } from "@/components/ui/button";
import { UserAvatar } from "@/components/ui/user-avatar";
import { useOpenProfile } from "@/components/board/UserProfileDialog";
import { useToast } from "@/components/Toast";
import {
  formatDate,
  formatRelative,
  useHour12,
  useI18n,
  type MessageKey,
} from "@/i18n";
import { useBoardLive, useBoardMember } from "@/store/board-live";
import { userLabel } from "@/utils/avatar";
import { foldHistory } from "@/utils/history-fold";

/** Newest-first page size of the history feed. */
const PAGE_SIZE = 50;

/** Local timeline event types (no server round-trip) → catalog keys. */
const LOCAL_KEYS = {
  created: "activity.created",
  renamed: "activity.renamed",
  "description-changed": "activity.description-changed",
  moved: "activity.moved",
  "label-added": "activity.label-added",
  "label-removed": "activity.label-removed",
  "due-date-set": "activity.due-date-set",
  "due-date-removed": "activity.due-date-removed",
  "cover-set": "activity.cover-set",
  "cover-removed": "activity.cover-removed",
  "checklist-added": "activity.checklist-added",
  "checklist-removed": "activity.checklist-removed",
  "checklist-renamed": "activity.checklist-renamed",
  "checklist-item-added": "activity.checklist-item-added",
  "checklist-item-checked": "activity.checklist-item-checked",
  "checklist-item-unchecked": "activity.checklist-item-unchecked",
  "checklist-item-removed": "activity.checklist-item-removed",
  "checklist-item-renamed": "activity.checklist-item-renamed",
  archived: "activity.archived",
  unarchived: "activity.unarchived",
} satisfies Record<string, MessageKey>;

/** Server command types → catalog keys (special cases resolved per entry). */
const COMMAND_KEYS: Record<string, MessageKey> = {
  CREATE_CARD: "activity.created",
  UPDATE_CARD: "history.updated",
  MOVE_CARD: "activity.moved",
  SET_CARD_DUE_DATE: "activity.due-date-set",
  SET_CARD_COVER: "activity.cover-set",
  SET_CARD_LABEL: "activity.label-added",
  ADD_CHECKLIST: "activity.checklist-added",
  RENAME_CHECKLIST: "activity.checklist-renamed",
  DELETE_CHECKLIST: "activity.checklist-removed",
  ADD_CHECKLIST_ITEM: "activity.checklist-item-added",
  SET_CHECKLIST_ITEM_DONE: "activity.checklist-item-checked",
  RENAME_CHECKLIST_ITEM: "activity.checklist-item-renamed",
  DELETE_CHECKLIST_ITEM: "activity.checklist-item-removed",
  ARCHIVE_CARD: "activity.archived",
  UNARCHIVE_CARD: "activity.unarchived",
  DUPLICATE_CARD: "activity.created",
};

/** Field label keys for the "from → to" lines. */
const FIELD_KEYS: Record<string, MessageKey> = {
  title: "history.field.title",
  description: "history.field.description",
  dueDate: "history.field.dueDate",
  column: "history.field.column",
  label: "history.field.label",
  checklist: "history.field.checklist",
  checklistItem: "history.field.checklistItem",
  cover: "history.field.cover",
};

interface CardHistoryProps {
  cardId: string;
  boardId: string;
  updatedAt: number;
  /** Local-mode timeline (`card.activity`) when no server is reachable. */
  localActivity?: CardActivityEvent[];
}

/**
 * The History view of the Activity section (TASK-37): the server feed of
 * everything that happened to the card, newest-first, with Jira-style
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
}: CardHistoryProps) {
  const { t } = useI18n();
  const toast = useToast();
  const serverMode = isApiEnabled();
  const { activity } = useBoardLive();

  const [entries, setEntries] = useState<ActivityFeedEntry[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);

  const loadFirst = useCallback(async () => {
    if (!serverMode) return;
    try {
      const page = await api.cardActivity(cardId, undefined, PAGE_SIZE);
      setEntries(page.items);
      setNextCursor(page.nextCursor);
    } catch {
      toast.error(t("history.loadError"));
    }
  }, [cardId, serverMode, t, toast]);

  // Threads are keyed by card id upstream, so mount state is the reset.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the page lands after the await, not synchronously
    void loadFirst();
  }, [loadFirst]);

  const refreshNewest = useCallback(async () => {
    if (!serverMode) return;
    try {
      const page = await api.cardActivity(cardId, undefined, PAGE_SIZE);
      setEntries((prev) => {
        const known = new Set(prev.map((entry) => entry.id));
        const fresh = page.items.filter((entry) => !known.has(entry.id));
        return fresh.length > 0 ? [...fresh, ...prev] : prev;
      });
    } catch {
      /* best effort */
    }
  }, [cardId, serverMode]);

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
      void refreshNewest();
    });
  }, [activity, boardId, cardId, serverMode, refreshNewest]);

  const handleShowOlder = async () => {
    if (nextCursor === null || loadingOlder) return;
    setLoadingOlder(true);
    try {
      const page = await api.cardActivity(cardId, nextCursor, PAGE_SIZE);
      setEntries((prev) => [...prev, ...page.items]);
      setNextCursor(page.nextCursor);
    } catch {
      toast.error(t("history.loadError"));
    } finally {
      setLoadingOlder(false);
    }
  };

  const visible: ActivityFeedEntry[] = serverMode
    ? foldHistory(entries)
    : localEntries(localActivity ?? [], updatedAt);

  if (visible.length === 0) {
    return (
      <p className="py-2 text-sm text-muted-foreground/70">
        {t("history.empty")}
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <ol className="space-y-2.5" data-testid="history-list">
        {visible.map((entry) => (
          <HistoryRow boardId={boardId} entry={entry} key={entry.id} />
        ))}
      </ol>
      {nextCursor !== null ? (
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
  const name = entry.actorId
    ? userLabel(member?.displayName ?? null, member?.email ?? "")
    : "";

  const sentence = sentenceFor(entry, lang, hour12);
  const changes = renderedChanges(entry.changes);

  return (
    <li
      className="flex items-start gap-2.5 text-sm"
      data-testid="history-entry"
    >
      {entry.actorId ? (
        <button
          type="button"
          aria-label={t("profile.open", { name })}
          onClick={() => openProfile(entry.actorId)}
          className="mt-0.5 inline-flex shrink-0 rounded-full"
        >
          <UserAvatar
            userId={entry.actorId}
            displayName={member?.displayName ?? null}
            email={member?.email ?? ""}
            color={member?.avatarColor}
            size="xs"
            className="ring-1 ring-border/60"
          />
        </button>
      ) : (
        <span className="mt-1 h-3.5 w-3.5 shrink-0" aria-hidden />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="min-w-0 flex-1 truncate text-foreground/90">
            {name ? (
              <>
                <button
                  type="button"
                  onClick={() => openProfile(entry.actorId)}
                  className="font-medium hover:underline"
                >
                  {name}
                </button>
                <span className="text-muted-foreground/60"> · </span>
              </>
            ) : null}
            {t(sentence.key, sentence.params)}
          </span>
          <time
            className="shrink-0 text-[11px] text-muted-foreground/70"
            dateTime={new Date(entry.at).toISOString()}
            title={formatDate(entry.at, lang, hour12)}
          >
            {/* eslint-disable-next-line react-hooks/purity -- relative time is refreshed every render on purpose */}
            {formatRelative(entry.at, lang, Date.now(), hour12)}
          </time>
        </div>
        {changes && changes.length > 0 ? (
          <ul className="mt-1 space-y-0.5" data-testid="history-diff">
            {changes.map((change, index) => (
              <li
                key={`${change.field}-${index}`}
                className="text-xs text-muted-foreground"
              >
                <span className="font-medium text-muted-foreground/80">
                  {t(FIELD_KEYS[change.field] ?? "history.field.title")}
                </span>
                {": "}
                <HistoryValue field={change.field} value={change.from} />
                <span className="px-1 text-muted-foreground/50">→</span>
                <HistoryValue field={change.field} value={change.to} />
              </li>
            ))}
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
  changes: ActivityChange[] | undefined,
): ActivityChange[] | undefined {
  if (changes === undefined) return undefined;
  const visible = changes.filter(
    (change) => change.field !== "checklistItemDone",
  );
  return visible.length > 0 ? visible : undefined;
}

function HistoryValue({
  field,
  value,
}: {
  field: string;
  value: string | null;
}) {
  const { lang } = useI18n();
  const hour12 = useHour12();
  if (value === null) {
    return <span className="text-muted-foreground/50">—</span>;
  }
  if (field === "dueDate") {
    const at = Date.parse(value);
    if (Number.isFinite(at)) {
      return (
        <span className="text-foreground/80">
          {formatDate(at, lang, hour12)}
        </span>
      );
    }
  }
  return <span className="break-words text-foreground/80">{value}</span>;
}

/** The sentence for one entry: special cases first, maps as fallback. */
function sentenceFor(
  entry: ActivityFeedEntry,
  lang: "en" | "ru",
  hour12: boolean,
): { key: MessageKey; params?: Record<string, string> } {
  const local = LOCAL_KEYS[entry.type as keyof typeof LOCAL_KEYS];
  if (local !== undefined) {
    return { key: local, params: { detail: entry.detail ?? "" } };
  }

  if (entry.type === "UPDATE_CARD") {
    const fields = entry.changes?.map((change) => change.field) ?? [];
    if (fields.length === 1 && fields[0] === "title") {
      return { key: "activity.renamed" };
    }
    if (fields.length === 1 && fields[0] === "description") {
      return { key: "activity.description-changed" };
    }
    return { key: "history.updated" };
  }

  if (entry.type === "SET_CARD_LABEL") {
    const attached = entry.changes?.[0]?.to ?? null;
    return {
      key:
        attached !== null ? "activity.label-added" : "activity.label-removed",
      params: { detail: entry.detail ?? attached ?? "" },
    };
  }

  if (entry.type === "SET_CARD_DUE_DATE") {
    const set = entry.changes?.[0]?.to ?? null;
    return {
      key: set !== null ? "activity.due-date-set" : "activity.due-date-removed",
      params: {
        detail: set !== null ? formatDate(Date.parse(set), lang, hour12) : "",
      },
    };
  }

  if (entry.type === "SET_CARD_COVER") {
    const set = entry.changes?.[0]?.to ?? null;
    return {
      key: set !== null ? "activity.cover-set" : "activity.cover-removed",
    };
  }

  if (entry.type === "SET_CHECKLIST_ITEM_DONE") {
    const checked =
      entry.changes?.some(
        (change) =>
          change.field === "checklistItemDone" && change.to === "true",
      ) ?? entry.detail !== undefined;
    return {
      key: checked
        ? "activity.checklist-item-checked"
        : "activity.checklist-item-unchecked",
      params: { detail: entry.detail ?? "" },
    };
  }

  if (entry.type === "comment_added") {
    return { key: "activity.comment-added" };
  }
  if (entry.type === "comment_deleted") {
    return { key: "activity.comment-deleted" };
  }

  return {
    key: COMMAND_KEYS[entry.type] ?? "history.updated",
    params: { detail: entry.detail ?? "" },
  };
}
