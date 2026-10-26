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
import { ConfirmDialog } from "@/components/board/ConfirmDialog";
import { CollapsibleSection } from "@/components/board/CollapsibleSection";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/Toast";
import { formatDateOnly, useI18n } from "@/i18n";
import { useAuth } from "@/auth/AuthContext";
import { useBoardLive, useBoardMember } from "@/store/board-live";

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
      <span
        className="inline-block h-6 w-6 shrink-0 animate-pulse rounded bg-muted/50"
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
  onCountChange,
}: CardAttachmentsProps) {
  const { t, lang } = useI18n();
  const toast = useToast();
  const { user } = useAuth();
  const me = useBoardMember(boardId, user?.id);
  const serverMode = isApiEnabled();
  const { activity } = useBoardLive();

  const [items, setItems] = useState<AttachmentDto[]>([]);
  const [uploading, setUploading] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<AttachmentDto | null>(
    null,
  );
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    if (!serverMode) return;
    try {
      setItems(await api.listAttachments(cardId));
    } catch {
      toast.error(t("card.attachments.loadError"));
    }
  }, [cardId, serverMode, t, toast]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the list lands after the await, not synchronously
    void load();
  }, [load]);

  useEffect(() => {
    onCountChange?.(items.length);
  }, [items.length, onCountChange]);

  const refreshNewest = useCallback(async () => {
    if (!serverMode) return;
    try {
      setItems(await api.listAttachments(cardId));
    } catch {
      /* best effort: the next open or frame retries */
    }
  }, [cardId, serverMode]);

  useEffect(() => {
    if (!serverMode) return;
    return activity.subscribe((event: ActivitySseEvent) => {
      if (event.boardId !== boardId || event.cardId !== cardId) return;
      if (
        event.kind === "attachment_added" ||
        event.kind === "attachment_deleted" ||
        // TASK-50: the background encode swapped the blob — re-read the
        // row for the new size/mime/status (the content URL is unchanged).
        event.kind === "attachment_updated"
      ) {
        void refreshNewest();
      }
    });
  }, [activity, boardId, cardId, serverMode, refreshNewest]);

  const canWrite = serverMode && !readOnly;
  const atCap = items.length >= LIMITS.attachmentsPerCard;

  const onPick = async (file: File | undefined) => {
    if (!file || uploading) return;
    setUploading(true);
    try {
      const created = await api.uploadAttachment(cardId, file);
      setItems((prev) => [created, ...prev]);
    } catch (error) {
      if (error instanceof ApiError && error.status === 413) {
        toast.error(t("card.attachments.tooLarge", { max: 25 }));
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
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = attachment.fileName;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error(t("card.attachments.downloadError"));
    }
  };

  const onConfirmDelete = async () => {
    const target = pendingDelete;
    setPendingDelete(null);
    if (!target) return;
    try {
      await api.deleteAttachment(target.id);
      setItems((prev) => prev.filter((item) => item.id !== target.id));
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
      {items.length === 0 ? (
        <p
          className="px-0.5 text-xs text-muted-foreground"
          data-testid="card-attachments-empty"
        >
          {t("card.attachments.empty")}
        </p>
      ) : (
        <ul className="space-y-1" data-testid="card-attachments-list">
          {items.map((attachment) => {
            const canDelete =
              !readOnly &&
              (user?.id === attachment.uploadedById || me?.role === "ADMIN");
            return (
              <li
                key={attachment.id}
                className="group flex items-center gap-2 rounded-md px-1.5 py-1 text-sm hover:bg-hover/60"
                data-testid="card-attachment-row"
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
                <span className="hidden shrink-0 text-[11px] text-muted-foreground/70 sm:inline">
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
                    onClick={() => setPendingDelete(attachment)}
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

      {canWrite ? (
        <>
          <input
            ref={fileInputRef}
            type="file"
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
        description={pendingDelete?.fileName}
        confirmLabel={t("card.attachments.remove")}
        destructive
        onConfirm={() => void onConfirmDelete()}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
      />
    </CollapsibleSection>
  );
}
