import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { Loader2, Send, Trash2 } from "lucide-react";
import type {
  ActivitySseEvent,
  AuthUserDto,
  CommentDto,
} from "@janosik/shared";
import { LIMITS } from "@janosik/shared";

import { api, isApiEnabled } from "@/api/client";
import { useAuth } from "@/auth/AuthContext";
import { ConfirmDialog } from "@/components/board/ConfirmDialog";
import { useOpenProfile } from "@/components/board/UserProfileDialog";
import { LimitCounter } from "@/components/ui/limit-counter";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { UserAvatar } from "@/components/ui/user-avatar";
import { useToast } from "@/components/Toast";
import { formatDate, formatRelative, useHour12, useI18n } from "@/i18n";
import { useBoardLive, useBoardMember } from "@/store/board-live";
import { userLabel } from "@/utils/avatar";
import { createId } from "@/utils/id";
import { splitLinks } from "@/utils/linkify";

/** Newest-first page size of the comment list. */
const PAGE_SIZE = 50;

/** Composer ceiling: past this the textarea scrolls instead of growing. */
const COMPOSER_MAX_HEIGHT = 160;

interface CardCommentsProps {
  cardId: string;
  boardId: string;
  /** VIEWER mode: read the thread, no composer and no delete (TASK-35). */
  readOnly?: boolean;
  /** Loaded comment count for the section badge (newest page + older pages). */
  onCountChange?: (count: number) => void;
}

/**
 * The card's comment thread (TASK-37) over the TASK-28 REST API.
 *
 * Jira-style: the composer sits on top with your avatar, comments follow
 * newest-first, own comments can be soft-deleted after a confirmation, and
 * older pages load on demand with the opaque cursor. A comment written by
 * someone else arrives as a `type: "activity"` SSE frame and is pulled in
 * live; the frame carries only the comment id, the body comes from the
 * ordinary list endpoint.
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
  const [sending, setSending] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<CommentDto | null>(null);

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
    const tempId = `pending-${createId()}`;
    const optimistic: CommentDto = {
      id: tempId,
      cardId,
      authorId: user.id,
      text: trimmed,
      createdAt: Date.now(),
    };
    setItems((prev) => [optimistic, ...prev]);
    setDraft("");
    setSending(true);
    try {
      const saved = await api.createComment(cardId, trimmed);
      setItems((prev) => [
        saved,
        ...prev.filter(
          (comment) => comment.id !== tempId && comment.id !== saved.id,
        ),
      ]);
    } catch {
      setItems((prev) => prev.filter((comment) => comment.id !== tempId));
      setDraft(trimmed);
      toast.error(t("comment.sendError"));
    } finally {
      setSending(false);
    }
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
          draft={draft}
          sending={sending}
          canSend={canSend}
          onDraftChange={setDraft}
          onSend={() => void handleSend()}
        />
      ) : null}

      {items.length === 0 ? (
        <p className="py-2 text-sm text-muted-foreground/70">
          {t("comment.empty")}
        </p>
      ) : (
        <ol className="space-y-3" data-testid="comment-list">
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
  draft: string;
  sending: boolean;
  canSend: boolean;
  onDraftChange: (value: string) => void;
  onSend: () => void;
}

function CommentComposer({
  user,
  draft,
  sending,
  canSend,
  onDraftChange,
  onSend,
}: CommentComposerProps) {
  const { t } = useI18n();
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Grow with the text like Jira; past the ceiling the textarea scrolls.
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, COMPOSER_MAX_HEIGHT)}px`;
    el.style.overflowY =
      el.scrollHeight > COMPOSER_MAX_HEIGHT ? "auto" : "hidden";
  }, [draft]);

  return (
    <div className="flex items-start gap-2.5">
      <UserAvatar
        userId={user.id}
        displayName={user.displayName}
        email={user.email}
        color={user.avatarColor}
        size="sm"
        className="mt-1 shrink-0"
      />
      <div className="min-w-0 flex-1 space-y-1">
        <Textarea
          ref={textareaRef}
          name="card-comment"
          rows={1}
          value={draft}
          maxLength={LIMITS.comment}
          placeholder={t("comment.placeholder")}
          data-testid="comment-input"
          className="min-h-9 resize-none bg-card"
          onChange={(event) => onDraftChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              onSend();
            }
            if (event.key === "Escape") onDraftChange("");
          }}
        />
        <div className="flex items-center justify-between gap-2">
          <LimitCounter
            length={draft.length}
            limit={LIMITS.comment}
            testId="comment-counter"
          />
          <Button
            size="sm"
            disabled={!canSend}
            data-testid="comment-send"
            onClick={onSend}
          >
            {sending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Send className="h-3.5 w-3.5" />
            )}
            {t("comment.send")}
          </Button>
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
      className={`flex items-start gap-2.5 text-sm ${pending ? "opacity-60" : ""}`}
      data-testid="comment"
      data-pending={pending ? "true" : undefined}
    >
      <button
        type="button"
        aria-label={t("profile.open", { name })}
        onClick={() => openProfile(comment.authorId)}
        className="mt-0.5 inline-flex shrink-0 rounded-full"
      >
        <UserAvatar
          userId={comment.authorId}
          displayName={member?.displayName ?? null}
          email={email}
          color={member?.avatarColor}
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
          {own && !readOnly && !pending ? (
            <button
              type="button"
              aria-label={t("comment.delete")}
              data-testid="comment-delete"
              className="ml-auto shrink-0 rounded-sm p-1 text-muted-foreground/60 transition-colors hover:bg-destructive/10 hover:text-destructive"
              onClick={onDelete}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </div>
        <p className="mt-0.5 whitespace-pre-wrap break-words text-foreground/90">
          {splitLinks(comment.text).map((segment, index) =>
            segment.type === "link" ? (
              <a
                key={index}
                href={segment.value}
                target="_blank"
                rel="noreferrer noopener"
                className="text-primary underline underline-offset-2"
              >
                {segment.value}
              </a>
            ) : (
              <span key={index}>{segment.value}</span>
            ),
          )}
        </p>
      </div>
    </li>
  );
}
