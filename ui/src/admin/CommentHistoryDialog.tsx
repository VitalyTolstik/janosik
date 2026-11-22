import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { ReactNode } from "react";
import { ChevronRight, Loader2 } from "lucide-react";
import type {
  AdminCommentRowDto,
  CommentHistoryIncompleteReason,
  CommentRevisionCause,
  CommentRevisionDto,
} from "@janosik/shared";

import { ApiError } from "@/api/client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatDate, useHour12, useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import { COMMENT_HISTORY_RELEASE } from "@/utils/comment-history-release";
import { diffSides, type DiffSegment } from "@/utils/diff-words";
import { adminApi } from "./admin-client";
import { useAdminT, type AdminMessageKey } from "./admin-i18n";
import { Badge } from "./ui";

/** Same page the admin revisions API defaults to (TASK-185.3 §3.3). */
const PAGE_SIZE = 20;

const CAUSE_KEYS = {
  author_edit: "admin.comments.history.cause.author_edit",
  attachment_deleted: "admin.comments.history.cause.attachment_deleted",
  system: "admin.comments.history.cause.system",
} satisfies Record<CommentRevisionCause, AdminMessageKey>;

type Status = "loading" | "ready" | "error";

/**
 * TASK-185.5 (§3.4): the admin history trigger and its read-only dialog.
 *
 * The trigger is rendered only when `revisionCount` is not `null` — a live
 * comment with zero revisions still opens it, so a persisted incomplete-history
 * reason is never hidden. A deleted comment or parent answers `null` in both
 * fields (and the revisions route answers `404`), so no dead link remains.
 *
 * The dialog uses the TASK-185.3 admin revisions route: newest first, cursor
 * pagination, the reason repeated on every page. Text is escaped React text
 * with `diffSides` highlighting and an explicit full-snapshot view.
 */
export function AdminCommentHistoryButton({
  comment,
  className,
}: {
  comment: AdminCommentRowDto;
  className?: string;
}) {
  const t = useAdminT();
  const { lang } = useI18n();
  const hour12 = useHour12();
  const [open, setOpen] = useState(false);
  const openRef = useRef<HTMLButtonElement>(null);
  const editedDate =
    comment.editedAt === null
      ? null
      : formatDate(comment.editedAt, lang, hour12);

  /**
   * Stable across parent re-renders (a refresh or toast must not make the
   * dialog's first-page effect rerun and clear the loaded cursor).
   */
  const handleOpenChange = useCallback((next: boolean) => {
    setOpen(next);
    if (!next) {
      // Radix restores focus to the trigger; repeat the assignment for a
      // request that closed the dialog while the trigger remounted.
      requestAnimationFrame(() => openRef.current?.focus());
    }
  }, []);

  if (comment.revisionCount === null) {
    // Deleted rows and rows under a deleted parent keep the old read-only
    // edit marker; only the revisions link and dialog disappear.
    return comment.editedAt === null ? null : (
      <span
        data-testid="admin-comment-edited"
        title={editedDate ?? undefined}
        className={cn(
          "inline-flex max-w-full shrink-0 items-center align-middle",
          className,
        )}
      >
        <Badge variant="neutral">{t("admin.comments.edited")}</Badge>
      </span>
    );
  }

  const edited = comment.editedAt !== null;
  const label = edited
    ? t("admin.comments.edited")
    : t("admin.comments.history");
  const countLabel = t(
    comment.revisionCount === 1
      ? "admin.comments.history.openOne"
      : "admin.comments.history.openMany",
    { count: comment.revisionCount },
  );
  const accessibleName = t("admin.comments.history.triggerName", {
    label,
    count: countLabel,
    date:
      editedDate === null
        ? ""
        : t("admin.comments.history.triggerDate", { date: editedDate }),
    incomplete: comment.historyIncomplete
      ? t("admin.comments.history.triggerIncomplete")
      : "",
  });
  const showCount = comment.revisionCount > 0 || comment.historyIncomplete;

  return (
    <>
      <button
        ref={openRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={accessibleName}
        title={accessibleName}
        data-testid={`admin-comment-history-${comment.id}`}
        onClick={() => setOpen(true)}
        className={cn(
          "inline-flex max-w-full shrink-0 items-center gap-1 rounded align-middle hover:bg-hover/60 hover:underline focus-visible:bg-hover/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring max-lg:min-h-11 max-lg:min-w-11",
          className,
        )}
      >
        <Badge variant={comment.historyIncomplete ? "warning" : "neutral"}>
          {label}
        </Badge>
        {showCount ? (
          <span
            data-testid={`admin-comment-revision-count-${comment.id}`}
            className="text-[10px] tabular-nums text-muted-foreground"
          >
            {comment.revisionCount}
          </span>
        ) : null}
        {comment.historyIncomplete ? (
          <span
            aria-hidden
            className="text-[10px] font-semibold text-warning"
            title={t("admin.comments.history.banner.generic")}
          >
            !
          </span>
        ) : null}
        <ChevronRight aria-hidden className="h-3 w-3 text-muted-foreground" />
      </button>
      <AdminCommentHistoryDialog
        comment={comment}
        open={open}
        onOpenChange={handleOpenChange}
      />
    </>
  );
}

function isGone(error: unknown): boolean {
  return (
    error instanceof ApiError && (error.status === 403 || error.status === 404)
  );
}

export function AdminCommentHistoryDialog({
  comment,
  open,
  onOpenChange,
}: {
  comment: AdminCommentRowDto;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useAdminT();
  const { lang } = useI18n();
  const hour12 = useHour12();

  const [status, setStatus] = useState<Status>("loading");
  const [items, setItems] = useState<CommentRevisionDto[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [reason, setReason] = useState<CommentHistoryIncompleteReason | null>(
    null,
  );
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [olderError, setOlderError] = useState(false);
  // A close or a newer first page invalidates every in-flight response.
  const seqRef = useRef(0);
  const endRef = useRef<HTMLParagraphElement | null>(null);
  const focusEndRef = useRef(false);
  // The caller may pass a fresh callback on every render; it is only a way to
  // close, so keep the latest one out of the load effect's dependencies.
  const onOpenChangeRef = useRef(onOpenChange);
  useEffect(() => {
    onOpenChangeRef.current = onOpenChange;
  }, [onOpenChange]);
  const closeDialog = useCallback(() => {
    onOpenChangeRef.current(false);
  }, []);

  const reset = useCallback(() => {
    setItems([]);
    setNextCursor(null);
    setReason(null);
    setStatus("loading");
    setLoadingOlder(false);
    setOlderError(false);
  }, []);

  const loadFirst = useCallback(async () => {
    const seq = ++seqRef.current;
    setStatus("loading");
    setItems([]);
    setNextCursor(null);
    setReason(null);
    setLoadingOlder(false);
    setOlderError(false);
    try {
      const page = await adminApi.listCommentRevisions(
        comment.id,
        undefined,
        PAGE_SIZE,
      );
      if (seq !== seqRef.current) return;
      setItems(page.items);
      setNextCursor(page.nextCursor);
      setReason(page.historyIncompleteReason);
      setStatus("ready");
    } catch (error) {
      if (seq !== seqRef.current) return;
      if (isGone(error)) {
        seqRef.current += 1;
        reset();
        closeDialog();
        return;
      }
      setStatus("error");
    }
  }, [closeDialog, comment.id, reset]);

  useEffect(() => {
    if (!open) {
      // Invalidate a response that was still in flight; the next open starts
      // from a clean first page in `loadFirst`.
      seqRef.current += 1;
      return;
    }
    let cancelled = false;
    void Promise.resolve().then(() => {
      if (!cancelled) void loadFirst();
    });
    return () => {
      cancelled = true;
    };
  }, [loadFirst, open]);

  const loadOlder = useCallback(async () => {
    const cursor = nextCursor;
    if (cursor === null || loadingOlder) return;
    const seq = seqRef.current;
    setLoadingOlder(true);
    setOlderError(false);
    try {
      const page = await adminApi.listCommentRevisions(
        comment.id,
        cursor,
        PAGE_SIZE,
      );
      if (seq !== seqRef.current) return;
      setItems((current) => {
        const seen = new Set(current.map((revision) => revision.id));
        return [
          ...current,
          ...page.items.filter((revision) => !seen.has(revision.id)),
        ];
      });
      setNextCursor(page.nextCursor);
      // The reason belongs to the live comment and is repeated on every page.
      setReason(page.historyIncompleteReason);
      if (page.nextCursor === null) focusEndRef.current = true;
    } catch (error) {
      if (seq !== seqRef.current) return;
      if (isGone(error)) {
        seqRef.current += 1;
        reset();
        closeDialog();
        return;
      }
      setOlderError(true);
    } finally {
      if (seq === seqRef.current) setLoadingOlder(false);
    }
  }, [closeDialog, comment.id, loadingOlder, nextCursor, reset]);

  useEffect(() => {
    if (!focusEndRef.current || status !== "ready" || nextCursor !== null) {
      return;
    }
    focusEndRef.current = false;
    endRef.current?.focus();
  }, [nextCursor, status]);

  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (!next) {
        seqRef.current += 1;
        reset();
      }
      onOpenChangeRef.current(next);
    },
    [reset],
  );

  const banner =
    reason === null
      ? null
      : reason === "legacy_cutover"
        ? t("admin.comments.history.banner.legacy", {
            release: COMMENT_HISTORY_RELEASE,
          })
        : t("admin.comments.history.banner.generic");

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        data-testid="admin-comment-history-dialog"
        data-reason={reason ?? undefined}
        className="max-w-2xl gap-3 overflow-x-hidden"
      >
        <DialogHeader className="pr-12">
          <DialogTitle>{t("admin.comments.history.title")}</DialogTitle>
          <DialogDescription>
            {comment.editedAt === null
              ? t("admin.comments.history.description")
              : t("admin.comments.history.subtitle", {
                  date: formatDate(comment.editedAt, lang, hour12),
                })}
          </DialogDescription>
        </DialogHeader>

        {banner !== null ? (
          <p
            role="status"
            data-testid="admin-comment-history-banner"
            data-reason={reason ?? undefined}
            className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs leading-relaxed text-foreground"
          >
            {banner}
          </p>
        ) : null}

        <div className="min-h-0 flex-1 space-y-3 overflow-x-hidden overflow-y-auto pr-1">
          {status === "loading" ? (
            <p
              role="status"
              data-testid="admin-comment-history-loading"
              className="flex items-center gap-2 text-xs text-muted-foreground"
            >
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              {t("admin.comments.history.loading")}
            </p>
          ) : status === "error" ? (
            <div
              role="alert"
              data-testid="admin-comment-history-error"
              className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm"
            >
              <span>{t("admin.comments.history.loadError")}</span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                data-testid="admin-comment-history-retry"
                className="max-lg:min-h-11"
                onClick={() => void loadFirst()}
              >
                {t("admin.comments.history.retry")}
              </Button>
            </div>
          ) : items.length === 0 ? (
            <p
              data-testid="admin-comment-history-empty"
              className="rounded-md border border-dashed border-border/70 px-3 py-6 text-center text-sm text-muted-foreground"
            >
              {t("admin.comments.history.empty")}
            </p>
          ) : (
            <>
              <ol
                className="space-y-2"
                data-testid="admin-comment-history-list"
                aria-label={t("admin.comments.history.listLabel")}
              >
                {items.map((revision) => (
                  <RevisionItem key={revision.id} revision={revision} />
                ))}
              </ol>

              {nextCursor !== null ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={loadingOlder}
                  data-testid="admin-comment-history-show-older"
                  className="max-lg:min-h-11"
                  onClick={() => void loadOlder()}
                >
                  {loadingOlder ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : null}
                  {t("admin.comments.history.showOlder")}
                </Button>
              ) : (
                <p
                  ref={endRef}
                  tabIndex={-1}
                  data-testid="admin-comment-history-end"
                  className="rounded text-xs text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {t("admin.comments.history.end")}
                </p>
              )}

              {olderError ? (
                <div
                  role="alert"
                  data-testid="admin-comment-history-older-error"
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs"
                >
                  <span>{t("admin.comments.history.olderError")}</span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    data-testid="admin-comment-history-older-retry"
                    className="max-lg:min-h-11"
                    onClick={() => void loadOlder()}
                  >
                    {t("admin.comments.history.retry")}
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
  const t = useAdminT();
  const { lang } = useI18n();
  const hour12 = useHour12();
  const [full, setFull] = useState(false);
  const snapshotId = useId();
  const sides = diffSides(revision.beforeText, revision.afterText);
  const editorName = revision.editorName?.trim()
    ? revision.editorName
    : t("admin.comments.history.editorUnavailable");
  const date = formatDate(revision.createdAt, lang, hour12);
  const number = revision.revisionNumber;

  return (
    <li
      data-testid="admin-comment-history-revision"
      data-revision-number={number}
      className="min-w-0 rounded-lg border border-border/70 bg-card/50 p-3"
    >
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">
          {t("admin.comments.history.revision", { number })}
        </span>
        <time
          dateTime={new Date(revision.createdAt).toISOString()}
          title={date}
        >
          {date}
        </time>
        <span
          data-testid="admin-comment-history-editor"
          className="min-w-0 break-words"
        >
          {editorName}
        </span>
        {revision.actorType === "agent" ? (
          <span
            data-testid="admin-comment-history-agent"
            className="inline-flex min-w-0 items-center gap-1"
          >
            <span className="shrink-0 rounded bg-muted px-1 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              {t("admin.comments.history.agent")}
            </span>
            {revision.agentName ? (
              <span className="min-w-0 break-words">{revision.agentName}</span>
            ) : null}
          </span>
        ) : null}
        <span
          data-testid="admin-comment-history-cause"
          className="rounded-full border border-border/70 px-1.5 py-px text-[10px] font-medium"
        >
          {t(CAUSE_KEYS[revision.cause])}
        </span>
      </div>

      <div
        data-testid="admin-comment-history-diff"
        className="mt-2 grid min-w-0 gap-2 sm:grid-cols-2"
      >
        <DiffHalf label={t("admin.comments.history.before")}>
          {sides === null ? (
            <span className="whitespace-pre-wrap text-foreground/80">
              {revision.beforeText}
            </span>
          ) : (
            <DiffSegments segments={sides.left} />
          )}
        </DiffHalf>
        <DiffHalf label={t("admin.comments.history.after")}>
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
            ? t("admin.comments.history.hideSnapshotFor", { number })
            : t("admin.comments.history.showSnapshotFor", { number })
        }
        data-testid={`admin-comment-history-snapshot-toggle-${number}`}
        onClick={() => setFull((current) => !current)}
        className="mt-2 inline-flex min-h-9 items-center rounded-md px-2 text-xs font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring max-lg:min-h-11 max-lg:min-w-11 max-lg:px-3"
      >
        {full
          ? t("admin.comments.history.hideSnapshot")
          : t("admin.comments.history.showSnapshot")}
      </button>

      {full ? (
        <div
          id={snapshotId}
          role="region"
          aria-label={t("admin.comments.history.snapshotLabel", { number })}
          tabIndex={0}
          data-testid={`admin-comment-history-snapshot-${number}`}
          className="mt-2 max-h-60 min-w-0 overflow-x-hidden overflow-y-auto rounded-md border border-border/70 bg-muted/20 p-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {t("admin.comments.history.fullVersion")}
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {t("admin.comments.history.before")}
          </p>
          <div
            data-testid={`admin-comment-history-snapshot-before-${number}`}
            dir="auto"
            className="whitespace-pre-wrap break-words text-sm text-foreground/80 [overflow-wrap:anywhere]"
          >
            {revision.beforeText}
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            {t("admin.comments.history.after")}
          </p>
          <div
            data-testid={`admin-comment-history-snapshot-after-${number}`}
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
