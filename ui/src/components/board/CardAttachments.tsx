import { createElement, useCallback, useEffect, useRef, useState } from "react";
import {
  FileArchive,
  FileAudio,
  FileImage,
  FileSpreadsheet,
  FileText,
  FileVideo,
  File as FileIcon,
  Download,
  Loader2,
  Trash2,
  Upload,
} from "lucide-react";
import type { ActivitySseEvent, AttachmentDto } from "@janosik/shared";
import { LIMITS } from "@janosik/shared";

import { api, isApiEnabled, ApiError } from "@/api/client";
import { CardSectionSkeleton } from "@/components/board/CardSectionSkeleton";
import { ConfirmDialog } from "@/components/board/ConfirmDialog";
import { CollapsibleSection } from "@/components/board/CollapsibleSection";
import { Button } from "@/components/ui/button";
import { Skeleton, SkeletonRegion } from "@/components/ui/skeleton";
import { useToast } from "@/components/Toast";
import { cn } from "@/lib/utils";
import { formatDateOnly, useI18n } from "@/i18n";
import { useAuth } from "@/auth/AuthContext";
import { useBoardLive, useBoardMember } from "@/store/board-live";
import { downloadBlob } from "@/utils/download";

/** Total attachments counted across all sizes for a compact badge. */
function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function mimeIcon(mimeType: string) {
  if (mimeType.startsWith("image/")) return FileImage;
  if (mimeType.startsWith("video/")) return FileVideo;
  if (mimeType.startsWith("audio/")) return FileAudio;
  if (/zip|compressed|tar/.test(mimeType)) return FileArchive;
  if (/sheet|excel|csv/.test(mimeType)) return FileSpreadsheet;
  if (mimeType.startsWith("text/") || mimeType === "application/json") {
    return FileText;
  }
  return FileIcon;
}

/**
 * Real thumbnail for image attachments (authenticated blob fetch → object
 * URL), the mime icon for everything else. Each row owns its URL and
 * revokes it on unmount.
 */
function AttachmentPreview({ attachment }: { attachment: AttachmentDto }) {
  const isImage = attachment.mimeType.startsWith("image/");
  const [url, setUrl] = useState<string | null>(null);
  const { t } = useI18n();

  useEffect(() => {
    if (!isImage) return;
    let alive = true;
    let created: string | null = null;
    api
      .fetchAttachmentDerivative(attachment.id, "thumbnail")
      .then((blob) => {
        if (!alive) return;
        created = URL.createObjectURL(blob);
        setUrl(created);
      })
      .catch(() => {
        /* the icon fallback stays */
      });
    return () => {
      alive = false;
      if (created !== null) URL.revokeObjectURL(created);
    };
  }, [attachment.id, isImage]);

  if (!isImage) {
    const Icon = mimeIcon(attachment.mimeType);
    return createElement(Icon, {
      className: "h-4 w-4 shrink-0 text-muted-foreground",
      "aria-hidden": true,
    });
  }
  if (url === null) {
    return (
      <Skeleton
        width={24}
        height={24}
        className="shrink-0 rounded"
        data-testid="attachment-thumbnail-skeleton"
        aria-label={t("card.attachments.title")}
      />
    );
  }
  return (
    <img
      src={url}
      alt={attachment.fileName}
      className="h-6 w-6 shrink-0 rounded border border-border object-cover"
    />
  );
}

interface CardAttachmentsProps {
  cardId: string;
  boardId: string;
  /** VIEWER mode: list + download only (TASK-35). */
  readOnly?: boolean;
  /**
   * Search deep link (TASK-177.13): opens the section, scrolls to the row and
   * highlights it. An unknown id is ignored, leaving the card as the fallback.
   */
  focusId?: string;
  /** Live attachment count for the section badge. */
  onCountChange?: (count: number) => void;
}

/**
 * Card file attachments (TASK-47) over the comments-style REST: upload with
 * a file picker, download through an authenticated blob fetch (the stream
 * endpoint needs the Authorization header), delete behind a confirmation.
 * Files added or removed by teammates arrive as `type: "activity"` SSE
 * frames (the frame carries only the id) and are re-read live.
 */
export function CardAttachments({
  cardId,
  boardId,
  readOnly = false,
  focusId,
  onCountChange,
}: CardAttachmentsProps) {
  const { t, lang } = useI18n();
  const toast = useToast();
  const { user } = useAuth();
  const me = useBoardMember(boardId, user?.id);
  const serverMode = isApiEnabled();
  const { activity } = useBoardLive();

  const [items, setItems] = useState<AttachmentDto[]>([]);
  const [detachedItems, setDetachedItems] = useState<AttachmentDto[]>([]);
  // Server-owned live total (includes inline/description media the lists
  // hide). `null` falls back to the loaded rows until the first header.
  const [totalCount, setTotalCount] = useState<number | null>(null);
  // The first response decides between an empty list and a loading list.
  const [loaded, setLoaded] = useState(!serverMode);
  const aliveRef = useRef(true);
  // A newer card/fetch supersedes an older answer; the dialog also remounts
  // this section with `key={card.id}`, so stale rows can never leak across.
  const loadGenRef = useRef(0);
  const [uploading, setUploading] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<AttachmentDto | null>(
    null,
  );
  // A detached description file is not offered in Recently deleted, so its
  // warning must not promise that recovery path.
  const [pendingDeleteDetached, setPendingDeleteDetached] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  // Search deep link (TASK-177.13): reveal the matched file once the first
  // list page lands. Row identity is read from data attributes, not spliced
  // into a selector, so a hand-edited URL is only ever an id comparison.
  // One attempt per focus id keeps later list refreshes from moving the page.
  const revealedFocusRef = useRef<string | null>(null);
  useEffect(() => {
    if (!focusId || !loaded || revealedFocusRef.current === focusId) return;
    const row = Array.from(
      listRef.current?.querySelectorAll<HTMLElement>("[data-attachment-id]") ??
        [],
    ).find((element) => element.dataset.attachmentId === focusId);
    if (!row) return;
    // Mark only a successful reveal: a later refresh can still bring the
    // target, while a found row must not be scrolled to twice.
    revealedFocusRef.current = focusId;
    row.scrollIntoView?.({ block: "center" });
    row.focus?.({ preventScroll: true });
  }, [focusId, loaded, items.length]);

  const load = useCallback(async () => {
    if (!serverMode) return;
    const gen = ++loadGenRef.current;
    const current = () => aliveRef.current && loadGenRef.current === gen;
    const [nextItems, nextDetached] = await Promise.allSettled([
      api.listAttachments(cardId),
      api.listDetachedAttachments(cardId),
    ]);
    if (!current()) return;
    // A partial failure must not throw away the half that did arrive.
    if (nextItems.status === "fulfilled") setItems(nextItems.value);
    if (nextDetached.status === "fulfilled") {
      setDetachedItems(nextDetached.value);
    } else if (nextItems.status === "fulfilled") {
      // The detached bin is supplementary: keep the main list visible and
      // report the failure without turning it into a false empty state.
      toast.error(t("card.attachments.loadError"));
    }
    if (nextItems.status === "rejected") {
      toast.error(t("card.attachments.loadError"));
    }
    const total = api.attachmentTotal(cardId);
    if (total !== undefined) {
      setTotalCount(total);
    } else if (
      nextItems.status === "fulfilled" &&
      nextDetached.status === "fulfilled"
    ) {
      setTotalCount(nextItems.value.length + nextDetached.value.length);
    }
    setLoaded(true);
  }, [cardId, serverMode, t, toast]);

  useEffect(() => {
    aliveRef.current = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the list lands after the await, not synchronously
    void load();
    return () => {
      aliveRef.current = false;
    };
  }, [load]);

  useEffect(() => {
    onCountChange?.(items.length);
  }, [items.length, onCountChange]);

  const refreshNewest = useCallback(async () => {
    if (!serverMode) return;
    try {
      const [nextItems, nextDetached] = await Promise.all([
        api.listAttachments(cardId),
        api.listDetachedAttachments(cardId),
      ]);
      setItems(nextItems);
      setDetachedItems(nextDetached);
      const total = api.attachmentTotal(cardId);
      setTotalCount(total ?? nextItems.length + nextDetached.length);
    } catch {
      /* best effort: the next open or frame retries */
    }
  }, [cardId, serverMode]);

  useEffect(() => {
    if (!serverMode) return;
    return activity.subscribe((event: ActivitySseEvent) => {
      if (
        event.boardId !== boardId ||
        (event.kind !== "comment_deleted" &&
          event.kind !== "comment_added" &&
          event.kind !== "comment_updated" &&
          event.cardId &&
          event.cardId !== cardId)
      )
        return;
      if (
        event.kind === "attachment_added" ||
        event.kind === "attachment_deleted" ||
        event.kind === "attachment_restored" ||
        event.kind === "comment_added" ||
        event.kind === "comment_deleted" ||
        event.kind === "comment_updated" ||
        // TASK-50: the background encode swapped the blob — re-read the
        // row for the new size/mime/status (the content URL is unchanged).
        event.kind === "attachment_updated"
      ) {
        void refreshNewest();
      }
    });
  }, [activity, boardId, cardId, serverMode, refreshNewest]);

  const canWrite = serverMode && !readOnly;
  const atCap =
    (totalCount ?? items.length + detachedItems.length) >=
    LIMITS.attachmentsPerCard;

  const onPick = async (file: File | undefined) => {
    if (!file || uploading) return;
    setUploading(true);
    try {
      const created = await api.uploadAttachment(cardId, file);
      setItems((prev) => [created, ...prev]);
      setTotalCount((prev) => (prev === null ? prev : prev + 1));
    } catch (error) {
      if (error instanceof ApiError && error.status === 413) {
        toast.error(t("card.attachments.tooLarge", { max: 25 }));
      } else if (
        error instanceof ApiError &&
        error.code === "attachment_limit"
      ) {
        // L20: the server's per-card cap is not a bad file type.
        setTotalCount(LIMITS.attachmentsPerCard);
        toast.error(
          t("card.attachments.atCap", { max: LIMITS.attachmentsPerCard }),
        );
      } else if (error instanceof ApiError && error.field === "file") {
        toast.error(t("card.attachments.badType"));
      } else {
        toast.error(t("card.attachments.uploadError"));
      }
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const onDownload = async (attachment: AttachmentDto) => {
    try {
      const blob = await api.fetchAttachment(attachment.id);
      // Delayed revoke so the download is not cancelled (TASK-106).
      downloadBlob(attachment.fileName, blob);
    } catch {
      toast.error(t("card.attachments.downloadError"));
    }
  };

  const onConfirmDelete = async () => {
    const target = pendingDelete;
    setPendingDelete(null);
    setPendingDeleteDetached(false);
    if (!target) return;
    try {
      await api.deleteAttachment(target.id);
      setItems((prev) => prev.filter((item) => item.id !== target.id));
      setDetachedItems((prev) => prev.filter((item) => item.id !== target.id));
      setTotalCount((prev) => (prev === null ? prev : Math.max(0, prev - 1)));
    } catch {
      toast.error(t("card.attachments.deleteError"));
    }
  };

  if (!serverMode) return null;

  return (
    <CollapsibleSection
      title={t("card.attachments.title")}
      testId="card-attachments-toggle"
      badge={items.length > 0 ? items.length : undefined}
      contentClassName="mt-1.5 space-y-1.5"
    >
      {/* Live data always wins: an SSE-added row must not be hidden by the
          initial-load skeleton. */}
      {!loaded && items.length === 0 ? (
        <SkeletonRegion
          label={t("card.attachments.loading")}
          testId="card-attachments-skeleton"
        >
          <CardSectionSkeleton kind="attachments" rows={2} />
        </SkeletonRegion>
      ) : items.length === 0 ? (
        <p
          className="px-0.5 text-xs text-muted-foreground"
          data-testid="card-attachments-empty"
        >
          {t("card.attachments.empty")}
        </p>
      ) : (
        <ul
          ref={listRef}
          className="space-y-1"
          data-testid="card-attachments-list"
        >
          {items.map((attachment) => {
            const canDelete =
              !readOnly &&
              (user?.id === attachment.uploadedById || me?.role === "ADMIN");
            const highlighted = attachment.id === focusId;
            return (
              <li
                key={attachment.id}
                className={cn(
                  "group flex items-center gap-2 rounded-md px-1.5 py-1 text-sm hover:bg-hover/60",
                  highlighted && "bg-primary/10 ring-2 ring-primary/40",
                )}
                data-testid="card-attachment-row"
                data-attachment-id={attachment.id}
                data-search-highlight={highlighted ? "true" : undefined}
                tabIndex={highlighted ? -1 : undefined}
              >
                <AttachmentPreview attachment={attachment} />
                <span
                  className="min-w-0 flex-1 truncate"
                  title={attachment.fileName}
                >
                  {attachment.fileName}
                </span>
                {attachment.transcodeStatus === "pending" ? (
                  <span
                    className="flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground"
                    data-testid="card-attachment-encoding"
                  >
                    <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                    {t("card.attachments.encoding")}
                  </span>
                ) : null}
                <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                  {formatSize(attachment.sizeBytes)}
                </span>
                <span className="hidden shrink-0 text-[11px] text-muted-foreground sm:inline">
                  {formatDateOnly(attachment.createdAt, lang)}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  aria-label={t("card.attachments.download")}
                  onClick={() => void onDownload(attachment)}
                >
                  <Download className="h-3.5 w-3.5" />
                </Button>
                {canDelete ? (
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={t("card.attachments.remove")}
                    onClick={() => {
                      setPendingDeleteDetached(false);
                      setPendingDelete(attachment);
                    }}
                    className="h-6 w-6 text-muted-foreground hover:text-danger"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {detachedItems.length > 0 && !readOnly ? (
        <details
          className="text-xs text-muted-foreground"
          data-testid="card-detached-attachments"
        >
          <summary className="cursor-pointer">
            {t("card.attachments.removedFromDescription", {
              count: detachedItems.length,
            })}
          </summary>
          <p className="mt-1">{t("card.attachments.removedHelp")}</p>
          <ul className="space-y-1">
            {detachedItems.map((attachment) => (
              <li
                key={attachment.id}
                className="flex items-center gap-2 py-1"
                data-testid="card-detached-attachment-row"
              >
                <span
                  className="min-w-0 flex-1 truncate"
                  title={attachment.fileName}
                >
                  {attachment.fileName}
                </span>
                {user?.id === attachment.uploadedById ||
                me?.role === "ADMIN" ? (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    aria-label={t("card.attachments.remove")}
                    onClick={() => {
                      setPendingDeleteDetached(true);
                      setPendingDelete(attachment);
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {canWrite ? (
        <>
          <input
            ref={fileInputRef}
            type="file"
            aria-label={t("card.attachments.upload")}
            className="hidden"
            data-testid="card-attachments-input"
            onChange={(event) => void onPick(event.target.files?.[0])}
          />
          <Button
            variant="outline"
            size="sm"
            className="w-full"
            disabled={uploading || atCap}
            data-testid="card-attachments-upload"
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload className="h-3.5 w-3.5" />
            {uploading
              ? t("card.attachments.uploading")
              : atCap
                ? t("card.attachments.atCap", {
                    max: LIMITS.attachmentsPerCard,
                  })
                : t("card.attachments.upload")}
          </Button>
        </>
      ) : null}

      <ConfirmDialog
        open={pendingDelete !== null}
        title={t("card.attachments.deleteTitle")}
        description={
          pendingDelete
            ? `${pendingDelete.fileName} — ${t(
                pendingDeleteDetached
                  ? "card.attachments.deleteDetachedWarning"
                  : "card.attachments.deleteWarning",
              )}`
            : undefined
        }
        confirmLabel={t("card.attachments.remove")}
        destructive
        onConfirm={() => void onConfirmDelete()}
        onOpenChange={(open) => {
          if (!open) {
            setPendingDelete(null);
            setPendingDeleteDetached(false);
          }
        }}
      />
    </CollapsibleSection>
  );
}
