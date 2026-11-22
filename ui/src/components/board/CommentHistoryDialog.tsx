import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Loader2 } from "lucide-react";
import type {
  CommentHistoryIncompleteReason,
  CommentRevisionCause,
  CommentRevisionDto,
  CommentRevisionPage,
} from "@janosik/shared";

import { api, ApiError } from "@/api/client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SkeletonRegion } from "@/components/ui/skeleton";
import { formatDate, useHour12, useI18n, type MessageKey } from "@/i18n";
import { cn } from "@/lib/utils";
import { useBoardLive } from "@/store/board-live";
import { COMMENT_HISTORY_RELEASE } from "@/utils/comment-history-release";
import { diffSides, type DiffSegment } from "@/utils/diff-words";

/** Same page the API defaults to (TASK-185.3 §3.3). */
const PAGE_SIZE = 20;

const CAUSE_KEYS = {
  author_edit: "comment.history.cause.author_edit",
  attachment_deleted: "comment.history.cause.attachment_deleted",
  system: "comment.history.cause.system",
} satisfies Record<CommentRevisionCause, MessageKey>;

type Status = "loading" | "ready" | "error";

interface CommentHistoryDialogProps {
  open: boolean;
  commentId: string;
  boardId: string;
  cardId: string;
  /** Unix ms of the last text edit, shown as the dialog's subtitle. */
  editedAt?: number;
  onOpenChange: (open: boolean) => void;
}

function isGone(error: unknown): boolean {
  return (
    error instanceof ApiError && (error.status === 403 || error.status === 404)
  );
}

/**
 * A live recheck page that must replace the visible list with an empty state:
 * GDPR erase and writer gaps delete or disavow the saved revisions, and any
 * empty page that declares incomplete history can no longer be appended to.
 */
function clearsHistory(page: CommentRevisionPage): boolean {
  return (
    erasesHistory(page) || (page.items.length === 0 && page.historyIncomplete)
  );
}

/** Reasons that invalidate every loaded snapshot, including page 1. */
function erasesHistory(page: CommentRevisionPage): boolean {
  return (
    page.historyIncompleteReason === "gdpr_erase" ||
    page.historyIncompleteReason === "writer_gap"
  );
}

/**
 * Read-only edit history of one comment (TASK-185.4, §3.4).
 *
 * The comment row opens this from its “Edited” trigger. The list is the
 * TASK-185.3 cursor API (newest revision first), so a comment with a trimmed
 * or erased chain still shows its banner on the first and every later page.
 * Text is rendered as escaped React text — Markdown, mentions and URLs stay
 * exactly as written — with the changed fragment highlighted by `diffSides`.
 *
 * Live deletion closes and clears the overlay; a new edit on another tab
 * marks the open list stale instead of silently showing a gap, and the
 * access check reruns on focus, visibility and reconnect like the thread.
 */
export function CommentHistoryDialog({
  open,
  commentId,
  boardId,
  cardId,
  editedAt,
  onOpenChange,
}: CommentHistoryDialogProps) {
  const { t, lang } = useI18n();
  const hour12 = useHour12();
  const { activity } = useBoardLive();

  const [status, setStatus] = useState<Status>("loading");
  const [items, setItems] = useState<CommentRevisionDto[]>([]);
  const itemsRef = useRef<CommentRevisionDto[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [reason, setReason] = useState<CommentHistoryIncompleteReason | null>(
    null,
  );
  const [stale, setStale] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [olderError, setOlderError] = useState(false);
  // Every first-page load or close invalidates an in-flight response. A
  // slower reload must never overwrite a newer deletion or access check.
  const seqRef = useRef(0);
  // Synchronous mirror of `status`: a focus recheck can resolve between the
  // first page's `setStatus` and its effect, so the ref is updated with it.
  const statusRef = useRef<Status>("loading");
  // Newest revision a recheck saw while page 1 was still in flight. The
  // first page consumes it when deciding whether to show the stale warning.
  const latestRecheckRevisionRef = useRef(0);
  // Open/close generation: a recheck from an earlier opening must not clear a
  // newly opened history even if its privacy response arrives late.
  const sessionRef = useRef(0);
  // Transient controls (Refresh, retry, Show older) unmount when their state
  // lands. Move focus to the dialog first so it never falls to <body>, then
  // return it to the still-mounted Show older button on an intermediate page
  // or to the end marker once the last older page replaces the button.
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const showOlderRef = useRef<HTMLButtonElement | null>(null);
  const olderRetryRef = useRef<HTMLButtonElement | null>(null);
  const endRef = useRef<HTMLParagraphElement | null>(null);
  const focusOlderRef = useRef(false);
  const focusEndRef = useRef(false);
  const keepFocusInDialog = useCallback(() => {
    dialogRef.current?.focus();
  }, []);

  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  const reset = useCallback(() => {
    itemsRef.current = [];
    latestRecheckRevisionRef.current = 0;
    setItems([]);
    setNextCursor(null);
    setReason(null);
    statusRef.current = "loading";
    setStatus("loading");
    setStale(false);
    setLoadingOlder(false);
    setOlderError(false);
    focusOlderRef.current = false;
    focusEndRef.current = false;
  }, []);

  /**
   * Drop every loaded revision after an erase/gap and invalidate any first or
   * older page still in flight. If focus was on any dialog descendant that is
   * about to unmount (rows, snapshots, paging/retry/refresh controls), move it
   * to the dialog; the dialog container and its close button stay mounted.
   */
  const clearHistory = useCallback(
    (nextReason: CommentHistoryIncompleteReason | null) => {
      const active = document.activeElement;
      const focusWillUnmount =
        active instanceof HTMLElement &&
        dialogRef.current !== null &&
        active !== dialogRef.current &&
        dialogRef.current.contains(active) &&
        active.closest('[data-testid="dialog-close"]') === null;
      if (focusWillUnmount) dialogRef.current?.focus();
      seqRef.current += 1;
      latestRecheckRevisionRef.current = 0;
      itemsRef.current = [];
      setItems([]);
      setNextCursor(null);
      setReason(nextReason);
      statusRef.current = "ready";
      setStatus("ready");
      setStale(false);
      setLoadingOlder(false);
      setOlderError(false);
      focusOlderRef.current = false;
      focusEndRef.current = false;
    },
    [],
  );

  const loadFirst = useCallback(
    async (keepBanner = false) => {
      const seq = ++seqRef.current;
      statusRef.current = "loading";
      setStatus("loading");
      setStale(false);
      setLoadingOlder(false);
      setOlderError(false);
      focusOlderRef.current = false;
      focusEndRef.current = false;
      latestRecheckRevisionRef.current = 0;
      itemsRef.current = [];
      setItems([]);
      setNextCursor(null);
      // A live refresh keeps the banner on screen until the new page says
      // whether the chain is still incomplete; a fresh open clears it.
      if (!keepBanner) setReason(null);
      try {
        const page = await api.listCommentRevisions(
          commentId,
          undefined,
          PAGE_SIZE,
        );
        if (seq !== seqRef.current) return;
        itemsRef.current = page.items;
        setItems(page.items);
        setNextCursor(page.nextCursor);
        setReason(page.historyIncompleteReason);
        const pageNewest = page.items[0]?.revisionNumber ?? 0;
        if (latestRecheckRevisionRef.current > pageNewest) setStale(true);
        statusRef.current = "ready";
        setStatus("ready");
      } catch (error) {
        if (seq !== seqRef.current) return;
        if (isGone(error)) {
          // The comment or the caller's access disappeared: never keep a
          // previously loaded body on screen after the server refuses it.
          seqRef.current += 1;
          reset();
          onOpenChange(false);
          return;
        }
        statusRef.current = "error";
        setStatus("error");
      }
    },
    [commentId, onOpenChange, reset],
  );

  useEffect(() => {
    sessionRef.current += 1;
  }, [commentId, open]);

  // Opening starts a fresh first page; closing invalidates any response that
  // is still in flight. The dialog content unmounts when closed, so no text
  // survives on screen while the next open reloads from page one.
  useEffect(() => {
    if (!open) {
      seqRef.current += 1;
      return;
    }
    // Defer the first fetch one microtask: the effect body must not cascade a
    // synchronous state update, and `open=false` can cancel it immediately.
    let cancelled = false;
    void Promise.resolve().then(() => {
      if (!cancelled) void loadFirst();
    });
    return () => {
      cancelled = true;
    };
  }, [commentId, loadFirst, open]);

  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (!next) {
        seqRef.current += 1;
        reset();
      }
      onOpenChange(next);
    },
    [onOpenChange, reset],
  );

  const loadOlder = useCallback(async () => {
    const cursor = nextCursor;
    if (cursor === null || loadingOlder) return;
    const seq = seqRef.current;
    const session = sessionRef.current;
    setLoadingOlder(true);
    setOlderError(false);
    try {
      const page = await api.listCommentRevisions(commentId, cursor, PAGE_SIZE);
      if (session !== sessionRef.current) return;
      if (erasesHistory(page)) {
        // GDPR erase and writer gaps invalidate every loaded snapshot; do not
        // keep page 1 visible under the banner. This check must precede the
        // seq guard: a Refresh that started while this page was in flight may
        // have bumped the epoch, and clearHistory invalidates that refresh.
        clearHistory(page.historyIncompleteReason);
        return;
      }
      if (seq !== seqRef.current) return;
      setItems((current) => {
        const seen = new Set(current.map((revision) => revision.id));
        const next = [
          ...current,
          ...page.items.filter((revision) => !seen.has(revision.id)),
        ];
        // Keep the recheck comparison in sync without waiting for the
        // passive items effect.
        itemsRef.current = next;
        return next;
      });
      setNextCursor(page.nextCursor);
      // The reason describes the live comment and is repeated on every page;
      // the latest page wins without ever hiding an older banner.
      setReason(page.historyIncompleteReason);
      if (page.nextCursor === null) {
        focusEndRef.current = true;
      } else {
        // The button stays mounted on an intermediate page: give its focus
        // back instead of leaving it at the top of the dialog.
        focusOlderRef.current = true;
      }
    } catch (error) {
      if (seq !== seqRef.current) return;
      if (isGone(error)) {
        seqRef.current += 1;
        reset();
        onOpenChange(false);
        return;
      }
      setOlderError(true);
    } finally {
      if (seq === seqRef.current) setLoadingOlder(false);
    }
  }, [commentId, clearHistory, loadingOlder, nextCursor, onOpenChange, reset]);

  useEffect(() => {
    if (status !== "ready") return;
    if (focusOlderRef.current && nextCursor !== null) {
      focusOlderRef.current = false;
      // A slow request must not steal focus if the reader already moved on.
      if (document.activeElement === dialogRef.current) {
        showOlderRef.current?.focus();
      }
      return;
    }
    if (!focusEndRef.current || nextCursor !== null) return;
    focusEndRef.current = false;
    if (document.activeElement === dialogRef.current) {
      endRef.current?.focus();
    }
  }, [items.length, nextCursor, status]);

  // A failed older page leaves the retry control below the full list. Move
  // focus there so the keyboard user does not have to tab through every row,
  // but only when they have not already focused something else meanwhile.
  useEffect(() => {
    if (!olderError) return;
    if (document.activeElement !== dialogRef.current) return;
    olderRetryRef.current?.focus();
  }, [olderError]);

  // A background tab, reconnect or focus can hide a revoked membership or a
  // deleted comment. Probe the same protected endpoint; only 403/404 close
  // the overlay, a transient failure leaves the loaded page alone.
  const recheckAccess = useCallback(async () => {
    const seq = seqRef.current;
    const session = sessionRef.current;
    try {
      const page = await api.listCommentRevisions(commentId, undefined, 1);
      if (session !== sessionRef.current) return;
      if (clearsHistory(page)) {
        // A privacy clear wins even if a page load started after this recheck
        // and bumped `seqRef`: clearHistory advances it again, invalidating
        // that load so it cannot restore the erased rows.
        clearHistory(page.historyIncompleteReason);
        return;
      }
      if (seq !== seqRef.current) return;
      setReason(page.historyIncompleteReason);
      const newest = page.items[0]?.revisionNumber ?? 0;
      if (statusRef.current === "ready") {
        const loadedNewest = itemsRef.current[0]?.revisionNumber ?? 0;
        if (newest > loadedNewest) setStale(true);
      } else {
        // The first page is still in flight. Remember the newest revision the
        // recheck saw so that page can mark itself stale once it lands.
        latestRecheckRevisionRef.current = Math.max(
          latestRecheckRevisionRef.current,
          newest,
        );
      }
    } catch (error) {
      if (session !== sessionRef.current) return;
      if (seq !== seqRef.current) return;
      if (isGone(error)) {
        seqRef.current += 1;
        reset();
        onOpenChange(false);
      }
    }
  }, [clearHistory, commentId, onOpenChange, reset]);

  useEffect(() => {
    if (!open) return;
    const recheck = () => void recheckAccess();
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
  }, [open, recheckAccess]);

  // Live comment changes: an edit elsewhere invalidates the open page (the
  // reader gets an explicit refresh instead of a silently shifted list), a
  // deletion closes and clears it at once.
  useEffect(() => {
    if (!open) return;
    return activity.subscribe((event) => {
      if (event.boardId !== boardId || event.cardId !== cardId) return;
      const changedId = event.commentId ?? event.detail;
      if (changedId !== commentId) return;
      if (event.kind === "comment_updated") {
        // A kind-only PATCH has no revision and does not move text history;
        // only a real text edit invalidates the open revision list.
        if (event.revisionId) setStale(true);
        return;
      }
      if (event.kind === "comment_deleted") {
        seqRef.current += 1;
        reset();
        onOpenChange(false);
      }
    });
  }, [activity, boardId, cardId, commentId, onOpenChange, open, reset]);

  const banner =
    reason === null
      ? null
      : reason === "legacy_cutover"
        ? t("comment.history.banner.legacy", {
            release: COMMENT_HISTORY_RELEASE,
          })
        : t("comment.history.banner.generic");

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        ref={dialogRef}
        tabIndex={-1}
        data-testid="comment-history-dialog"
        data-reason={reason ?? undefined}
        closeClassName="h-11 w-11 md:h-11 md:w-11"
        className="max-w-2xl gap-3 overflow-x-hidden outline-none"
      >
        <DialogHeader className="pr-8">
          <DialogTitle>{t("comment.history.title")}</DialogTitle>
          <DialogDescription>
            {editedAt === undefined
              ? t("comment.history.description")
              : t("comment.history.subtitle", {
                  date: formatDate(editedAt, lang, hour12),
                })}
          </DialogDescription>
        </DialogHeader>

        {banner !== null ? (
          <p
            role="status"
            data-testid="comment-history-banner"
            data-reason={reason ?? undefined}
            className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs leading-relaxed text-foreground"
          >
            {banner}
          </p>
        ) : null}

        {stale ? (
          <div
            role="status"
            data-testid="comment-history-stale"
            className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border/70 bg-muted/40 px-3 py-2 text-xs text-muted-foreground"
          >
            <span>{t("comment.history.stale")}</span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              data-testid="comment-history-refresh"
              className="max-md:min-h-11 no-hover:min-h-11"
              onClick={() => {
                keepFocusInDialog();
                void loadFirst(true);
              }}
            >
              {t("comment.history.refresh")}
            </Button>
          </div>
        ) : null}

        <div className="min-h-0 flex-1 space-y-3 overflow-x-hidden overflow-y-auto pr-1">
          {status === "loading" ? (
            <SkeletonRegion
              label={t("comment.history.loading")}
              testId="comment-history-loading"
              className="space-y-2"
            >
              <div className="space-y-2">
                {Array.from({ length: 3 }, (_, index) => (
                  <div
                    key={index}
                    className="h-20 w-full rounded-lg border border-border/50 bg-skeleton/40"
                  />
                ))}
              </div>
            </SkeletonRegion>
          ) : status === "error" ? (
            <div
              role="alert"
              data-testid="comment-history-error"
              className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm"
            >
              <span>{t("comment.history.loadError")}</span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                data-testid="comment-history-retry"
                className="max-md:min-h-11 no-hover:min-h-11"
                onClick={() => {
                  keepFocusInDialog();
                  void loadFirst(true);
                }}
              >
                {t("comment.history.retry")}
              </Button>
            </div>
          ) : items.length === 0 ? (
            <p
              data-testid="comment-history-empty"
              className="rounded-md border border-dashed border-border/70 px-3 py-6 text-center text-sm text-muted-foreground"
            >
              {t("comment.history.empty")}
            </p>
          ) : (
            <>
              <ol
                className="space-y-2"
                data-testid="comment-history-list"
                aria-label={t("comment.history.listLabel")}
              >
                {items.map((revision) => (
                  <RevisionItem key={revision.id} revision={revision} />
                ))}
              </ol>

              {nextCursor !== null ? (
                <Button
                  ref={showOlderRef}
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={loadingOlder}
                  data-testid="comment-history-show-older"
                  className="max-md:min-h-11 no-hover:min-h-11"
                  onClick={() => {
                    keepFocusInDialog();
                    void loadOlder();
                  }}
                >
                  {loadingOlder ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : null}
                  {t("comment.history.showOlder")}
                </Button>
              ) : (
                <p
                  ref={endRef}
                  tabIndex={-1}
                  data-testid="comment-history-end"
                  className="rounded text-xs text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {t("comment.history.end")}
                </p>
              )}

              {olderError ? (
                <div
                  role="alert"
                  data-testid="comment-history-older-error"
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs"
                >
                  <span>{t("comment.history.olderError")}</span>
                  <Button
                    ref={olderRetryRef}
                    type="button"
                    variant="outline"
                    size="sm"
                    data-testid="comment-history-older-retry"
                    className="max-md:min-h-11 no-hover:min-h-11"
                    onClick={() => {
                      keepFocusInDialog();
                      void loadOlder();
                    }}
                  >
                    {t("comment.history.retry")}
                  </Button>
                </div>
              ) : null}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function RevisionItem({ revision }: { revision: CommentRevisionDto }) {
  const { t, lang } = useI18n();
  const hour12 = useHour12();
  const [full, setFull] = useState(false);
  const snapshotId = useId();
  const sides = diffSides(revision.beforeText, revision.afterText);
  const editorName = revision.editorName?.trim()
    ? revision.editorName
    : t("comment.history.editorUnavailable");
  const date = formatDate(revision.createdAt, lang, hour12);
  const number = revision.revisionNumber;

  return (
    <li
      data-testid="comment-history-revision"
      data-revision-number={number}
      className="min-w-0 rounded-lg border border-border/70 bg-card/50 p-3"
    >
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">
          {t("comment.history.revision", { number })}
        </span>
        <time
          dateTime={new Date(revision.createdAt).toISOString()}
          title={date}
        >
          {date}
        </time>
        <span
          data-testid="comment-history-editor"
          className="min-w-0 break-words"
        >
          {editorName}
        </span>
        {revision.actorType === "agent" ? (
          <span
            data-testid="comment-history-agent"
            className="inline-flex min-w-0 items-center gap-1"
          >
            <span className="shrink-0 rounded bg-muted px-1 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              {t("activity.agent")}
            </span>
            {revision.agentName ? (
              <span
                data-testid="comment-history-agent-name"
                className="min-w-0 break-words"
              >
                {revision.agentName}
              </span>
            ) : null}
          </span>
        ) : null}
        <span
          data-testid="comment-history-cause"
          className="rounded-full border border-border/70 px-1.5 py-px text-[10px] font-medium"
        >
          {t(CAUSE_KEYS[revision.cause])}
        </span>
      </div>

      <div
        data-testid="comment-history-diff"
        className="mt-2 grid min-w-0 gap-2 sm:grid-cols-2"
      >
        <DiffHalf label={t("comment.history.before")}>
          {sides === null ? (
            <span className="whitespace-pre-wrap text-foreground/80">
              {revision.beforeText}
            </span>
          ) : (
            <DiffSegments segments={sides.left} />
          )}
        </DiffHalf>
        <DiffHalf label={t("comment.history.after")}>
          {sides === null ? (
            <span className="whitespace-pre-wrap text-foreground/80">
              {revision.afterText}
            </span>
          ) : (
            <DiffSegments segments={sides.right} />
          )}
        </DiffHalf>
      </div>

      <button
        type="button"
        aria-expanded={full}
        aria-controls={full ? snapshotId : undefined}
        aria-label={
          full
            ? t("comment.history.hideSnapshotFor", { number })
            : t("comment.history.showSnapshotFor", { number })
        }
        data-testid={`comment-history-snapshot-toggle-${number}`}
        onClick={() => setFull((current) => !current)}
        className="mt-2 inline-flex min-h-11 items-center rounded-md px-2 text-xs font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring no-hover:min-h-11"
      >
        {full
          ? t("comment.history.hideSnapshot")
          : t("comment.history.showSnapshot")}
      </button>

      {full ? (
        <div
          id={snapshotId}
          data-testid={`comment-history-snapshot-${number}`}
          role="region"
          aria-label={t("comment.history.snapshotRegion", { number })}
          tabIndex={0}
          className="mt-2 max-h-60 min-w-0 overflow-x-hidden overflow-y-auto rounded-md border border-border/70 bg-muted/20 p-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {t("comment.history.fullVersion")}
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {t("comment.history.before")}
          </p>
          <div
            data-testid={`comment-history-snapshot-before-${number}`}
            dir="auto"
            className="whitespace-pre-wrap break-words text-sm text-foreground/80 [overflow-wrap:anywhere]"
          >
            {revision.beforeText}
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            {t("comment.history.after")}
          </p>
          <div
            data-testid={`comment-history-snapshot-after-${number}`}
            dir="auto"
            className="whitespace-pre-wrap break-words text-sm text-foreground/80 [overflow-wrap:anywhere]"
          >
            {revision.afterText}
          </div>
        </div>
      ) : null}
    </li>
  );
}

function DiffHalf({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0 rounded-md bg-muted/30 p-2">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <div
        dir="auto"
        className="mt-1 min-w-0 whitespace-pre-wrap break-words text-sm text-foreground/80 [overflow-wrap:anywhere]"
      >
        {children}
      </div>
    </div>
  );
}

/**
 * One half of the character diff: unchanged context stays muted, the removed
 * fragment is struck through in red and the added one is green. The caller's
 * `whitespace-pre-wrap` keeps the comment's own line breaks.
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
