import {
  createElement,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  Check,
  Copy,
  FileArchive,
  FileAudio,
  FileImage,
  FileSpreadsheet,
  FileText,
  FileVideo,
  File as FileIcon,
  Download,
  Loader2,
  RotateCcw,
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
import { formatDateOnly, useI18n, type MessageKey } from "@/i18n";
import { useAuth } from "@/auth/AuthContext";
import { useBoardLive, useBoardMember } from "@/store/board-live";
import { downloadBlob } from "@/utils/download";
import { attachmentContentUrl } from "@/utils/embedAttachments";

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

/** Screen-reader label for the type glyph (the glyph itself is decorative). */
function mimeLabelKey(mimeType: string): MessageKey {
  if (mimeType.startsWith("image/")) return "card.attachments.typeImage";
  if (mimeType.startsWith("video/")) return "card.attachments.typeVideo";
  if (mimeType.startsWith("audio/")) return "card.attachments.typeAudio";
  if (/zip|compressed|tar/.test(mimeType)) {
    return "card.attachments.typeArchive";
  }
  if (/sheet|excel|csv/.test(mimeType)) {
    return "card.attachments.typeSpreadsheet";
  }
  if (mimeType.startsWith("text/") || mimeType === "application/json") {
    return "card.attachments.typeText";
  }
  return "card.attachments.typeFile";
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
    return (
      <>
        {createElement(Icon, {
          className: "h-4 w-4 shrink-0 text-muted-foreground",
          "aria-hidden": true,
        })}
        <span className="sr-only">{t(mimeLabelKey(attachment.mimeType))}</span>
      </>
    );
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
    <>
      <img
        src={url}
        alt={attachment.fileName}
        className="h-6 w-6 shrink-0 rounded border border-border object-cover"
      />
      <span className="sr-only">{t("card.attachments.typeImage")}</span>
    </>
  );
}

/** Outcome of the parent's append-to-description attempt (TASK-177.9). */
export type RestoreAttachmentOutcome =
  | { ok: true; alreadyReferenced?: true }
  | { ok: false; reason: "conflict" | "limit" | "error" | "stale" };

/** Where focus came from and where it may go after a detached-row action. */
interface BinFocusTarget {
  section: HTMLElement | null;
  row: HTMLElement | null;
  nextRow: HTMLElement | null;
  prevRow: HTMLElement | null;
  /** The acted-on row owned focus when the action started. */
  hadFocus: boolean;
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
  /**
   * TASK-177.9 (G-13): append the file's inline markdown to the description.
   * The card dialog owns the description draft/conflict state, so it performs
   * the save through the normal `UPDATE_CARD` path; the server then clears
   * `descriptionDetached` and the file returns to the normal list.
   */
  onRestoreToDescription?: (
    attachment: AttachmentDto,
  ) => RestoreAttachmentOutcome | Promise<RestoreAttachmentOutcome>;
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
  onRestoreToDescription,
}: CardAttachmentsProps) {
  const { t, lang } = useI18n();
  const toast = useToast();
  const { user } = useAuth();
  const me = useBoardMember(boardId, user?.id);
  const serverMode = isApiEnabled();
  const { activity } = useBoardLive();

  const [items, setItems] = useState<AttachmentDto[]>([]);
  const [detachedItems, setDetachedItems] = useState<AttachmentDto[]>([]);
  // Detached-bin actions are per row; one restore at a time is enough.
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (copiedTimerRef.current !== null) clearTimeout(copiedTimerRef.current);
    },
    [],
  );
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
  const detachedRef = useRef<HTMLDetailsElement>(null);
  const detachedListRef = useRef<HTMLUListElement>(null);
  // The section is keyed by card upstream; keep a live id so an answer for
  // the previous card can never mutate this instance.
  const cardIdRef = useRef(cardId);
  useEffect(() => {
    cardIdRef.current = cardId;
  }, [cardId]);
  // The bin re-check awaits the network; by then CardDialog may have
  // re-rendered with a newer description/draft/conflict state. Call the
  // latest callback, never the one captured at click time.
  const onRestoreRef = useRef(onRestoreToDescription);
  useLayoutEffect(() => {
    onRestoreRef.current = onRestoreToDescription;
  }, [onRestoreToDescription]);
  const pendingDeleteFocusRef = useRef<BinFocusTarget | null>(null);

  /**
   * After an action, hand focus on only if the acted-on row owned focus when
   * the action started. Chrome moves focus to the dialog container when the
   * row unmounts, so that fallback counts as "lost", not as a user move.
   * Prefer the next sibling row's restore action, then the previous sibling,
   * then the bin summary, then the section header.
   */
  const focusAfterBinChange = (target: BinFocusTarget) => {
    if (target.row === null || !target.hadFocus) return;
    window.requestAnimationFrame(() => {
      if (!aliveRef.current) return;
      const active = document.activeElement;
      const row = target.row!;
      // Only the dialog that owns this section may count as the post-unmount
      // fallback. A label picker, confirm or another dialog opened while the
      // request was pending owns focus and must keep it.
      const ownerDialog =
        target.section?.closest<HTMLElement>('[role="dialog"]') ?? null;
      const openDialogs = ownerDialog
        ? Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"]'))
        : [];
      const ownerIsTop =
        ownerDialog !== null &&
        openDialogs[openDialogs.length - 1] === ownerDialog;
      const activeDialog =
        active instanceof HTMLElement
          ? active.closest<HTMLElement>('[role="dialog"]')
          : null;
      const dialogFallback =
        ownerIsTop &&
        active instanceof HTMLElement &&
        (active === ownerDialog ||
          activeDialog === ownerDialog ||
          active.hasAttribute("data-radix-focus-guard"));
      // A real control outside the row owns focus: don't steal it.
      const userMoved =
        active instanceof HTMLElement &&
        active !== document.body &&
        !dialogFallback &&
        !row.contains(active);
      if (userMoved) return;
      if (row.isConnected) {
        row
          .querySelector<HTMLElement>('[data-testid="card-attachment-restore"]')
          ?.focus();
        return;
      }
      for (const sibling of [target.nextRow, target.prevRow]) {
        if (sibling?.isConnected !== true) continue;
        const restore = sibling.querySelector<HTMLElement>(
          '[data-testid="card-attachment-restore"]',
        );
        if (restore) {
          restore.focus();
          return;
        }
      }
      const summary = target.section?.querySelector<HTMLElement>("summary");
      if (summary) {
        summary.focus();
        if (document.activeElement === summary) return;
      }
      target.section
        ?.querySelector<HTMLElement>('[data-testid="card-attachments-toggle"]')
        ?.focus();
    });
  };
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

  /**
   * TASK-177.9: a detached file stays downloadable and linkable without
   * re-embedding it. The copied content URL is an authenticated in-app
   * attachment reference meant to be pasted into a description or comment,
   * not a public share link.
   */
  const onCopyUrl = async (attachment: AttachmentDto) => {
    try {
      if (!navigator.clipboard) throw new Error("clipboard unavailable");
      const url = new URL(
        attachmentContentUrl(attachment.id),
        window.location.origin,
      ).href;
      await navigator.clipboard.writeText(url);
      setCopiedId(attachment.id);
      if (copiedTimerRef.current !== null) clearTimeout(copiedTimerRef.current);
      copiedTimerRef.current = setTimeout(() => setCopiedId(null), 2000);
      toast.success(t("card.attachments.urlCopied"));
    } catch {
      toast.error(t("card.attachments.urlCopyError"));
    }
  };

  const onRestore = async (
    attachment: AttachmentDto,
    trigger?: HTMLElement,
  ) => {
    const restore = onRestoreRef.current;
    if (restore === undefined || restoringId !== null) return;
    const row =
      trigger?.closest<HTMLElement>(
        '[data-testid="card-detached-attachment-row"]',
      ) ?? null;
    const nextRow = (row?.nextElementSibling as HTMLElement | null) ?? null;
    const prevRow = (row?.previousElementSibling as HTMLElement | null) ?? null;
    const section =
      row?.closest("section") ??
      detachedRef.current?.closest("section") ??
      null;
    // Capture focus ownership before the row or its disabled button can move
    // it: Chrome falls back to the dialog container, not <body>.
    const activeAtStart = document.activeElement;
    const hadFocus =
      row !== null &&
      (row.contains(activeAtStart) ||
        activeAtStart === trigger ||
        activeAtStart === document.body);
    const focusTarget: BinFocusTarget = {
      section,
      row,
      nextRow,
      prevRow,
      hadFocus,
    };
    const targetCardId = cardId;
    const stillCurrent = () =>
      aliveRef.current && cardIdRef.current === targetCardId;
    setRestoringId(attachment.id);
    try {
      // Re-read the bin first: a file deleted in another tab (or by another
      // member) is no longer restorable, and its old markdown would only
      // leave a dead link in the description.
      const fresh = await api.listDetachedAttachments(cardId);
      // The card may have changed while the bin was loading. Never call a
      // callback that closes over the old card's draft.
      if (!stillCurrent()) return;
      setDetachedItems(fresh);
      const latest = onRestoreRef.current;
      if (latest === undefined) return;
      if (!fresh.some((item) => item.id === attachment.id)) {
        await refreshNewest();
        if (!stillCurrent()) return;
        toast.error(t("card.attachments.restoreUnavailable"));
        focusAfterBinChange(focusTarget);
        return;
      }
      const outcome = await latest(attachment);
      if (!stillCurrent()) return;
      if (!outcome.ok) {
        if (outcome.reason !== "stale") {
          toast.error(
            t(
              outcome.reason === "conflict"
                ? "card.attachments.restoreConflict"
                : outcome.reason === "limit"
                  ? "card.attachments.restoreLimit"
                  : "card.attachments.restoreError",
            ),
          );
        }
        // The save may have been refused after the optimistic edit: re-read
        // both lists so the bin and the normal list match the server again.
        await refreshNewest();
        if (!stillCurrent()) return;
        focusAfterBinChange(focusTarget);
        return;
      }
      if (outcome.alreadyReferenced === true) {
        toast.info(t("card.attachments.alreadyReferenced"));
        await refreshNewest();
        if (!stillCurrent()) return;
        focusAfterBinChange(focusTarget);
        return;
      }
      setDetachedItems((prev) =>
        prev.filter((item) => item.id !== attachment.id),
      );
      // The server list is newest-first by upload date; the restored file
      // keeps its original date, so keep that order rather than prepending.
      setItems((prev) =>
        prev.some((item) => item.id === attachment.id)
          ? prev
          : [...prev, attachment].sort((a, b) => b.createdAt - a.createdAt),
      );
      toast.success(
        t("card.attachments.restored", { name: attachment.fileName }),
      );
      focusAfterBinChange(focusTarget);
    } catch (error) {
      if (!stillCurrent()) return;
      await refreshNewest();
      if (!stillCurrent()) return;
      if (
        error instanceof ApiError &&
        (error.status === 404 || error.status === 410)
      ) {
        toast.error(t("card.attachments.restoreUnavailable"));
      } else {
        toast.error(t("card.attachments.restoreError"));
      }
      focusAfterBinChange(focusTarget);
    } finally {
      // Also clears a stale busy row if the same mounted section was
      // repointed at another card before the answer arrived.
      setRestoringId(null);
    }
  };

  const onConfirmDelete = async () => {
    const target = pendingDelete;
    const focusTarget = pendingDeleteFocusRef.current;
    pendingDeleteFocusRef.current = null;
    setPendingDelete(null);
    setPendingDeleteDetached(false);
    if (!target) return;
    try {
      await api.deleteAttachment(target.id);
      setItems((prev) => prev.filter((item) => item.id !== target.id));
      setDetachedItems((prev) => prev.filter((item) => item.id !== target.id));
      setTotalCount((prev) => (prev === null ? prev : Math.max(0, prev - 1)));
      if (focusTarget !== null) {
        focusAfterBinChange(focusTarget);
      }
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

      {detachedItems.length > 0 ? (
        <details
          ref={detachedRef}
          className="text-xs text-muted-foreground"
          data-testid="card-detached-attachments"
        >
          <summary className="min-h-11 cursor-pointer py-3">
            {t("card.attachments.removedFromDescription", {
              count: detachedItems.length,
            })}
          </summary>
          <p className="mt-1">
            {t(
              readOnly
                ? "card.attachments.removedHelpReadOnly"
                : "card.attachments.removedHelp",
            )}
          </p>
          <ul ref={detachedListRef} className="space-y-1">
            {detachedItems.map((attachment) => {
              const canRestore =
                canWrite && onRestoreToDescription !== undefined;
              const canDelete =
                !readOnly &&
                (user?.id === attachment.uploadedById || me?.role === "ADMIN");
              const restoring = restoringId === attachment.id;
              return (
                <li
                  key={attachment.id}
                  className="flex flex-wrap items-center gap-2 py-1 max-lg:gap-y-1"
                  data-testid="card-detached-attachment-row"
                >
                  <div className="flex min-w-0 flex-1 items-center gap-2">
                    <AttachmentPreview attachment={attachment} />
                    <div className="min-w-0 flex-1">
                      <span
                        className="line-clamp-2 break-words"
                        title={attachment.fileName}
                        data-testid="card-detached-file-name"
                      >
                        {attachment.fileName}
                      </span>
                      <span className="block text-[11px] tabular-nums">
                        {formatSize(attachment.sizeBytes)} ·{" "}
                        {formatDateOnly(attachment.createdAt, lang)}
                      </span>
                    </div>
                  </div>
                  <div
                    className="flex shrink-0 items-center gap-0.5 max-lg:w-full max-lg:justify-end"
                    data-testid="card-detached-actions"
                  >
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 max-lg:h-11 max-lg:w-11"
                      aria-label={t("card.attachments.downloadNamed", {
                        name: attachment.fileName,
                      })}
                      title={t("card.attachments.downloadNamed", {
                        name: attachment.fileName,
                      })}
                      onClick={() => void onDownload(attachment)}
                    >
                      <Download className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 max-lg:h-11 max-lg:w-11"
                      aria-label={t("card.attachments.copyReferenceNamed", {
                        name: attachment.fileName,
                      })}
                      title={t("card.attachments.copyReferenceNamed", {
                        name: attachment.fileName,
                      })}
                      onClick={() => void onCopyUrl(attachment)}
                    >
                      {copiedId === attachment.id ? (
                        <Check className="h-3.5 w-3.5 text-primary" />
                      ) : (
                        <Copy className="h-3.5 w-3.5" />
                      )}
                    </Button>
                    {canRestore ? (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 max-lg:h-11 max-lg:w-11"
                        aria-label={t("card.attachments.restoreNamed", {
                          name: attachment.fileName,
                        })}
                        title={t("card.attachments.restoreNamed", {
                          name: attachment.fileName,
                        })}
                        aria-busy={restoring}
                        disabled={restoringId !== null}
                        onClick={(event) =>
                          void onRestore(attachment, event.currentTarget)
                        }
                        data-testid="card-attachment-restore"
                      >
                        {restoring ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <RotateCcw className="h-3.5 w-3.5" />
                        )}
                      </Button>
                    ) : null}
                    {canDelete ? (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 max-lg:h-11 max-lg:w-11 text-muted-foreground hover:text-danger"
                        aria-label={t("card.attachments.removeNamed", {
                          name: attachment.fileName,
                        })}
                        title={t("card.attachments.removeNamed", {
                          name: attachment.fileName,
                        })}
                        onClick={(event) => {
                          const row = event.currentTarget.closest<HTMLElement>(
                            '[data-testid="card-detached-attachment-row"]',
                          );
                          const activeAtClick = document.activeElement;
                          pendingDeleteFocusRef.current = {
                            row,
                            nextRow:
                              (row?.nextElementSibling as HTMLElement | null) ??
                              null,
                            prevRow:
                              (row?.previousElementSibling as HTMLElement | null) ??
                              null,
                            section: row?.closest("section") ?? null,
                            hadFocus:
                              row !== null &&
                              (row.contains(activeAtClick) ||
                                activeAtClick === document.body),
                          };
                          setPendingDeleteDetached(true);
                          setPendingDelete(attachment);
                        }}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    ) : null}
                  </div>
                </li>
              );
            })}
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
            pendingDeleteFocusRef.current = null;
            setPendingDelete(null);
            setPendingDeleteDetached(false);
          }
        }}
      />
    </CollapsibleSection>
  );
}
