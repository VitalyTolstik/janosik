import { useCallback, useEffect, useRef, useState } from "react";
import {
  Check,
  ChevronDown,
  Copy,
  Link2,
  Pencil,
  RefreshCw,
  Trash2,
  X,
} from "lucide-react";

import type {
  BoardShareDto,
  BoardShareMode,
  CreateShareRequest,
  UpdateShareRequest,
} from "@janosik/shared";
import { SHARE_LIMITS, SHARE_TTL_HOURS } from "@janosik/shared";
import { api, ApiError, isApiEnabled } from "@/api/client";
import { appShareUrl } from "@/utils/app-path";
import { useToast } from "@/components/Toast";
import { ConfirmDialog } from "@/components/board/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { LazyAnimatedIcon } from "@/components/ui/lazy-animated-icon";
import { Skeleton, SkeletonRegion } from "@/components/ui/skeleton";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import { useBoard } from "@/store/BoardContext";

/**
 * «Поделиться» dialog (TASK-58, §7.9.4): a board ADMIN mints public
 * read-only links — a frozen snapshot or a live view — with a TTL and the
 * comment/attachment flags, copies the link (or an `<iframe>` embed snippet),
 * refreshes a snapshot and revokes any link. The panel is mounted only while
 * open, so every open refetches the list (no imperative reset).
 */
export function ShareDialog() {
  const { t } = useI18n();
  const { board, roleOf } = useBoard();
  const [open, setOpen] = useState(false);
  // M4: `ALLOW_PUBLIC_SHARES=false` must hide the entry point, not only make
  // the minted token 404. `null` = config not read yet, so the trigger does
  // not flash before the answer; a failed read keeps the control visible (the
  // server still refuses creation independently).
  const [publicSharesEnabled, setPublicSharesEnabled] = useState<
    boolean | null
  >(() => (isApiEnabled() ? null : true));

  useEffect(() => {
    if (!isApiEnabled()) return;
    let alive = true;
    void api
      .authConfig()
      .then((config) => {
        if (alive) setPublicSharesEnabled(config.allowPublicShares);
      })
      .catch(() => {
        if (alive) setPublicSharesEnabled(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  if (
    !isApiEnabled() ||
    !board ||
    roleOf(board.id) !== "ADMIN" ||
    publicSharesEnabled !== true
  )
    return null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <DialogTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              aria-label={t("share.button")}
              data-testid="share-trigger"
            >
              <LazyAnimatedIcon name="external-link" size={18} aria-hidden />
            </Button>
          </DialogTrigger>
        </TooltipTrigger>
        <TooltipContent>{t("share.button")}</TooltipContent>
      </Tooltip>
      <DialogContent className="h-[min(800px,calc(100dvh-2rem))] max-w-lg overflow-hidden">
        <DialogHeader>
          <DialogTitle>{t("share.title")}</DialogTitle>
          <DialogDescription>{t("share.description")}</DialogDescription>
        </DialogHeader>
        {open ? <SharePanel boardId={board.id} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function shareLink(token: string): string {
  return appShareUrl(routesShare(token));
}

function routesShare(token: string): string {
  return `/s/${token}`;
}

type EmbedTheme = "system" | "light" | "dark";

/** Edit-mode TTL sentinel: omit `expiresAt` from PATCH and keep the deadline. */
const KEEP_EXPIRY = -1;

function buildEmbed(token: string, theme: EmbedTheme): string {
  return `<iframe src="${appShareUrl(`/s/${token}?embed=1&theme=${theme}`)}" width="100%" height="600" style="border:0" loading="lazy" title="Janosik board"></iframe>`;
}

function SharePanel({ boardId }: { boardId: string }) {
  const { t } = useI18n();
  const toast = useToast();
  const [shares, setShares] = useState<BoardShareDto[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<BoardShareDto | null>(null);
  const [updating, setUpdating] = useState(false);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [mode, setMode] = useState<BoardShareMode>("live");
  const [now, setNow] = useState(() => Date.now());
  const editButtons = useRef(new Map<string, HTMLButtonElement>());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const registerEditButton = useCallback(
    (shareId: string, node: HTMLButtonElement | null) => {
      if (node) editButtons.current.set(shareId, node);
      else editButtons.current.delete(shareId);
    },
    [],
  );

  /** Return focus after the edit form unmounts, not while it still owns it. */
  const focusEditButton = useCallback((shareId: string) => {
    window.setTimeout(() => editButtons.current.get(shareId)?.focus(), 0);
  }, []);

  const load = useCallback(async () => {
    try {
      setShares(await api.listShares(boardId));
    } catch {
      toast.error(t("share.loadError"));
      setShares([]);
    }
  }, [boardId, toast, t]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the list lands after the await, not synchronously
    void load();
  }, [load]);

  return (
    <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
      <ShareForm
        key={editing?.id ?? "create"}
        busy={editing ? updating : creating}
        shares={shares}
        now={now}
        mode={mode}
        editing={editing}
        error={editing ? updateError : null}
        onModeChange={setMode}
        onCancel={() => {
          const shareId = editing?.id;
          setEditing(null);
          setUpdateError(null);
          if (shareId) focusEditButton(shareId);
        }}
        onCreate={async (request) => {
          setCreating(true);
          try {
            const created = await api.createShare(boardId, request);
            // A refused clipboard is not a created-and-copied success: the
            // user would walk away without the link. Keep the row (it is in
            // the list) and say exactly what failed.
            if (await copy(shareLink(created.token))) {
              toast.success(t("share.created"));
            } else {
              toast.error(t("share.copyError"));
            }
            await load();
          } catch (error) {
            toast.error(
              error instanceof ApiError && error.status === 409
                ? t("share.limitReached")
                : error instanceof ApiError && error.offline
                  ? t("share.offline")
                  : t("share.actionError"),
            );
            if (error instanceof ApiError && error.status === 409) await load();
          } finally {
            setCreating(false);
          }
        }}
        onUpdate={async (request) => {
          if (!editing) return;
          const shareId = editing.id;
          setUpdating(true);
          setUpdateError(null);
          try {
            await api.updateShare(boardId, shareId, request);
            toast.success(t("share.editSaved"));
            setEditing(null);
            await load();
            focusEditButton(shareId);
          } catch (error) {
            // The form stays open with the user's values, so the error is
            // shown inline as well as in the toast (TASK-177.1).
            const message =
              error instanceof ApiError && error.status === 409
                ? t("share.limitReached")
                : error instanceof ApiError && error.offline
                  ? t("share.offline")
                  : t("share.editError");
            setUpdateError(message);
            toast.error(message);
          } finally {
            setUpdating(false);
          }
        }}
      />

      <div className="space-y-2" aria-busy={shares === null}>
        <p className="text-xs font-medium uppercase text-muted-foreground">
          {t("share.active")}
        </p>
        {shares === null ? (
          <SkeletonRegion
            label={t("share.loading")}
            testId="share-list-skeleton"
            delayMs={150}
          >
            <ShareListSkeleton />
          </SkeletonRegion>
        ) : !shares.some((share) => share.mode === mode) ? (
          <p className="text-sm text-muted-foreground">{t("share.empty")}</p>
        ) : (
          <ul className="space-y-2" data-testid="share-list">
            {shares
              .filter((share) => share.mode === mode)
              .map((share) => (
                <ShareRow
                  key={share.id}
                  share={share}
                  boardId={boardId}
                  now={now}
                  onChanged={load}
                  registerEditButton={registerEditButton}
                  onEdit={(target) => {
                    setUpdateError(null);
                    setEditing(target);
                    setMode(target.mode);
                  }}
                />
              ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/** Two active-link rows, 76 px each — the real `ShareRow` rhythm. */
function ShareListSkeleton() {
  return (
    <div className="space-y-2" aria-hidden="true">
      {[0, 1].map((index) => (
        <div key={index} className="h-[76px] space-y-2 rounded-md border p-2">
          <div className="flex items-center gap-2">
            <Skeleton width={48} height={16} className="rounded" />
            <Skeleton width={120} height={12} />
            <div className="ml-auto flex items-center gap-1">
              <Skeleton width={24} height={24} className="rounded-md" />
              <Skeleton width={24} height={24} className="rounded-md" />
            </div>
          </div>
          <Skeleton width={180} height={10} />
          <Skeleton width={140} height={10} />
        </div>
      ))}
    </div>
  );
}

function ShareRow({
  share,
  boardId,
  onChanged,
  onEdit,
  registerEditButton,
  now,
}: {
  share: BoardShareDto;
  boardId: string;
  onChanged: () => Promise<void>;
  onEdit: (share: BoardShareDto) => void;
  registerEditButton: (shareId: string, node: HTMLButtonElement | null) => void;
  now: number;
}) {
  const { t } = useI18n();
  const toast = useToast();
  const revoked = share.revokedAt !== null;
  const expired = share.expiresAt !== null && share.expiresAt <= now;
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  return (
    <li
      className="space-y-2 rounded-md border p-2 text-sm"
      data-testid="share-row"
    >
      <div className="flex items-center gap-2">
        <span className="rounded bg-muted px-1.5 py-0.5 text-xs font-medium">
          {share.mode === "live"
            ? t("share.mode.live")
            : t("share.mode.snapshot")}
        </span>
        <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">
          /s/{share.token}
        </span>
        {revoked || expired ? (
          <span className="text-xs text-destructive">
            {revoked ? t("share.revoked") : t("share.expired")}
          </span>
        ) : null}
        {revoked &&
          (confirmDelete ? (
            <div className="flex shrink-0 items-center gap-0.5">
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 text-success hover:text-success"
                aria-label={t("share.deleteConfirm")}
                disabled={deleting}
                onClick={async () => {
                  setDeleting(true);
                  try {
                    await api.deleteRevokedShare(boardId, share.id);
                    await onChanged();
                  } catch {
                    toast.error(t("share.actionError"));
                    setDeleting(false);
                  }
                }}
              >
                <Check className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 text-muted-foreground"
                aria-label={t("share.deleteCancel")}
                disabled={deleting}
                onClick={() => setConfirmDelete(false)}
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          ) : (
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 text-muted-foreground hover:text-destructive"
              aria-label={t("share.delete")}
              onClick={() => setConfirmDelete(true)}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          ))}
      </div>
      {share.title && (
        <p className="truncate font-medium" title={share.title}>
          {share.title}
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        {share.expiresAt === null
          ? t("share.expiresNever")
          : t("share.expiresAt", {
              date: new Date(share.expiresAt).toLocaleString(),
            })}
      </p>

      <div className="flex flex-wrap items-center gap-1">
        {!revoked ? (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1 px-2 text-xs"
            ref={(node) => registerEditButton(share.id, node)}
            aria-label={t("share.editAria", {
              label: share.title
                ? `${share.title} (${share.token})`
                : share.token,
            })}
            onClick={() => onEdit(share)}
          >
            <Pencil className="h-3.5 w-3.5" aria-hidden />
            {t("share.edit")}
          </Button>
        ) : null}
        {!revoked && !expired ? (
          <>
            <Button
              variant="outline"
              size="sm"
              className="h-7 gap-1 px-2 text-xs"
              onClick={async () => {
                if (await copy(shareLink(share.token))) {
                  toast.success(t("share.copied"));
                } else {
                  toast.error(t("share.copyError"));
                }
              }}
            >
              <Copy className="h-3.5 w-3.5" aria-hidden />
              {t("share.copy")}
            </Button>
            <EmbedPicker token={share.token} />
            {share.mode === "snapshot" ? (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 gap-1 px-2 text-xs"
                onClick={async () => {
                  try {
                    await api.refreshShare(boardId, share.id);
                    toast.success(t("share.refreshed"));
                    await onChanged();
                  } catch {
                    toast.error(t("share.actionError"));
                  }
                }}
              >
                <RefreshCw className="h-3.5 w-3.5" aria-hidden />
                {t("share.refresh")}
              </Button>
            ) : null}
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1 px-2 text-xs text-destructive"
              onClick={async () => {
                try {
                  await api.revokeShare(boardId, share.id);
                  toast.success(t("share.revokeDone"));
                  await onChanged();
                } catch {
                  toast.error(t("share.actionError"));
                }
              }}
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden />
              {t("share.revoke")}
            </Button>
          </>
        ) : null}
      </div>

      <p className="text-xs text-muted-foreground">
        {t("share.meta", {
          views: share.views,
          flags: [
            (share.effectiveIncludeComments ?? share.includeComments)
              ? t("share.visible.comments")
              : null,
            (share.effectiveIncludeAttachments ?? share.includeAttachments)
              ? t("share.visible.attachments")
              : null,
          ]
            .filter(Boolean)
            .join(" · "),
        })}
      </p>
      {((share.includeComments && share.effectiveIncludeComments === false) ||
        (share.includeAttachments &&
          share.effectiveIncludeAttachments === false)) && (
        <p className="text-xs text-muted-foreground">
          {t("share.refreshRequired")}
        </p>
      )}
    </li>
  );
}

function EmbedPicker({ token }: { token: string }) {
  const { t } = useI18n();
  const toast = useToast();
  const [theme, setTheme] = useState<EmbedTheme>("system");
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs">
          <Link2 className="h-3.5 w-3.5" aria-hidden />
          {t("share.embed")}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 space-y-3 p-3">
        <div className="space-y-1">
          <p className="text-sm font-medium">{t("share.embedTheme.title")}</p>
          <p className="text-xs text-muted-foreground">
            {t("share.embedTheme.hint")}
          </p>
        </div>
        <div
          role="radiogroup"
          aria-label={t("share.embedTheme.title")}
          className="space-y-1"
        >
          {(["system", "light", "dark"] as const).map((option) => (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={theme === option}
              onClick={() => setTheme(option)}
              className={cn(
                "flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm hover:bg-hover",
                theme === option && "bg-muted font-medium",
              )}
            >
              {t(`share.embedTheme.${option}`)}
              {theme === option && (
                <Check className="h-4 w-4 text-primary" aria-hidden />
              )}
            </button>
          ))}
        </div>
        <Button
          size="sm"
          className="w-full gap-2"
          onClick={async () => {
            if (await copy(buildEmbed(token, theme))) {
              toast.success(t("share.embedTheme.copied"));
              setOpen(false);
            } else {
              toast.error(t("share.embedTheme.copyError"));
            }
          }}
        >
          <Copy className="h-3.5 w-3.5" aria-hidden />
          {t("share.embedTheme.copy")}
        </Button>
      </PopoverContent>
    </Popover>
  );
}

/**
 * Link-lifetime picker: an outline trigger opening a popover of radio rows
 * with the project's check-mark idiom (BoardMembersDialog's RolePicker) —
 * a native `<select>` renders as a black browser control in the dark theme
 * and cannot be styled to match the dialog.
 *
 * In edit mode `allowKeep` adds a "keep current expiry" row so changing a
 * title or a flag never silently re-bases the deadline (TASK-177.1).
 */
function TtlPicker({
  value,
  onChange,
  allowKeep = false,
}: {
  value: number;
  onChange: (value: number) => void;
  allowKeep?: boolean;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);

  const label = (hours: number) =>
    hours === KEEP_EXPIRY
      ? t("share.ttl.keep")
      : hours === 0
        ? t("share.ttl.never")
        : t("share.ttl.hours", { count: hours });
  const options = allowKeep
    ? [KEEP_EXPIRY, 0, ...SHARE_TTL_HOURS]
    : [0, ...SHARE_TTL_HOURS];

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          aria-label={t("share.ttl.label")}
          data-testid="share-ttl"
          className="h-8 min-w-[5.5rem] justify-between gap-1.5 px-2 font-normal"
        >
          {label(value)}
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-40 p-1">
        <div role="radiogroup" aria-label={t("share.ttl.label")}>
          {options.map((hours) => (
            <button
              key={hours}
              type="button"
              role="radio"
              aria-checked={hours === value}
              data-testid="share-ttl-option"
              onClick={() => {
                setOpen(false);
                onChange(hours);
              }}
              className={cn(
                "flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-hover",
                hours === value
                  ? "font-medium text-foreground"
                  : "text-foreground/90",
              )}
            >
              {label(hours)}
              {hours === value && (
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
 * Create and edit share form (TASK-58, TASK-177.1). Edit mode locks the
 * mode/token (they live in the URL and on the public page), seeds the form
 * from the row and PATCHes only the mutable fields. A privacy change on a
 * live link goes through a confirmation before the request.
 */
function ShareForm({
  busy,
  shares,
  now,
  mode,
  editing,
  error,
  onModeChange,
  onCancel,
  onCreate,
  onUpdate,
}: {
  busy: boolean;
  shares: BoardShareDto[] | null;
  now: number;
  mode: BoardShareMode;
  editing: BoardShareDto | null;
  error: string | null;
  onModeChange: (mode: BoardShareMode) => void;
  onCancel: () => void;
  onCreate: (request: CreateShareRequest) => Promise<void>;
  onUpdate: (request: UpdateShareRequest) => Promise<void>;
}) {
  const { t } = useI18n();
  const titleInput = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState(editing?.title ?? "");
  const [includeComments, setIncludeComments] = useState<boolean>(
    editing
      ? editing.includeComments
      : mode === "snapshot"
        ? SHARE_LIMITS.defaultIncludeCommentsSnapshot
        : SHARE_LIMITS.defaultIncludeCommentsLive,
  );
  const [includeAttachments, setIncludeAttachments] = useState(
    editing ? editing.includeAttachments : false,
  );
  const [ttlHours, setTtlHours] = useState<number>(
    editing
      ? editing.expiresAt === null
        ? 0
        : KEEP_EXPIRY
      : SHARE_TTL_HOURS[1],
  );
  const [ttlTouched, setTtlTouched] = useState(false);
  const [pendingUpdate, setPendingUpdate] = useState<UpdateShareRequest | null>(
    null,
  );

  useEffect(() => {
    if (editing) titleInput.current?.focus();
  }, [editing]);

  const active = (shares ?? []).filter(
    (share) =>
      !share.revokedAt && (share.expiresAt === null || share.expiresAt > now),
  );
  const count = active.filter((share) => share.mode === mode).length;
  const limit = SHARE_LIMITS.activePerBoard[mode];
  const similar = editing
    ? undefined
    : active.find(
        (share) =>
          share.mode === mode &&
          (share.title ?? "") === title.trim() &&
          share.includeComments === includeComments &&
          share.includeAttachments === includeAttachments &&
          (ttlHours === 0
            ? share.expiresAt === null
            : share.expiresAt !== null &&
              Math.abs(
                share.expiresAt - share.createdAt - ttlHours * 3_600_000,
              ) < 60_000),
      );

  const submit = () => {
    if (editing) {
      const request: UpdateShareRequest = {
        title: title.trim() === "" ? null : title.trim(),
        includeComments,
        includeAttachments,
      };
      if (ttlTouched && ttlHours !== KEEP_EXPIRY) {
        request.expiresAt = expiryFromTtl(ttlHours);
      }
      const flagsChanged =
        includeComments !== editing.includeComments ||
        includeAttachments !== editing.includeAttachments;
      const liveLink = editing.mode === "live" && editing.revokedAt === null;
      // A public live link exposes the board immediately; a snapshot keeps
      // its frozen content until the owner refreshes it (TASK-177.1).
      if (liveLink && flagsChanged) {
        setPendingUpdate(request);
        return;
      }
      void onUpdate(request);
      return;
    }
    void onCreate({
      mode,
      ...(title.trim() !== "" ? { title: title.trim() } : {}),
      includeComments,
      includeAttachments,
      expiresAt: expiryFromTtl(ttlHours),
    });
  };

  return (
    <div className="space-y-3 rounded-md border bg-muted/30 p-3">
      {editing ? (
        <>
          <div className="space-y-1">
            <p className="text-sm font-medium">{t("share.editTitle")}</p>
            <p className="text-xs text-muted-foreground">
              {t("share.editImmutable")}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded bg-muted px-1.5 py-0.5 text-xs font-medium">
              {t(`share.mode.${editing.mode}`)}
            </span>
            <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">
              /s/{editing.token}
            </span>
          </div>
        </>
      ) : (
        <>
          <div className="flex gap-2">
            {(["live", "snapshot"] as const).map((option) => (
              <Button
                key={option}
                type="button"
                variant={mode === option ? "default" : "outline"}
                size="sm"
                className="flex-1"
                data-testid={`share-mode-${option}`}
                aria-pressed={mode === option}
                onClick={() => {
                  if (option === mode) return;
                  setIncludeComments(
                    option === "live"
                      ? SHARE_LIMITS.defaultIncludeCommentsLive
                      : SHARE_LIMITS.defaultIncludeCommentsSnapshot,
                  );
                  onModeChange(option);
                }}
              >
                {t(`share.mode.${option}`)}
              </Button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            {mode === "live"
              ? t("share.mode.liveHint")
              : t("share.mode.snapshotHint")}
          </p>
          <p className="text-xs text-muted-foreground">
            {t("share.count", { count, limit })}
          </p>
        </>
      )}

      <Input
        ref={titleInput}
        value={title}
        maxLength={SHARE_LIMITS.titleMax}
        aria-label={t("share.titlePlaceholder")}
        placeholder={t("share.titlePlaceholder")}
        onChange={(event) => setTitle(event.target.value)}
      />

      <div className="flex flex-wrap items-center gap-4 text-sm">
        <label className="flex items-center gap-2">
          <Checkbox
            checked={includeComments}
            onCheckedChange={setIncludeComments}
            aria-label={t("share.flag.comments")}
          />
          {t("share.flag.comments")}
        </label>
        <label className="flex items-center gap-2">
          <Checkbox
            checked={includeAttachments}
            onCheckedChange={setIncludeAttachments}
            aria-label={t("share.flag.attachments")}
          />
          {t("share.flag.attachments")}
        </label>
      </div>

      <div className="flex items-center justify-between gap-2 text-sm">
        <span className="text-muted-foreground">{t("share.ttl.label")}</span>
        <TtlPicker
          value={ttlHours}
          allowKeep={editing !== null && editing.expiresAt !== null}
          onChange={(hours) => {
            setTtlHours(hours);
            setTtlTouched(true);
          }}
        />
      </div>

      {similar && (
        <p className="rounded-md border border-warning/40 bg-warning/10 p-2 text-xs text-warning">
          {t(mode === "snapshot" ? "share.similarSnapshot" : "share.similar")}
        </p>
      )}
      {!editing && count >= limit && (
        <p className="text-xs text-destructive">{t("share.limitReached")}</p>
      )}
      {editing && error ? (
        <p
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive"
        >
          {error}
        </p>
      ) : null}

      <div className="flex gap-2">
        {editing ? (
          <Button
            type="button"
            variant="outline"
            className="flex-1"
            disabled={busy}
            onClick={onCancel}
          >
            {t("common.cancel")}
          </Button>
        ) : null}
        <Button
          type="button"
          className={editing ? "flex-1 gap-1.5" : "w-full gap-1.5"}
          disabled={busy || shares === null || (!editing && count >= limit)}
          data-testid={editing ? "share-save" : "share-create"}
          onClick={submit}
        >
          <Check className="h-4 w-4" aria-hidden />
          {editing
            ? t("share.editSave")
            : similar
              ? t("share.createAnother")
              : t("share.create")}
        </Button>
      </div>

      <ConfirmDialog
        open={pendingUpdate !== null}
        onOpenChange={(open) => {
          if (!open) setPendingUpdate(null);
        }}
        title={t("share.editPrivacyTitle")}
        description={t("share.editPrivacyDescription")}
        confirmLabel={t("share.editPrivacyConfirm")}
        onConfirm={() => {
          if (pendingUpdate) void onUpdate(pendingUpdate);
        }}
      />
    </div>
  );
}

function expiryFromTtl(hours: number): string | null {
  return hours === 0
    ? null
    : new Date(Date.now() + hours * 3_600_000).toISOString();
}

async function copy(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
