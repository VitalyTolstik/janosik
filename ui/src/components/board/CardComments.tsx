import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { Loader2, Trash2 } from "lucide-react";
import type {
  ActivitySseEvent,
  AuthUserDto,
  CommentDto,
  CommentKind,
} from "@janosik/shared";
import { COMMENT_KINDS, DEFAULT_COMMENT_KIND, LIMITS } from "@janosik/shared";

import { api, isApiEnabled } from "@/api/client";
import { useAuth } from "@/auth/AuthContext";
import { ConfirmDialog } from "@/components/board/ConfirmDialog";
import { useOpenProfile } from "@/components/board/UserProfileDialog";
import { LimitCounter } from "@/components/ui/limit-counter";
import { Button } from "@/components/ui/button";
import { UserAvatar } from "@/components/ui/user-avatar";
import { useToast } from "@/components/Toast";
import { formatDate, formatRelative, useHour12, useI18n } from "@/i18n";
import { useBoardLive, useBoardMember } from "@/store/board-live";
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

/** Newest-first page size of the comment list. */
const PAGE_SIZE = 50;

interface CardCommentsProps {
  cardId: string;
  boardId: string;
  /** VIEWER mode: read the thread, no composer and no delete (TASK-35). */
  readOnly?: boolean;
  /** Loaded comment count for the section badge (newest page + older pages). */
  onCountChange?: (count: number) => void;
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
  onCountChange,
}: CardCommentsProps) {
  const { t } = useI18n();
  const toast = useToast();
  const { user } = useAuth();
  const serverMode = isApiEnabled();
  const { activity } = useBoardLive();

  const [items, setItems] = useState<CommentDto[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [draft, setDraft] = useState("");
  // Structured comment kind (TASK-157, D10) — a swarm vocabulary the reader
  // can filter on. The human composer defaults to a plain note.
  const [kind, setKind] = useState<CommentKind>(DEFAULT_COMMENT_KIND);
  const [sending, setSending] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<CommentDto | null>(null);
  // The editor owns its state between mounts (like the description), so a
  // cleared draft is applied by remounting it with a fresh key.
  const [editorNonce, setEditorNonce] = useState(0);

  const loadFirst = useCallback(async () => {
    if (!serverMode) return;
    try {
      const page = await api.listComments(cardId, undefined, PAGE_SIZE);
      setItems(page.items);
      setNextCursor(page.nextCursor);
    } catch {
      toast.error(t("comment.loadError"));
    }
  }, [cardId, serverMode, t, toast]);

  // A different card means a different thread: the parent remounts this
  // component with `key={cardId}`, so the initial state is the reset.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the thread lands after the await, not synchronously
    void loadFirst();
  }, [loadFirst]);

  useEffect(() => {
    onCountChange?.(items.length);
  }, [items.length, onCountChange]);

  // Live arrival: a foreign comment is not in the frame body (the frame
  // carries its id), so the newest page is re-read and merged — paginated
  // older pages stay untouched. Own echoes land in the same path and are
  // deduplicated by id, whichever wins the race with the POST response.
  const refreshNewest = useCallback(async () => {
    if (!serverMode) return;
    try {
      const page = await api.listComments(cardId, undefined, PAGE_SIZE);
      setItems((prev) => {
        const known = new Set(prev.map((comment) => comment.id));
        const fresh = page.items.filter((comment) => !known.has(comment.id));
        return fresh.length > 0 ? [...fresh, ...prev] : prev;
      });
    } catch {
      /* best effort: the next open or frame retries */
    }
  }, [cardId, serverMode]);

  useEffect(() => {
    if (!serverMode) return;
    return activity.subscribe((event: ActivitySseEvent) => {
      if (event.boardId !== boardId || event.cardId !== cardId) return;
      if (event.kind === "comment_added") {
        void refreshNewest();
        return;
      }
      if (event.kind === "comment_deleted" && event.detail) {
        const deletedId = event.detail;
        setItems((prev) => prev.filter((comment) => comment.id !== deletedId));
      }
    });
  }, [activity, boardId, cardId, serverMode, refreshNewest]);

  const trimmed = draft.trim();
  const canSend =
    serverMode &&
    !readOnly &&
    user !== null &&
    !sending &&
    trimmed.length > 0 &&
    trimmed.length <= LIMITS.comment;

  const handleSend = async () => {
    if (!canSend || user === null) return;
    const text = trimmed;
    const tempId = `pending-${createId()}`;
    const sentKind = kind;
    const optimistic: CommentDto = {
      id: tempId,
      cardId,
      authorId: user.id,
      text,
      kind: sentKind,
      createdAt: Date.now(),
    };
    setItems((prev) => [optimistic, ...prev]);
    setDraft("");
    setKind(DEFAULT_COMMENT_KIND);
    setEditorNonce((nonce) => nonce + 1);
    setSending(true);
    try {
      const saved = await api.createComment(cardId, text, undefined, sentKind);
      setItems((prev) => [
        saved,
        ...prev.filter(
          (comment) => comment.id !== tempId && comment.id !== saved.id,
        ),
      ]);
    } catch {
      setItems((prev) => prev.filter((comment) => comment.id !== tempId));
      setDraft(text);
      setKind(sentKind);
      setEditorNonce((nonce) => nonce + 1);
      toast.error(t("comment.sendError"));
    } finally {
      setSending(false);
    }
  };

  const handleCancel = () => {
    setDraft("");
    setKind(DEFAULT_COMMENT_KIND);
    setEditorNonce((nonce) => nonce + 1);
  };

  const handleDelete = async () => {
    const comment = pendingDelete;
    if (comment === null) return;
    setPendingDelete(null);
    setItems((prev) => prev.filter((item) => item.id !== comment.id));
    try {
      await api.deleteComment(comment.id);
    } catch {
      toast.error(t("comment.deleteError"));
      void loadFirst();
    }
  };

  const handleShowOlder = async () => {
    if (nextCursor === null || loadingOlder) return;
    setLoadingOlder(true);
    try {
      const page = await api.listComments(cardId, nextCursor, PAGE_SIZE);
      setItems((prev) => [...prev, ...page.items]);
      setNextCursor(page.nextCursor);
    } catch {
      toast.error(t("comment.loadError"));
    } finally {
      setLoadingOlder(false);
    }
  };

  return (
    <div className="space-y-3">
      {!readOnly && serverMode && user !== null ? (
        <CommentComposer
          user={user}
          cardId={cardId}
          draft={draft}
          sending={sending}
          canSend={canSend}
          editorNonce={editorNonce}
          kind={kind}
          onKindChange={setKind}
          onDraftChange={setDraft}
          onSubmit={() => void handleSend()}
          onCancel={handleCancel}
        />
      ) : null}

      {/* The empty state aligns with the comment column, not the avatar. */}
      {items.length === 0 ? (
        <p className="py-1 pl-[36px] text-sm text-muted-foreground/70">
          {t("comment.empty")}
        </p>
      ) : (
        <ol className="space-y-4" data-testid="comment-list">
          {items.map((comment) => (
            <CommentRow
              key={comment.id}
              comment={comment}
              boardId={boardId}
              currentUserId={user?.id}
              readOnly={readOnly}
              onDelete={() => setPendingDelete(comment)}
            />
          ))}
        </ol>
      )}

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
        title={t("comment.deleteTitle")}
        description={t("comment.deleteDescription")}
        confirmLabel={t("comment.deleteConfirm")}
        destructive
        onConfirm={() => void handleDelete()}
      />
    </div>
  );
}

interface CommentComposerProps {
  user: AuthUserDto;
  cardId: string;
  draft: string;
  sending: boolean;
  canSend: boolean;
  /** Bumped by the parent to reset the editor (send/cancel/error paths). */
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
 * Jira's comment box: avatar on the left, the markdown field that grows
 * with the text, and the primary Save on the left with a quiet Cancel
 * next to it — both rendered at once, both disabled until the draft has
 * something to send (or cancel).
 */
function CommentComposer({
  user,
  cardId,
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
  // With nothing typed there is nothing to cancel — keeping Cancel enabled
  // would only trigger the remount-reset flash for no reason.
  const dirty = draft.trim().length > 0;

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
            /* Same footprint as the single-line editor so the thread
               doesn't jump while the chunk streams in. */
            <div className="h-9 animate-pulse rounded-md bg-muted/40" />
          }
        >
          <CommentComposerEditor
            key={editorNonce}
            cardId={cardId}
            value={draft}
            onChange={onDraftChange}
            onSubmit={onSubmit}
            placeholder={t("comment.placeholder")}
          />
        </Suspense>
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <label className="sr-only" htmlFor="comment-kind">
              {t("comment.kindLabel")}
            </label>
            <select
              id="comment-kind"
              data-testid="comment-kind"
              aria-label={t("comment.kindLabel")}
              value={kind}
              disabled={sending}
              onChange={(event) =>
                onKindChange(event.target.value as CommentKind)
              }
              className="h-8 rounded-md border border-border bg-background px-2 text-xs text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
            >
              {COMMENT_KINDS.map((option) => (
                <option key={option} value={option}>
                  {kindLabel(option, t)}
                </option>
              ))}
            </select>
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
  boardId: string;
  currentUserId: string | undefined;
  readOnly: boolean;
  onDelete: () => void;
}

function CommentRow({
  comment,
  boardId,
  currentUserId,
  readOnly,
  onDelete,
}: CommentRowProps) {
  const { t, lang } = useI18n();
  const hour12 = useHour12();
  const openProfile = useOpenProfile();
  const member = useBoardMember(boardId, comment.authorId);
  const own = currentUserId !== undefined && comment.authorId === currentUserId;
  const pending = comment.id.startsWith("pending-");
  const email = member?.email ?? "";
  const name = userLabel(member?.displayName ?? null, email) || "?";

  return (
    <li
      className={`group flex items-start gap-2.5 text-sm ${pending ? "opacity-60" : ""}`}
      data-testid="comment"
      data-pending={pending ? "true" : undefined}
    >
      <button
        type="button"
        aria-label={t("profile.open", { name })}
        onClick={() => openProfile(comment.authorId)}
        className="ml-0.5 mt-0.5 inline-flex shrink-0 rounded-full"
      >
        <UserAvatar
          userId={comment.authorId}
          displayName={member?.displayName ?? null}
          email={email}
          color={member?.avatarColor}
          avatarPath={member?.avatarPath}
          size="sm"
          className="ring-1 ring-border/60"
        />
      </button>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <button
            type="button"
            onClick={() => openProfile(comment.authorId)}
            className="truncate font-medium hover:underline"
          >
            {name}
          </button>
          <time
            className="shrink-0 text-[11px] text-muted-foreground/70"
            dateTime={new Date(comment.createdAt).toISOString()}
            title={formatDate(comment.createdAt, lang, hour12)}
          >
            {/* eslint-disable-next-line react-hooks/purity -- relative time is refreshed every render on purpose */}
            {formatRelative(comment.createdAt, lang, Date.now(), hour12)}
          </time>
          {comment.kind !== DEFAULT_COMMENT_KIND ? (
            <span
              data-testid="comment-kind-badge"
              className="shrink-0 rounded-full border border-border/70 px-1.5 py-px text-[10px] font-medium uppercase tracking-wide text-muted-foreground"
            >
              {kindLabel(comment.kind, t)}
            </span>
          ) : null}
          {own && !readOnly && !pending ? (
            <button
              type="button"
              aria-label={t("comment.delete")}
              data-testid="comment-delete"
              className="ml-auto shrink-0 rounded-sm p-1 text-muted-foreground/60 opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100"
              onClick={onDelete}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </div>
        <div className="mt-0.5 text-foreground/90">
          <Suspense
            fallback={
              /* Raw text for a frame — the real chunk is cached after the
                 first open, so this is only the composer's own chunk ride. */
              <p className="whitespace-pre-wrap break-words">{comment.text}</p>
            }
          >
            <CommentBody text={comment.text} />
          </Suspense>
        </div>
      </div>
    </li>
  );
}
