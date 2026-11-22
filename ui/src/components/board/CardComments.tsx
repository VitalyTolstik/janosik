import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { Check, ChevronDown, Loader2, Pencil, Trash2 } from "lucide-react";
import type {
  ActivitySseEvent,
  AuthUserDto,
  CommentDto,
  CommentKind,
} from "@janosik/shared";
import { COMMENT_KINDS, DEFAULT_COMMENT_KIND, LIMITS } from "@janosik/shared";

import { api, ApiError, isApiEnabled } from "@/api/client";
import { useAuth } from "@/auth/AuthContext";
import {
  appendOlderActivity,
  CARD_ACTIVITY_PAGE_SIZE,
  mergeNewestActivity,
  type ActivityCount,
  type ActivityPage,
} from "@/components/board/card-activity-count";
import { CardSectionSkeleton } from "@/components/board/CardSectionSkeleton";
import {
  commentAuthorLabel,
  commentExcerpt,
} from "@/components/board/comment-delete";
import { ConfirmDialog } from "@/components/board/ConfirmDialog";
import { useOpenProfile } from "@/components/board/UserProfileDialog";
import { useCommentDraft } from "@/components/board/use-comment-draft";
import { LimitCounter } from "@/components/ui/limit-counter";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Skeleton, SkeletonRegion } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { UserAvatar } from "@/components/ui/user-avatar";
import { useToast } from "@/components/Toast";
import { formatDate, formatRelative, useHour12, useI18n } from "@/i18n";
import { useBoardLive, useBoardMember } from "@/store/board-live";
import { AgentAttribution } from "@/components/agents/AgentAttribution";
import { userLabel } from "@/utils/avatar";
import { createId } from "@/utils/id";

// MDXEditor rides the description's lazy boundary (TASK-19): both comment
// components live in one on-demand module, so the dialog chunk stays lean.
const CommentComposerEditor = lazy(() =>
  import("@/components/editor/CommentEditor").then((m) => ({
    default: m.CommentComposerEditor,
  })),
);
const CommentBody = lazy(() =>
  import("@/components/editor/CommentEditor").then((m) => ({
    default: m.CommentBody,
  })),
);

const PAGE_SIZE = CARD_ACTIVITY_PAGE_SIZE;

function isPendingComment(comment: CommentDto) {
  return comment.id.startsWith("pending-");
}

/** The dialog body that actually scrolls (the header lives outside it). */
function findScrollParent(element: HTMLElement): HTMLElement | null {
  let current = element.parentElement;
  while (current !== null) {
    const style = window.getComputedStyle(current);
    if (
      /(auto|scroll)/.test(style.overflowY) &&
      current.scrollHeight > current.clientHeight
    ) {
      return current;
    }
    current = current.parentElement;
  }
  return null;
}

/**
 * Center a deep-linked row in its scroll container, leaving a margin for the
 * dialog edge/header. `handled` is false when there is no real scroller;
 * `moved` keeps the rAF loop alive until the layout is stable.
 */
function centerRow(row: HTMLElement): { handled: boolean; moved: boolean } {
  const scroller = findScrollParent(row);
  if (scroller === null) return { handled: false, moved: false };
  const scrollerRect = scroller.getBoundingClientRect();
  const rowRect = row.getBoundingClientRect();
  const margin = 24;
  const visibleTop = scrollerRect.top + margin;
  const visibleBottom = scrollerRect.bottom - margin;
  if (visibleBottom <= visibleTop) return { handled: true, moved: false };
  const delta =
    rowRect.top + rowRect.height / 2 - (visibleTop + visibleBottom) / 2;
  if (Math.abs(delta) < 1) return { handled: true, moved: false };
  const max = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
  scroller.scrollTop = Math.max(0, Math.min(max, scroller.scrollTop + delta));
  return { handled: true, moved: true };
}

/** A stable rAF/setTimeout pair for browsers without animation frames. */
function afterFrame(callback: () => void): void {
  if (typeof window.requestAnimationFrame === "function") {
    window.requestAnimationFrame(callback);
  } else {
    window.setTimeout(callback, 16);
  }
}

interface CardCommentsProps {
  cardId: string;
  boardId: string;
  /** VIEWER mode: read the thread, no composer and no delete (TASK-35). */
  readOnly?: boolean;
  /**
   * Search deep link (TASK-177.13): the comment to scroll to and highlight.
   * An id outside the loaded page is ignored — the card stays the fallback.
   */
  focusId?: string;
  /** Undefined while loading, null when unavailable. */
  onCountChange?: (count: ActivityCount | null | undefined) => void;
}

/**
 * The card's comment subsection (TASK-37) over the TASK-28 REST API:
 * the markdown composer on top (Jira's Save/Cancel pair, Ctrl/Cmd+Enter
 * submits), comments follow newest-first, own comments are soft-deleted
 * behind a confirmation, older pages load on demand with the opaque
 * cursor. A comment written by someone else arrives as a `type: "activity"`
 * SSE frame and is pulled in live; the frame carries only the comment id,
 * the body comes from the ordinary list endpoint.
 */
export function CardComments({
  cardId,
  boardId,
  readOnly = false,
  focusId,
  onCountChange,
}: CardCommentsProps) {
  const { t } = useI18n();
  const toast = useToast();
  const { user } = useAuth();
  const serverMode = isApiEnabled();
  const { activity } = useBoardLive();

  const [thread, setThread] = useState<ActivityPage<CommentDto>>({
    items: [],
    nextCursor: null,
  });
  const { items, nextCursor } = thread;
  const itemsRef = useRef<CommentDto[]>([]);
  // Server-side kind filter (TASK-177.11, G-06). `requestedKind` is the chip
  // the author clicked; `loadedKind` only moves after that page actually
  // arrives, so a failed fetch never claims a filter that is not applied.
  const [requestedKind, setRequestedKind] = useState<CommentKind | undefined>(
    undefined,
  );
  // Mirrors `requestedKind` for async handlers: a chip can change while a
  // comment POST is in flight, and the post-await code must see the latest
  // request, not the render-time snapshot.
  const requestedKindRef = useRef<CommentKind | undefined>(undefined);
  const [loadedKind, setLoadedKind] = useState<CommentKind | undefined>(
    undefined,
  );
  const loadedKindRef = useRef<CommentKind | undefined>(undefined);
  const [filtering, setFiltering] = useState(false);
  const [filterError, setFilterError] = useState(false);
  // Last exact unfiltered count for the Comments tab. While a filter is
  // applied the visible thread cannot supply it, so local creates/deletes
  // adjust this snapshot by ±1.
  const unfilteredCountRef = useRef<ActivityCount | null>(null);
  // Search deep link (TASK-177.13) scrolls/highlights a comment; the kind
  // filter above owns the first page, so both features share the same list.
  const listRef = useRef<HTMLOListElement>(null);
  const composerRef = useRef<HTMLDivElement>(null);
  const settlingFocusRef = useRef<string | null>(null);
  const focusScrollTokenRef = useRef(0);
  const focusSettleDeadlineRef = useRef(0);
  // TASK-177.12: a mention deep link may point past the first page. The
  // thread loads older pages until the target appears (or the cursor ends).
  const focusAutoLoadRef = useRef<string | null>(null);
  const focusAutoStuckRef = useRef<string | null>(null);
  // `loaded` separates "no comments yet" from "the first page has not
  // arrived": the section must not claim an empty thread before the answer.
  const [status, setStatus] = useState<
    "loading" | "ready" | "error" | "unavailable"
  >(serverMode ? "loading" : "ready");
  const loaded = status !== "loading";
  const aliveRef = useRef(true);
  // A chip click starts a new first page while the previous request may still
  // be in flight; only the newest load may land.
  const loadSeqRef = useRef(0);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const canCompose =
    loaded && serverMode && !readOnly && status !== "unavailable";
  const composer = useCommentDraft(cardId, canCompose ? user?.id : undefined);
  const draft = composer.draft?.text ?? "";
  const kind = composer.draft?.kind ?? DEFAULT_COMMENT_KIND;
  const [pendingDelete, setPendingDelete] = useState<CommentDto | null>(null);
  const pendingAuthor = useBoardMember(boardId, pendingDelete?.authorId);
  const deletingIdRef = useRef<string | null>(null);
  // TASK-185.2: an in-flight list fetch can resolve after the delete frame.
  // Map id → deletion generation so a response that started after the delete
  // is authoritative (it may contain a restored comment), while an older
  // in-flight page cannot put the body back.
  const deletedIdsRef = useRef(new Map<string, number>());
  const deletionGenerationRef = useRef(0);
  const markCommentDeleted = useCallback((commentId: string) => {
    deletionGenerationRef.current += 1;
    deletedIdsRef.current.set(commentId, deletionGenerationRef.current);
  }, []);
  const scrubItems = useCallback(
    <T extends { id: string }>(items: T[], requestGeneration: number) => {
      const kept: T[] = [];
      for (const item of items) {
        const deletedAt = deletedIdsRef.current.get(item.id);
        if (deletedAt === undefined) {
          kept.push(item);
        } else if (deletedAt <= requestGeneration) {
          // A fresh response still has the row: it was restored, stop hiding.
          deletedIdsRef.current.delete(item.id);
          kept.push(item);
        }
      }
      return { items: kept, removed: items.length - kept.length };
    },
    [],
  );
  const scrubPage = useCallback(
    (
      page: ActivityPage<CommentDto>,
      requestGeneration: number,
    ): ActivityPage<CommentDto> => {
      const { items, removed } = scrubItems(page.items, requestGeneration);
      return {
        ...page,
        items,
        ...(page.total !== undefined
          ? { total: Math.max(0, page.total - removed) }
          : {}),
      };
    },
    [scrubItems],
  );
  const pendingAuthorName = commentAuthorLabel(
    pendingDelete?.authorId ?? "",
    pendingAuthor,
    user,
    t("comment.unknownAuthor"),
  );

  const markUnavailable = useCallback((error: unknown) => {
    if (
      error instanceof ApiError &&
      (error.status === 403 || error.status === 404)
    ) {
      setStatus("unavailable");
      setThread({ items: [], nextCursor: null });
    }
  }, []);

  const loadFirst = useCallback(
    async (kind: CommentKind | undefined) => {
      if (!serverMode) return;
      const seq = ++loadSeqRef.current;
      const generation = deletionGenerationRef.current;
      try {
        const page = await api.listComments(cardId, undefined, PAGE_SIZE, kind);
        if (!aliveRef.current || seq !== loadSeqRef.current) return;
        setThread(scrubPage(page, generation));
        setStatus("ready");
        loadedKindRef.current = kind;
        setLoadedKind(kind);
        setFilterError(false);
      } catch (error) {
        if (!aliveRef.current || seq !== loadSeqRef.current) return;
        markUnavailable(error);
        // A failed filter fetch keeps the previous thread and chip; only the
        // first unfiltered load has no previous state to fall back on.
        if (kind !== loadedKindRef.current) setFilterError(true);
        toast.error(t("comment.loadError"));
      } finally {
        // A failed request still ends the wait: the skeleton must not spin
        // forever over an error toast.
        if (aliveRef.current && seq === loadSeqRef.current) {
          setFiltering(false);
          setStatus((current) => (current === "loading" ? "error" : current));
        }
      }
    },
    [cardId, markUnavailable, scrubPage, serverMode, t, toast],
  );

  // A different card means a different thread: the parent remounts this
  // component with `key={cardId}`, so the initial state is the reset.
  useEffect(() => {
    aliveRef.current = true;
    void loadFirst(requestedKind);
    return () => {
      aliveRef.current = false;
    };
  }, [loadFirst, requestedKind]);

  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  // Deep link from global search (TASK-177.13): reveal the matched comment
  // once its page has landed. The row is matched by data attribute rather
  // than a selector so a hand-edited URL cannot inject CSS syntax.
  // One attempt per focus id: later SSE growth must not steal the reader's
  // scroll position. An unknown id leaves the card as the fallback.
  const revealedFocusRef = useRef<string | null>(null);
  const findFocusRow = useCallback(
    (id: string) =>
      Array.from(
        listRef.current?.querySelectorAll<HTMLElement>("[data-comment-id]") ??
          [],
      ).find((element) => element.dataset.commentId === id) ?? null,
    [],
  );
  /**
   * Center the row after the current layout and again while lazy content
   * settles. Center on the real scroll container (the dialog body), not the
   * whole page; two stable frames end the loop.
   */
  const settleFocusRow = useCallback(
    (id: string) => {
      const token = ++focusScrollTokenRef.current;
      let stableFrames = 0;
      let frames = 0;
      const step = () => {
        if (!aliveRef.current || token !== focusScrollTokenRef.current) return;
        const row = findFocusRow(id);
        if (row === null) return;
        const result = centerRow(row);
        if (!result.handled) {
          // jsdom/tests without layout get one deterministic reveal.
          row.scrollIntoView?.({ block: "center" });
          return;
        }
        stableFrames = result.moved ? 0 : stableFrames + 1;
        frames += 1;
        if (stableFrames < 2 && frames < 16) afterFrame(step);
      };
      afterFrame(step);
    },
    [findFocusRow],
  );

  useEffect(() => {
    if (!focusId || !loaded || revealedFocusRef.current === focusId) return;
    const row = findFocusRow(focusId);
    if (row === null) return;
    // Mark only a successful reveal: an older page can still bring the
    // target later, while a found row must not be scrolled to twice.
    revealedFocusRef.current = focusId;
    settlingFocusRef.current = focusId;
    focusSettleDeadlineRef.current = Date.now() + 1_500;
    settleFocusRow(focusId);
    row.focus?.({ preventScroll: true });
  }, [findFocusRow, focusId, loaded, items.length, settleFocusRow]);

  // The composer and older pages can change layout after the first reveal.
  // Recenter for a short window only; later list growth must not yank the
  // reader's scroll position.
  useEffect(() => {
    if (!focusId || !loaded || typeof ResizeObserver === "undefined") return;
    const nodes: Element[] = [];
    if (composerRef.current !== null) nodes.push(composerRef.current);
    if (listRef.current !== null) nodes.push(listRef.current);
    if (nodes.length === 0) return;
    let timer: number | undefined;
    const observer = new ResizeObserver(() => {
      if (
        settlingFocusRef.current !== focusId ||
        Date.now() > focusSettleDeadlineRef.current
      ) {
        return;
      }
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        if (settlingFocusRef.current === focusId) settleFocusRow(focusId);
      }, 80);
    });
    for (const node of nodes) observer.observe(node);
    return () => {
      window.clearTimeout(timer);
      observer.disconnect();
    };
  }, [focusId, loaded, settleFocusRow]);

  const commentCount = items.filter((item) => !isPendingComment(item)).length;
  const { total } = thread;
  useEffect(() => {
    // A filtered thread holds only one kind; the Comments tab count belongs
    // to the whole thread, so keep the last unfiltered snapshot instead of
    // recomputing it from the visible (and much smaller) list.
    if (loadedKind !== undefined) return;
    const count =
      serverMode && status === "ready"
        ? {
            visible: commentCount,
            loaded: commentCount,
            truncated: nextCursor !== null,
            total,
          }
        : null;
    unfilteredCountRef.current = count;
    onCountChange?.(loaded ? count : undefined);
  }, [
    commentCount,
    loaded,
    loadedKind,
    nextCursor,
    onCountChange,
    serverMode,
    status,
    total,
  ]);

  const adjustUnfilteredCount = useCallback(
    (delta: 1 | -1) => {
      const current = unfilteredCountRef.current;
      if (current === null) return;
      const next: ActivityCount = {
        ...current,
        visible: Math.max(0, current.visible + delta),
        loaded: Math.max(0, current.loaded + delta),
        ...(current.total !== undefined
          ? { total: Math.max(0, current.total + delta) }
          : {}),
      };
      unfilteredCountRef.current = next;
      onCountChange?.(next);
    },
    [onCountChange],
  );

  // Live arrival: a foreign comment is not in the frame body (the frame
  // carries its id), so the newest page is re-read and merged — paginated
  // older pages stay untouched. Own echoes land in the same path and are
  // deduplicated by id, whichever wins the race with the POST response.
  const refreshNewest = useCallback(async () => {
    if (!serverMode) return;
    // SSE can fire while a chip change is in flight; read and merge only for
    // the kind the visible thread was actually loaded with.
    const kind = loadedKindRef.current;
    const generation = deletionGenerationRef.current;
    try {
      const page = await api.listComments(cardId, undefined, PAGE_SIZE, kind);
      if (!aliveRef.current || kind !== loadedKindRef.current) return;
      const cleanPage = scrubPage(page, generation);
      setThread((current) => {
        const merged = mergeNewestActivity(
          current,
          cleanPage,
          isPendingComment,
        );
        const { items, removed } = scrubItems(merged.items, generation);
        return {
          ...merged,
          items,
          ...(merged.total !== undefined
            ? { total: Math.max(0, merged.total - removed) }
            : {}),
        };
      });
      setStatus("ready");
    } catch (error) {
      if (aliveRef.current && kind === loadedKindRef.current) {
        markUnavailable(error);
      }
    }
  }, [cardId, markUnavailable, scrubItems, scrubPage, serverMode]);

  // An edit is not in the frame body either: re-read the loaded pages until
  // the edited row is found and replace matching rows in place, keeping the
  // list position (TASK-176.2). L36: an edit on page 2+ must refresh too —
  // the previous implementation only read the first page, so an older loaded
  // comment stayed stale until a remount.
  const refreshEdited = useCallback(
    async (commentId: string) => {
      if (!serverMode) return;
      const kind = loadedKindRef.current;
      const loaded = itemsRef.current;
      const target = commentId === "" ? undefined : commentId;
      const generation = deletionGenerationRef.current;
      // An edit of a row this client has not loaded is not rendered here —
      // unless it is a restore of a locally tombstoned comment.
      if (
        target !== undefined &&
        !loaded.some((item) => item.id === target) &&
        !deletedIdsRef.current.has(target)
      ) {
        return;
      }
      try {
        const byId = new Map<string, CommentDto>();
        let cursor: string | undefined;
        // The loaded list is the newest N rows, so only those pages can hold
        // a row this component shows. One extra page covers a cursor shift;
        // the walk is therefore bounded by the already-loaded page count and
        // never turns one SSE frame into an unbounded history scan.
        const maxPages = Math.ceil(loaded.length / PAGE_SIZE) + 1;
        for (let pageIndex = 0; pageIndex < maxPages; pageIndex += 1) {
          const page = await api.listComments(cardId, cursor, PAGE_SIZE, kind);
          for (const comment of page.items) byId.set(comment.id, comment);
          if (target !== undefined && page.items.some((c) => c.id === target)) {
            break;
          }
          if (target === undefined && pageIndex === 0) break;
          if (page.nextCursor === null) break;
          cursor = page.nextCursor;
        }
        if (!aliveRef.current || kind !== loadedKindRef.current) return;
        const restoredTarget =
          target !== undefined ? byId.get(target) : undefined;
        if (restoredTarget !== undefined) {
          // Only a response that started after the deletion may clear the
          // marker; a stale edit response must not resurrect the body.
          const deletedAt = deletedIdsRef.current.get(restoredTarget.id);
          if (deletedAt !== undefined && deletedAt <= generation) {
            deletedIdsRef.current.delete(restoredTarget.id);
          }
        }
        setThread((current) => {
          const items = current.items.flatMap((comment) => {
            // Under a kind filter an edit can move the row out of the
            // visible page; drop it instead of leaving a stale chip match.
            if (
              kind !== undefined &&
              comment.id === target &&
              !byId.has(comment.id)
            ) {
              return [];
            }
            return [byId.get(comment.id) ?? comment];
          });
          if (
            restoredTarget !== undefined &&
            !items.some((item) => item.id === restoredTarget.id)
          ) {
            items.push(restoredTarget);
          }
          const scrubbed = scrubItems(items, generation);
          return {
            ...current,
            items: scrubbed.items,
            ...(current.total !== undefined
              ? { total: Math.max(0, current.total - scrubbed.removed) }
              : {}),
          };
        });
      } catch (error) {
        if (aliveRef.current && kind === loadedKindRef.current) {
          markUnavailable(error);
        }
      }
    },
    [cardId, markUnavailable, scrubItems, serverMode],
  );

  useEffect(() => {
    if (!serverMode) return;
    return activity.subscribe((event: ActivitySseEvent) => {
      if (event.boardId !== boardId || event.cardId !== cardId) return;
      if (event.kind === "comment_added") {
        void refreshNewest();
        return;
      }
      if (event.kind === "comment_updated") {
        void refreshEdited(event.commentId ?? event.detail ?? "");
        return;
      }
      if (event.kind === "comment_deleted") {
        const deletedId = event.commentId ?? event.detail;
        if (!deletedId) return;
        // TASK-185.2: a master/admin frame omits the actor, so invalidation
        // must key on the comment id, never on attribution. Drop the loaded
        // body and any open confirmation that still quotes it.
        markCommentDeleted(deletedId);
        if (itemsRef.current.some((item) => item.id === deletedId)) {
          adjustUnfilteredCount(-1);
        }
        setPendingDelete((current) =>
          current?.id === deletedId ? null : current,
        );
        setThread((current) => ({
          ...current,
          items: current.items.filter((comment) => comment.id !== deletedId),
          total: undefined,
        }));
        void refreshNewest();
      }
    });
  }, [
    activity,
    adjustUnfilteredCount,
    boardId,
    cardId,
    serverMode,
    refreshNewest,
    refreshEdited,
    markCommentDeleted,
  ]);

  // Coming back to a background tab, restoring the network or reconnecting
  // can all hide a revoked membership or a deleted comment. Re-check the
  // newest page; a 403/404 drops the loaded thread through `markUnavailable`.
  useEffect(() => {
    if (!serverMode) return;
    const recheck = () => {
      void refreshNewest();
    };
    const onVisibility = () => {
      if (!document.hidden) recheck();
    };
    window.addEventListener("focus", recheck);
    window.addEventListener("online", recheck);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("focus", recheck);
      window.removeEventListener("online", recheck);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [refreshNewest, serverMode]);

  const trimmed = draft.trim();
  const canSend =
    canCompose &&
    user !== null &&
    !composer.sending &&
    trimmed.length > 0 &&
    trimmed.length <= LIMITS.comment;

  const retryFilter = () => {
    setFilterError(false);
    setFiltering(true);
    // Read the live ref, not a render-time state snapshot: a retry can be
    // started from an old handleSend closure after the chip changed.
    void loadFirst(requestedKindRef.current);
  };

  const handleSend = async () => {
    if (!canSend || user === null) return;
    const finishSend = composer.startSend();
    if (finishSend === null) return;
    const text = trimmed;
    const tempId = `pending-${createId()}`;
    const sentKind = kind;
    const optimistic: CommentDto = {
      id: tempId,
      cardId,
      authorId: user.id,
      text,
      kind: sentKind,
      actorType: "human",
      apiTokenId: null,
      agentSessionId: null,
      agentName: null,
      createdAt: Date.now(),
    };
    setThread((current) => ({
      ...current,
      items: [optimistic, ...current.items],
    }));
    try {
      const saved = await api.createComment(cardId, text, undefined, sentKind);
      finishSend(true);
      setThread((current) => ({
        ...current,
        items: [
          saved,
          ...current.items.filter(
            (comment) => comment.id !== tempId && comment.id !== saved.id,
          ),
        ],
        total: undefined,
      }));
      const activeKind = loadedKindRef.current;
      // The unfiltered tab count cannot be derived from a filtered thread.
      if (activeKind !== undefined) adjustUnfilteredCount(1);
      if (activeKind !== undefined && sentKind !== activeKind) {
        // The author just wrote a comment the active chip excludes: show All
        // so the saved row is not silently hidden by its own filter.
        if (requestedKindRef.current === undefined) {
          // The All chip was already requested (a failed revert leaves the
          // requested kind at All), so setting it again cannot trigger the
          // load effect. Retry explicitly and clear the stuck busy state.
          retryFilter();
        } else {
          requestedKindRef.current = undefined;
          setRequestedKind(undefined);
          setFilterError(false);
          setFiltering(true);
        }
      } else if (total !== undefined) {
        void refreshNewest();
      }
    } catch {
      finishSend(false);
      setThread((current) => ({
        ...current,
        items: current.items.filter((comment) => comment.id !== tempId),
      }));
      toast.error(t("comment.sendError"));
    }
  };

  // TASK-177.17: the server keeps the row soft-deleted, but there is no
  // user-facing comment restore endpoint (only the master-admin entity
  // restore reaches it), so this UI deliberately offers no undo toast and
  // the dialog says the deletion cannot be undone.
  const handleDelete = async () => {
    const comment = pendingDelete;
    // A double click or a repeated Enter of the same confirmation reaches the
    // handler twice before React closes the dialog. The guard is per comment,
    // so deleting a different comment while this request is in flight still
    // works instead of silently dropping the second confirmation.
    if (comment === null || deletingIdRef.current === comment.id) return;
    deletingIdRef.current = comment.id;
    markCommentDeleted(comment.id);
    const index = itemsRef.current.findIndex((item) => item.id === comment.id);
    const previousTotal = total;
    setPendingDelete(null);
    setThread((current) => ({
      ...current,
      items: current.items.filter((item) => item.id !== comment.id),
      total: undefined,
    }));
    try {
      await api.deleteComment(comment.id);
      if (loadedKindRef.current !== undefined) adjustUnfilteredCount(-1);
      if (nextCursor !== null || total !== undefined) void refreshNewest();
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) {
        // The server already deleted it elsewhere: keep the optimistic
        // removal and repair the exact count instead of resurrecting the row.
        if (loadedKindRef.current !== undefined) adjustUnfilteredCount(-1);
        setThread((current) => ({
          ...current,
          total:
            previousTotal !== undefined
              ? Math.max(0, previousTotal - 1)
              : current.total,
        }));
        return;
      }
      toast.error(t("comment.deleteError"));
      // The DELETE failed: allow the restored row through future merges.
      deletedIdsRef.current.delete(comment.id);
      // Keep the loaded pages intact: reinsert the row where it was instead
      // of resetting to page 1 (which would drop comments loaded from 2+).
      setThread((current) => {
        if (current.items.some((item) => item.id === comment.id)) {
          return { ...current, total: previousTotal };
        }
        const items = [...current.items];
        const insertAt =
          index >= 0 ? Math.min(index, items.length) : items.length;
        items.splice(insertAt, 0, comment);
        return { ...current, items, total: previousTotal };
      });
    } finally {
      if (deletingIdRef.current === comment.id) deletingIdRef.current = null;
    }
  };

  const handleShowOlder = useCallback(async (): Promise<boolean> => {
    if (nextCursor === null || loadingOlder) return false;
    const kind = loadedKindRef.current;
    const generation = deletionGenerationRef.current;
    setLoadingOlder(true);
    try {
      const page = await api.listComments(cardId, nextCursor, PAGE_SIZE, kind);
      if (kind !== loadedKindRef.current) return false;
      const cleanPage = scrubPage(page, generation);
      setThread((current) => {
        const merged = appendOlderActivity(current, cleanPage, nextCursor);
        const { items, removed } = scrubItems(merged.items, generation);
        return {
          ...merged,
          items,
          ...(merged.total !== undefined
            ? { total: Math.max(0, merged.total - removed) }
            : {}),
        };
      });
      return true;
    } catch (error) {
      markUnavailable(error);
      toast.error(t("comment.loadError"));
      return false;
    } finally {
      setLoadingOlder(false);
    }
  }, [
    cardId,
    loadingOlder,
    markUnavailable,
    nextCursor,
    scrubItems,
    scrubPage,
    t,
    toast,
  ]);

  useEffect(() => {
    if (focusId === undefined || requestedKindRef.current === undefined) {
      return;
    }
    // A deep link may point at a comment the active kind chip excludes.
    // Reset to All once per focus id; the user can still filter afterwards.
    requestedKindRef.current = undefined;
    setRequestedKind(undefined);
    setFilterError(false);
    setFiltering(true);
  }, [focusId]);

  useEffect(() => {
    if (!focusId || !loaded || status !== "ready" || nextCursor === null) {
      return;
    }
    if (
      revealedFocusRef.current === focusId ||
      items.some((comment) => comment.id === focusId)
    ) {
      return;
    }
    if (
      loadingOlder ||
      focusAutoLoadRef.current === focusId ||
      focusAutoStuckRef.current === focusId
    ) {
      return;
    }
    focusAutoLoadRef.current = focusId;
    void handleShowOlder().then((ok) => {
      if (focusAutoLoadRef.current !== focusId) return;
      focusAutoLoadRef.current = null;
      // A failed page must not turn the deep link into a retry loop.
      if (!ok) focusAutoStuckRef.current = focusId;
    });
  }, [
    focusId,
    handleShowOlder,
    items,
    loaded,
    loadingOlder,
    nextCursor,
    status,
  ]);

  const focusMissing =
    focusId !== undefined &&
    loaded &&
    status === "ready" &&
    nextCursor === null &&
    !loadingOlder &&
    !items.some((comment) => comment.id === focusId);

  const handleKindFilter = (next: CommentKind | undefined) => {
    if (next === requestedKindRef.current) {
      // Clicking the chip that just failed retries it without a state change.
      if (filterError) retryFilter();
      return;
    }
    setRequestedKind(next);
    requestedKindRef.current = next;
    setFilterError(false);
    setFiltering(true);
  };

  return (
    <div className="space-y-2" aria-busy={!loaded || filtering}>
      {canCompose && user !== null ? (
        <div ref={composerRef}>
          <CommentComposer
            key={user.id}
            user={user}
            cardId={cardId}
            boardId={boardId}
            draft={draft}
            sending={composer.sending}
            canSend={canSend}
            editorNonce={composer.editorNonce}
            kind={kind}
            onKindChange={(kind) => composer.update({ kind })}
            onDraftChange={(text) => composer.update({ text })}
            onSubmit={() => void handleSend()}
            onCancel={composer.discard}
          />
        </div>
      ) : null}

      {serverMode && loaded && status !== "unavailable" ? (
        <>
          <CommentKindFilters active={loadedKind} onChange={handleKindFilter} />
          {filterError ? (
            <div
              role="alert"
              data-testid="comment-filter-error"
              className="flex flex-wrap items-center gap-x-2 gap-y-1 pl-[36px] text-xs text-muted-foreground"
            >
              <span>{t("comment.filter.error")}</span>
              <button
                type="button"
                onClick={retryFilter}
                className="inline-flex min-h-11 items-center rounded-md px-2 font-medium text-foreground underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-8"
              >
                {t("comment.filter.retry")}
              </button>
            </div>
          ) : null}
        </>
      ) : null}

      {/* An editable empty thread already has the composer as its prompt. */}
      {!loaded ? (
        <SkeletonRegion
          label={t("comment.loading")}
          testId="card-comments-skeleton"
        >
          <CardSectionSkeleton kind="comments" rows={3} />
        </SkeletonRegion>
      ) : items.length === 0 && loadedKind !== undefined && !filterError ? (
        <p className="py-1 pl-[36px] text-sm text-muted-foreground">
          {t("comment.filter.empty", {
            kind: kindLabel(loadedKind, t),
          })}
        </p>
      ) : items.length === 0 && (readOnly || !serverMode || user === null) ? (
        <p className="py-1 pl-[36px] text-sm text-muted-foreground">
          {t("comment.empty")}
        </p>
      ) : items.length > 0 ? (
        <ol ref={listRef} className="space-y-1" data-testid="comment-list">
          {items.map((comment) => (
            <CommentRow
              key={comment.id}
              comment={comment}
              cardId={cardId}
              boardId={boardId}
              currentUserId={user?.id}
              readOnly={readOnly}
              highlighted={comment.id === focusId}
              onDelete={() => setPendingDelete(comment)}
              onUpdated={(saved) => {
                const activeKind = loadedKindRef.current;
                if (activeKind !== undefined && saved.kind !== activeKind) {
                  // The row no longer belongs to the visible chip.
                  setThread((current) => ({
                    ...current,
                    items: current.items.filter((item) => item.id !== saved.id),
                  }));
                  void refreshNewest();
                  return;
                }
                setThread((current) => ({
                  ...current,
                  items: current.items.map((item) =>
                    item.id === saved.id ? saved : item,
                  ),
                }));
              }}
            />
          ))}
        </ol>
      ) : null}

      {focusMissing ? (
        <p
          role="status"
          data-testid="comment-focus-missing"
          className="py-1 pl-[36px] text-xs text-muted-foreground"
        >
          {t("comment.focusNotFound")}
        </p>
      ) : null}

      {nextCursor !== null ? (
        <div className="pl-[36px]">
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground"
            disabled={loadingOlder}
            data-testid="comments-show-older"
            onClick={() => void handleShowOlder()}
          >
            {loadingOlder ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : null}
            {t("comment.showOlder")}
          </Button>
        </div>
      ) : null}

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
        title={t("comment.deleteTitle", { name: pendingAuthorName })}
        description={t("comment.deleteDescription")}
        confirmLabel={t("comment.deleteConfirm")}
        destructive
        onConfirm={() => void handleDelete()}
      >
        {pendingDelete ? (
          <figure
            className="rounded-lg border border-border/70 bg-muted/40 px-3 py-2"
            data-testid="comment-delete-preview"
          >
            <figcaption
              className="text-xs text-muted-foreground"
              data-testid="comment-delete-author"
            >
              {t("comment.deleteAuthor", { name: pendingAuthorName })}
            </figcaption>
            <blockquote
              dir="auto"
              className="mt-1 line-clamp-3 whitespace-pre-wrap break-words text-sm text-foreground/90"
              data-testid="comment-delete-excerpt"
            >
              {commentExcerpt(pendingDelete.text)}
            </blockquote>
          </figure>
        ) : null}
      </ConfirmDialog>
    </div>
  );
}

interface CommentComposerProps {
  user: AuthUserDto;
  cardId: string;
  boardId: string;
  draft: string;
  sending: boolean;
  canSend: boolean;
  /** Bumped to clear the editor after a successful send or discard. */
  editorNonce: number;
  /** Structured comment kind (TASK-157, D10). */
  kind: CommentKind;
  onKindChange: (kind: CommentKind) => void;
  onDraftChange: (value: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
}

/** A human-readable label for a comment kind. */
function kindLabel(
  kind: CommentKind,
  t: ReturnType<typeof useI18n>["t"],
): string {
  return t(`comment.kind.${kind}`);
}

/**
 * Server-side kind filter chips (TASK-177.11, G-06). `All` is no query; every
 * other chip sends `?kind=` so the cursor pages only that kind. The active
 * state is text + `aria-pressed` + a check icon, never colour alone; each chip
 * is a 44 px touch target below `sm` and wraps at 390 px.
 */
function CommentKindFilters({
  active,
  onChange,
}: {
  active: CommentKind | undefined;
  onChange: (kind: CommentKind | undefined) => void;
}) {
  const { t } = useI18n();
  const label = t("comment.filter.label");
  const options: Array<{ value: CommentKind | undefined; text: string }> = [
    { value: undefined, text: t("comment.filter.all") },
    ...COMMENT_KINDS.map((kind) => ({
      value: kind,
      text: kindLabel(kind, t),
    })),
  ];

  return (
    <div className="pl-[36px]">
      <div
        role="group"
        aria-label={label}
        data-testid="comment-kind-filters"
        className="flex flex-wrap gap-1"
      >
        {options.map(({ value, text }) => {
          const selected = active === value;
          return (
            <button
              key={value ?? "all"}
              type="button"
              aria-pressed={selected}
              data-testid={`comment-filter-${value ?? "all"}`}
              onClick={() => onChange(value)}
              className={cn(
                "inline-flex min-h-11 min-w-11 items-center justify-center gap-1 rounded-full border px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-8",
                selected
                  ? "border-primary/60 bg-primary/10 text-foreground"
                  : "border-border/70 text-muted-foreground hover:bg-hover hover:text-foreground",
              )}
            >
              <Check
                className={cn(
                  "h-3.5 w-3.5",
                  selected ? "text-primary" : "invisible",
                )}
                aria-hidden
              />
              {text}
            </button>
          );
        })}
      </div>
      <p
        className="sr-only"
        role="status"
        aria-live="polite"
        data-testid="comment-filter-live"
      >
        {active === undefined
          ? t("comment.filter.showingAll")
          : t("comment.filter.showing", { kind: kindLabel(active, t) })}
      </p>
    </div>
  );
}

/**
 * Structured comment kind: an outline trigger opening the project's
 * radio-list popover. A native `<select>` was used here first, but its
 * option list is drawn by the browser — it ignores the app theme and breaks
 * the dialog's visual language (and cannot be styled at all). The popover
 * keeps keyboard semantics: the trigger is a button, Escape closes, and each
 * option exposes `role="radio"` + `aria-checked`.
 */
function CommentKindPicker({
  kind,
  disabled,
  onChange,
  testId = "comment-kind",
}: {
  kind: CommentKind;
  disabled: boolean;
  onChange: (kind: CommentKind) => void;
  testId?: string;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const label = t("comment.kindLabel");

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          disabled={disabled}
          aria-label={`${label}: ${kindLabel(kind, t)}`}
          data-testid={testId}
          className="h-8 gap-1.5 px-2 text-xs font-normal text-muted-foreground max-sm:h-11"
        >
          {kindLabel(kind, t)}
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-40 p-1">
        <div role="radiogroup" aria-label={label}>
          {COMMENT_KINDS.map((option) => (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={option === kind}
              data-testid={`${testId}-option-${option}`}
              onClick={() => {
                setOpen(false);
                onChange(option);
              }}
              className={cn(
                "flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-hover max-sm:min-h-11 max-sm:py-2.5",
                option === kind
                  ? "font-medium text-foreground"
                  : "text-foreground/90",
              )}
            >
              {kindLabel(option, t)}
              {option === kind && (
                <Check className="h-3.5 w-3.5 text-primary" />
              )}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/**
 * Jira's comment box: avatar on the left, the markdown field that grows
 * with the text, and the primary Save on the left with a quiet Cancel
 * next to it — both rendered at once, both disabled until the draft has
 * something to send (or cancel).
 */
function CommentComposer({
  user,
  cardId,
  boardId,
  draft,
  sending,
  canSend,
  editorNonce,
  kind,
  onKindChange,
  onDraftChange,
  onSubmit,
  onCancel,
}: CommentComposerProps) {
  const { t } = useI18n();
  const dirty = draft.length > 0 || kind !== DEFAULT_COMMENT_KIND;

  return (
    <div className="flex items-start gap-2.5">
      {/* The nudge keeps the round avatar visually inside the column the
          rectangular switcher border opens. */}
      <UserAvatar
        userId={user.id}
        displayName={user.displayName}
        email={user.email}
        color={user.avatarColor}
        avatarPath={user.avatarPath}
        size="sm"
        className="ml-0.5 mt-0.5 shrink-0"
      />
      <div className="min-w-0 flex-1 space-y-2">
        <Suspense
          fallback={
            /* Reserve the lazy composer's real toolbar + one-line surface
               (36 px + row padding) so a deep-linked row below it is not
               pushed out of view when the chunk streams in. */
            <Skeleton className="h-[84px] rounded-md" />
          }
        >
          <CommentComposerEditor
            key={editorNonce}
            cardId={cardId}
            boardId={boardId}
            value={draft}
            onChange={onDraftChange}
            onSubmit={onSubmit}
            placeholder={t("comment.placeholder")}
          />
        </Suspense>
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <CommentKindPicker
              kind={kind}
              disabled={sending}
              onChange={onKindChange}
            />
            <Button
              variant="premium"
              size="sm"
              disabled={!canSend}
              data-testid="comment-send"
              onClick={onSubmit}
            >
              {sending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : null}
              {t("comment.send")}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground hover:text-foreground"
              disabled={sending || !dirty}
              data-testid="comment-cancel"
              onClick={onCancel}
            >
              {t("comment.cancel")}
            </Button>
          </div>
          <LimitCounter
            length={draft.length}
            limit={LIMITS.comment}
            testId="comment-counter"
          />
        </div>
      </div>
    </div>
  );
}

interface CommentRowProps {
  comment: CommentDto;
  cardId: string;
  boardId: string;
  currentUserId: string | undefined;
  readOnly: boolean;
  /** Search deep link target (TASK-177.13). */
  highlighted?: boolean;
  onDelete: () => void;
  /** Replaces the row after a successful inline edit (TASK-176.2). */
  onUpdated: (comment: CommentDto) => void;
}

function CommentRow({
  comment,
  cardId,
  boardId,
  currentUserId,
  readOnly,
  highlighted = false,
  onDelete,
  onUpdated,
}: CommentRowProps) {
  const { t, lang } = useI18n();
  const hour12 = useHour12();
  const toast = useToast();
  const openProfile = useOpenProfile();
  const member = useBoardMember(boardId, comment.authorId);
  const own = currentUserId !== undefined && comment.authorId === currentUserId;
  const pending = comment.id.startsWith("pending-");
  // The DTO carries the author's display identity (TASK-177.2): once that
  // person leaves, the member roster no longer has them and the comment
  // would otherwise collapse to `?`.
  const email = comment.authorEmail ?? member?.email ?? "";
  const displayName = comment.authorName ?? member?.displayName ?? null;
  const name = userLabel(displayName, email) || "?";

  // Inline edit (TASK-176.2, TASK-177.11): the row stays in place; its body
  // swaps for the same markdown editor the composer uses, and the author may
  // retype the structured kind alongside the text.
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(comment.text);
  const [editKind, setEditKind] = useState(comment.kind);
  const [saving, setSaving] = useState(false);
  const [editorNonce, setEditorNonce] = useState(0);
  const editButtonRef = useRef<HTMLButtonElement | null>(null);
  const wasEditingRef = useRef(false);

  // Return focus to the Edit button when the inline editor closes, so a
  // keyboard edit does not drop focus to the dialog body (DoD §17).
  useEffect(() => {
    if (wasEditingRef.current && !editing) editButtonRef.current?.focus();
    wasEditingRef.current = editing;
  }, [editing]);

  const unchanged =
    draft.trim() === comment.text.trim() && editKind === comment.kind;
  const canSave =
    !saving &&
    !unchanged &&
    draft.trim().length > 0 &&
    draft.trim().length <= LIMITS.comment;

  const startEdit = () => {
    if (!own || readOnly || pending) return;
    setDraft(comment.text);
    setEditKind(comment.kind);
    setEditorNonce((nonce) => nonce + 1);
    setEditing(true);
  };

  const cancelEdit = () => {
    if (saving) return;
    setEditing(false);
    setDraft(comment.text);
    setEditKind(comment.kind);
  };

  const saveEdit = async () => {
    const text = draft.trim();
    if (!canSave || text.length === 0) return;
    setSaving(true);
    try {
      // Send only what changed: a kind-only save keeps the old text (and its
      // attachment reconciliation) out of the PATCH body.
      const textChanged = text !== comment.text.trim();
      const kindChanged = editKind !== comment.kind;
      const saved = await api.updateComment(
        comment.id,
        textChanged ? text : undefined,
        kindChanged ? editKind : undefined,
      );
      onUpdated(saved);
      setEditing(false);
      setDraft(saved.text);
      setEditKind(saved.kind);
    } catch {
      // Keep the editor and the draft: the author can retry without
      // retyping, and the row below still shows the stored text.
      toast.error(t("comment.editError"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <li
      className={cn(
        "group flex items-start gap-2.5 rounded-md text-sm",
        highlighted && "bg-primary/10 ring-2 ring-primary/40",
        pending && "opacity-60",
      )}
      data-testid="comment"
      data-comment-id={comment.id}
      data-search-highlight={highlighted ? "true" : undefined}
      data-pending={pending ? "true" : undefined}
      tabIndex={highlighted ? -1 : undefined}
    >
      <button
        type="button"
        aria-label={t("profile.open", { name })}
        onClick={() => openProfile(comment.authorId)}
        className="ml-0.5 mt-0.5 inline-flex shrink-0 rounded-full"
      >
        <UserAvatar
          userId={comment.authorId}
          displayName={displayName}
          email={email}
          color={member?.avatarColor}
          avatarPath={member?.avatarPath}
          size="sm"
          className="ring-1 ring-border/60"
        />
      </button>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-baseline gap-2 max-sm:flex-col max-sm:items-stretch max-sm:gap-1">
          <div
            data-testid="comment-header-meta"
            className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2 gap-y-1"
          >
            <button
              type="button"
              data-testid="comment-author"
              onClick={() => openProfile(comment.authorId)}
              className="min-w-[6rem] max-w-full truncate text-left font-medium hover:underline"
            >
              {name}
            </button>
            {comment.actorType === "agent" ? (
              <span
                data-testid="comment-agent-badge"
                className="shrink-0 rounded bg-muted px-1 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground"
                title={t("activity.agent")}
              >
                {t("activity.agent")}
              </span>
            ) : null}
            <time
              className="shrink-0 text-[11px] text-muted-foreground"
              dateTime={new Date(comment.createdAt).toISOString()}
              title={formatDate(comment.createdAt, lang, hour12)}
            >
              {/* eslint-disable-next-line react-hooks/purity -- relative time is refreshed every render on purpose */}
              {formatRelative(comment.createdAt, lang, Date.now(), hour12)}
            </time>
            {comment.editedAt || comment.kind !== DEFAULT_COMMENT_KIND ? (
              <span
                data-testid="comment-meta"
                className="flex min-w-0 shrink-0 flex-wrap items-center gap-2 max-sm:basis-full"
              >
                {comment.editedAt ? (
                  <span
                    data-testid="comment-edited"
                    className="shrink-0 cursor-help text-[11px] text-muted-foreground"
                    title={formatDate(comment.editedAt, lang, hour12)}
                  >
                    {t("comment.edited")}
                  </span>
                ) : null}
                {comment.kind !== DEFAULT_COMMENT_KIND ? (
                  <span
                    data-testid="comment-kind-badge"
                    className="shrink-0 rounded-full border border-border/70 px-1.5 py-px text-[10px] font-medium uppercase tracking-wide text-muted-foreground"
                  >
                    {kindLabel(comment.kind, t)}
                  </span>
                ) : null}
              </span>
            ) : null}
          </div>
          {own && !readOnly && !pending && !editing ? (
            <div
              data-testid="comment-actions"
              className="ml-auto flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 no-hover:opacity-100 group-hover:opacity-100 max-sm:self-end"
            >
              <button
                ref={editButtonRef}
                type="button"
                aria-label={t("comment.edit")}
                data-testid="comment-edit"
                className="inline-flex shrink-0 items-center justify-center rounded-sm p-1 text-muted-foreground/60 transition-colors hover:bg-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring max-md:h-11 max-md:w-11 no-hover:h-11 no-hover:w-11"
                onClick={startEdit}
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                aria-label={t("comment.delete")}
                data-testid="comment-delete"
                className="inline-flex shrink-0 items-center justify-center rounded-sm p-1 text-muted-foreground/60 transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring max-md:h-11 max-md:w-11 no-hover:h-11 no-hover:w-11"
                onClick={onDelete}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : null}
        </div>
        {comment.actorType === "agent" &&
        (comment.apiTokenId || comment.agentSessionId) ? (
          <AgentAttribution
            apiTokenId={comment.apiTokenId}
            agentSessionId={comment.agentSessionId}
            agentName={comment.agentName}
            className="mt-0.5"
          />
        ) : null}
        <div className="mt-0.5 text-foreground/90">
          {editing ? (
            <div className="space-y-2">
              <Suspense fallback={<Skeleton className="h-9 rounded-md" />}>
                <CommentComposerEditor
                  key={editorNonce}
                  cardId={cardId}
                  boardId={boardId}
                  value={draft}
                  onChange={(value) => {
                    // While the PATCH is in flight the draft is frozen, so a
                    // late keystroke cannot diverge from what is being saved.
                    if (!saving) setDraft(value);
                  }}
                  onSubmit={() => void saveEdit()}
                  onCancel={cancelEdit}
                  autoFocus
                  placeholder={t("comment.placeholder")}
                />
              </Suspense>
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5">
                  <CommentKindPicker
                    kind={editKind}
                    disabled={saving}
                    onChange={setEditKind}
                    testId="comment-edit-kind"
                  />
                  <Button
                    variant="premium"
                    size="sm"
                    disabled={!canSave}
                    data-testid="comment-edit-save"
                    onClick={() => void saveEdit()}
                  >
                    {saving ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : null}
                    {t("comment.send")}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-muted-foreground hover:text-foreground"
                    disabled={saving}
                    data-testid="comment-edit-cancel"
                    onClick={cancelEdit}
                  >
                    {t("comment.cancel")}
                  </Button>
                </div>
                <LimitCounter
                  length={draft.length}
                  limit={LIMITS.comment}
                  testId="comment-edit-counter"
                />
              </div>
            </div>
          ) : (
            <Suspense
              fallback={
                /* Raw text for a frame — the real chunk is cached after the
                   first open, so this is only the composer's own chunk ride. */
                <p className="whitespace-pre-wrap break-words">
                  {comment.text}
                </p>
              }
            >
              <CommentBody text={comment.text} />
            </Suspense>
          )}
        </div>
      </div>
    </li>
  );
}
